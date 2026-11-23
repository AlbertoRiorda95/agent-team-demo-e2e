"""JetStream operations of the api: the launch window, the config snapshot, the publish.

- Window: KV bucket `launch_window` (history 1, TTL = the window), key `last`
  holding the launch_id of the last accepted launch. A claim is an atomic
  `create`; the claim time is the server timestamp of the entry, so the
  replicas' clocks do not matter. Created at start-up when missing.
- Config: the latest `config.propagator.applied` on the `CONFIG` stream.
- Publish: `trajectory.v1.LaunchAccepted` on `launches.accepted` (stream
  `LAUNCHES`), `Nats-Msg-Id` = launch_id, waiting for the stream ack.

Every NATS failure becomes BusUnavailableError (the HTTP edge answers 503).
"""

import logging
from datetime import UTC, datetime
from uuid import UUID

import nats.errors
import nats.js.errors
from google.protobuf.message import DecodeError
from nats.js import JetStreamContext
from nats.js.api import KeyValueConfig
from nats.js.kv import KeyValue

from trajectory.v1 import config_pb2, launch_pb2
from trajectory_api.adapters.nats_bus import NatsBus
from trajectory_api.application.ports import BusUnavailableError, Claimed, Held
from trajectory_api.domain.launch import AcceptedLaunch, AppliedConfig

logger = logging.getLogger(__name__)

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)

WINDOW_BUCKET = "launch_window"
WINDOW_KEY = "last"
WINDOW_STREAM = f"KV_{WINDOW_BUCKET}"
WINDOW_SUBJECT = f"$KV.{WINDOW_BUCKET}.{WINDOW_KEY}"
CONFIG_STREAM = "CONFIG"
CONFIG_APPLIED_SUBJECT = "config.propagator.applied"
LAUNCHES_STREAM = "LAUNCHES"
LAUNCHES_ACCEPTED_SUBJECT = "launches.accepted"
_KV_OPERATION = "KV-Operation"


def launch_accepted_message(accepted: AcceptedLaunch) -> launch_pb2.LaunchAccepted:
    """The `trajectory.v1.LaunchAccepted` of an accepted launch."""
    launch, config = accepted.launch, accepted.config
    message = launch_pb2.LaunchAccepted(
        launch_id=str(accepted.launch_id),
        request=launch_pb2.LaunchRequest(
            mass_kg=launch.mass_kg,
            position=launch_pb2.Position(
                x_m=launch.position.x_m, y_m=launch.position.y_m, z_m=launch.position.z_m
            ),
            azimuth_deg=launch.azimuth_deg,
            elevation_deg=launch.elevation_deg,
            force_n=launch.force_n,
            burn_duration_s=launch.burn_duration_s,
        ),
        config=launch_pb2.PropagationConfig(
            propagation_time_s=config.propagation_time_s,
            sample_step_s=config.sample_step_s,
            gravity_mps2=config.gravity_mps2,
            config_version=config.config_version,
        ),
    )
    message.accepted_at.FromDatetime(accepted.accepted_at)
    return message


def applied_config(message: config_pb2.ConfigApplied) -> AppliedConfig:
    has_payload = message.WhichOneof("payload") == "propagator"
    return AppliedConfig(
        ok=message.ok,
        config_version=message.config_version,
        propagation_time_s=message.propagator.propagation_time_s if has_payload else None,
        sample_step_s=message.propagator.sample_step_s if has_payload else None,
    )


