"""Use cases: accept a launch (placeholder) and report the health of the service."""

from dataclasses import dataclass

from trajectory_api.application.ports import BusStatus, Clock, IdGenerator
from trajectory_api.domain.health import HealthStatus, health_status
from trajectory_api.domain.launch import AcceptedLaunch, Launch


@dataclass(frozen=True, slots=True)
class AcceptLaunch:
    """Placeholder of the foundations milestone: gives the launch an id and a time.

    It publishes nothing and applies no rate limit yet (docs/design/foundations.md).
    """

    clock: Clock
    new_id: IdGenerator

    def __call__(self, launch: Launch) -> AcceptedLaunch:
        return AcceptedLaunch(launch_id=self.new_id(), accepted_at=self.clock(), launch=launch)


@dataclass(frozen=True, slots=True)
class CheckHealth:
    bus: BusStatus

    def __call__(self) -> HealthStatus:
        return health_status(self.bus.is_connected)
