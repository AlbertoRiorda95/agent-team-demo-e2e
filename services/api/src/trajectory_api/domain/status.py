"""The heartbeat of an api instance (`status.api`)."""

from dataclasses import dataclass
from enum import StrEnum

WINDOW_MISSING = "KV bucket launch_window is missing"
BUS_DOWN = "not connected to NATS"


class ServiceState(StrEnum):
    OK = "ok"
    DEGRADED = "degraded"


@dataclass(frozen=True, slots=True)
class StatusReport:
    state: ServiceState
    detail: str
    config_version: int


def status_report(bus_connected: bool, window_ready: bool, config_version: int) -> StatusReport:
    """`ok` when connected and the window bucket exists, `degraded` with the reason otherwise."""
    if not bus_connected:
        return StatusReport(ServiceState.DEGRADED, BUS_DOWN, config_version)
    if not window_ready:
        return StatusReport(ServiceState.DEGRADED, WINDOW_MISSING, config_version)
    return StatusReport(ServiceState.OK, "", config_version)