class NatsJetStream:
    """The WindowStore, ConfigSource and LaunchPublisher of the api, on NATS JetStream."""

    def __init__(self, bus: NatsBus, *, window_s: int, request_timeout_s: float = 2.0) -> None:
        self._bus = bus
        self._window_s = window_s
        self._timeout_s = request_timeout_s
        self._kv: KeyValue | None = None

    @property
    def is_ready(self) -> bool:
        return self._kv is not None

    def _js(self) -> JetStreamContext:
        return self._bus.client.jetstream(timeout=self._timeout_s)

    async def ensure_window(self) -> KeyValue:
        """The window bucket, created when missing (TTL = the window, history 1)."""
        js = self._js()
        try:
            try:
                kv = await js.key_value(WINDOW_BUCKET)
            except nats.js.errors.BucketNotFoundError:
                kv = await js.create_key_value(
                    KeyValueConfig(bucket=WINDOW_BUCKET, history=1, ttl=float(self._window_s))
                )
                logger.info(
                    "created the launch window bucket",
                    extra={"event": "window", "bucket": WINDOW_BUCKET, "ttl_s": self._window_s},
                )
        except (nats.errors.Error, TimeoutError) as error:
            self._kv = None
            raise BusUnavailableError(f"launch window bucket unavailable: {error!r}") from error
        self._kv = kv
        return kv

    async def _window(self) -> KeyValue:
        self._bus.client  # noqa: B018 - raises BusUnavailableError when disconnected
        return self._kv if self._kv is not None else await self.ensure_window()

    async def claim(self, launch_id: UUID) -> Claimed | Held:
        kv = await self._window()
        try:
            revision = await kv.create(WINDOW_KEY, str(launch_id).encode())
            return Claimed(revision=revision)
        except nats.js.errors.KeyWrongLastSequenceError:
            pass
        except (nats.errors.Error, TimeoutError) as error:
            # NATS may have lost the bucket (a restart without its data): look it
            # up again on the next request or heartbeat
            self._kv = None
            raise BusUnavailableError(f"cannot claim the launch window: {error!r}") from error
        return await self._holder()

    async def _holder(self) -> Held:
        try:
            last = await self._js().get_last_msg(WINDOW_STREAM, WINDOW_SUBJECT)
        except nats.js.errors.NotFoundError:
            # expired between the claim and the read: an expired claim, taken over at once
            return Held(revision=0, claimed_at=_EPOCH)
        except (nats.errors.Error, TimeoutError) as error:
            raise BusUnavailableError(f"cannot read the launch window: {error!r}") from error
        if last.seq is None or last.time is None:
            raise BusUnavailableError("launch window entry without sequence or time")
        if last.headers and last.headers.get(_KV_OPERATION) in ("DEL", "PURGE"):
            # released between the claim and the read
            return Held(revision=last.seq, claimed_at=_EPOCH)
        return Held(revision=last.seq, claimed_at=last.time)

    async def take_over(self, held: Held, launch_id: UUID) -> Claimed | None:
        kv = await self._window()
        try:
            revision = await kv.update(WINDOW_KEY, str(launch_id).encode(), last=held.revision)
        except nats.js.errors.KeyWrongLastSequenceError:
            return None
        except (nats.errors.Error, TimeoutError) as error:
            raise BusUnavailableError(f"cannot claim the launch window: {error!r}") from error
        return Claimed(revision=revision)

    async def release(self, claimed: Claimed) -> None:
        kv = await self._window()
        try:
            await kv.delete(WINDOW_KEY, last=claimed.revision)
        except nats.js.errors.KeyWrongLastSequenceError:
            logger.warning("launch window changed before its release", extra={"event": "window"})
        except (nats.errors.Error, TimeoutError) as error:
            raise BusUnavailableError(f"cannot release the launch window: {error!r}") from error

    async def applied_config(self) -> AppliedConfig | None:
        try:
            last = await self._js().get_last_msg(CONFIG_STREAM, CONFIG_APPLIED_SUBJECT)
        except nats.js.errors.NotFoundError:
            # no config applied yet (or no CONFIG stream): the defaults
            return None
        except (nats.errors.Error, TimeoutError) as error:
            raise BusUnavailableError(f"cannot read the applied config: {error!r}") from error
        try:
            message = config_pb2.ConfigApplied.FromString(last.data or b"")
        except DecodeError:
            logger.warning(
                "ignored an applied config that does not decode: using the defaults",
                extra={"event": "config", "subject": CONFIG_APPLIED_SUBJECT, "seq": last.seq},
            )
            return None
        return applied_config(message)

    async def publish(self, accepted: AcceptedLaunch) -> None:
        payload = launch_accepted_message(accepted).SerializeToString()
        launch_id = str(accepted.launch_id)
        try:
            ack = await self._js().publish(
                LAUNCHES_ACCEPTED_SUBJECT,
                payload,
                timeout=self._timeout_s,
                stream=LAUNCHES_STREAM,
                headers={"Nats-Msg-Id": launch_id},
            )
        except (nats.errors.Error, TimeoutError) as error:
            raise BusUnavailableError(f"launch not acknowledged: {error!r}") from error
        logger.debug(
            "launch published",
            extra={"event": "publish", "launch_id": launch_id, "seq": ack.seq},
        )
