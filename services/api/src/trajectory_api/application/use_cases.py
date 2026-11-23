"""Use cases: accept a launch, report the health and the status of the service."""

import contextlib
import logging
from dataclasses import dataclass
from uuid import UUID

from trajectory_api.application.ports import (
    BusStatus,
    BusUnavailableError,
    Claimed,
    Clock,
    ConfigSource,
    IdGenerator,
    LaunchPublisher,
    WindowStore,
)
from trajectory_api.domain.health import HealthStatus, health_status
from trajectory_api.domain.launch import AcceptedLaunch, Launch, config_snapshot
from trajectory_api.domain.status import StatusReport, status_report
from trajectory_api.domain.window import remaining_s

logger = logging.getLogger(__name__)

# a claim can only be lost to another replica that just took the window: then
# the next attempt sees its fresh claim and answers 429
_CLAIM_ATTEMPTS = 3


@dataclass(frozen=True, slots=True)
class RateLimited:
    """A launch was accepted less than the window ago; retry in `retry_after_s` seconds."""

    retry_after_s: int


class AcceptLaunch:
    """Accepts a validated launch if the global window is free and publishes it.

    Order (docs/design/launch-intake.md): claim the window atomically, attach
    the config snapshot, publish and wait for the ack. If the bus fails after
    the claim, the claim is released and BusUnavailableError propagates: the
    window is as it was before the request.
    """

    def __init__(
        self,
        *,
        window: WindowStore,
        configs: ConfigSource,
        publisher: LaunchPublisher,
        clock: Clock,
        new_id: IdGenerator,
        window_s: int,
    ) -> None:
        self._window = window
        self._configs = configs
        self._publisher = publisher
        self._clock = clock
        self._new_id = new_id
        self._window_s = window_s
        self._config_version = 0

    @property
    def config_version(self) -> int:
        """The config version of the last accepted launch (0 = the defaults)."""
        return self._config_version

    async def __call__(self, launch: Launch) -> AcceptedLaunch | RateLimited:
        launch_id = self._new_id()
        claimed = await self._claim(launch_id)
        if isinstance(claimed, RateLimited):
            return claimed
        try:
            config = config_snapshot(await self._configs.applied_config())
            accepted = AcceptedLaunch(
                launch_id=launch_id, accepted_at=self._clock(), launch=launch, config=config
            )
            await self._publisher.publish(accepted)
        except BusUnavailableError:
            await self._release(claimed, launch_id)
            raise
        self._config_version = config.config_version
        return accepted

    async def _claim(self, launch_id: UUID) -> Claimed | RateLimited:
        for _ in range(_CLAIM_ATTEMPTS):
            outcome = await self._window.claim(launch_id)
            if isinstance(outcome, Claimed):
                return outcome
            left = remaining_s(self._window_s, outcome.claimed_at, self._clock())
            if left is not None:
                return RateLimited(retry_after_s=left)
            # the holder's window is over but the bus has not expired it yet
            taken = await self._window.take_over(outcome, launch_id)
            if taken is not None:
                return taken
        return RateLimited(retry_after_s=1)

    async def _release(self, claimed: Claimed, launch_id: UUID) -> None:
        with contextlib.suppress(BusUnavailableError):
            await self._window.release(claimed)
            return
        logger.error(
            "cannot release the launch window after a failed publish",
            extra={"event": "window", "launch_id": str(launch_id)},
        )


@dataclass(frozen=True, slots=True)
class CheckHealth:
    bus: BusStatus

    def __call__(self) -> HealthStatus:
        return health_status(self.bus.is_connected)


@dataclass(frozen=True, slots=True)
class ReportStatus:
    """What the `status.api` heartbeat says about this instance."""

    bus: BusStatus
    window: WindowStore
    accept_launch: AcceptLaunch

    def __call__(self) -> StatusReport:
        return status_report(
            self.bus.is_connected, self.window.is_ready, self.accept_launch.config_version
        )
