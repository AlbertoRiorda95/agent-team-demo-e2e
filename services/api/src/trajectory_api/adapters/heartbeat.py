"""The `status.api` heartbeat: a `trajectory.v1.ServiceStatus` every 5 s on core NATS.

Nothing is sent while NATS is not connected (there is nobody to send it to);
each beat also creates the launch window bucket if it is still missing.
"""

import asyncio
import contextlib
import logging
import time
from datetime import UTC, datetime

import nats.errors

from trajectory.v1 import service_pb2
from trajectory_api.adapters.nats_bus import NatsBus
from trajectory_api.adapters.nats_jetstream import NatsJetStream
from trajectory_api.application.ports import BusUnavailableError
from trajectory_api.application.use_cases import ReportStatus
from trajectory_api.domain.status import ServiceState, StatusReport

logger = logging.getLogger(__name__)

SERVICE = "api"
STATUS_SUBJECT = f"status.{SERVICE}"
HEARTBEAT_INTERVAL_S = 5.0

_STATES = {
    ServiceState.OK: service_pb2.ServiceStatus.STATE_OK,
    ServiceState.DEGRADED: service_pb2.ServiceStatus.STATE_DEGRADED,
}


def service_status_message(
    report: StatusReport, *, instance: str, version: str, sent_at: datetime
) -> service_pb2.ServiceStatus:
    message = service_pb2.ServiceStatus(
        service=SERVICE,
        instance=instance,
        state=_STATES[report.state],
        detail=report.detail,
        version=version,
        config_version=report.config_version,
    )
    message.sent_at.FromDatetime(sent_at)
    return message


class Heartbeat:
    def __init__(
        self,
        bus: NatsBus,
        report: ReportStatus,
        *,
        jetstream: NatsJetStream,
        instance: str,
        version: str,
        interval_s: float = HEARTBEAT_INTERVAL_S,
    ) -> None:
        self._bus = bus
        self._report = report
        self._jetstream = jetstream
        self._instance = instance
        self._version = version
        self._interval_s = interval_s
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _run(self) -> None:
        # a fixed schedule, so the beats do not drift by the time each one takes
        next_beat = time.monotonic()
        while True:
            await self.beat()
            next_beat += self._interval_s
            await asyncio.sleep(max(0.0, next_beat - time.monotonic()))

    async def beat(self) -> None:
        if not self._bus.is_connected:
            return
        if not self._jetstream.is_ready:
            with contextlib.suppress(BusUnavailableError):
                await self._jetstream.ensure_window()
        message = service_status_message(
            self._report(),
            instance=self._instance,
            version=self._version,
            sent_at=datetime.now(UTC),
        )
        try:
            await self._bus.client.publish(STATUS_SUBJECT, message.SerializeToString())
        except (BusUnavailableError, nats.errors.Error) as error:
            logger.warning(
                "cannot publish the heartbeat", extra={"event": "status", "error": repr(error)}
            )
