"""Health of the service: `ok` when connected to the message bus, `degraded` otherwise."""

from enum import StrEnum


class HealthStatus(StrEnum):
    OK = "ok"
    DEGRADED = "degraded"


def health_status(bus_connected: bool) -> HealthStatus:
    return HealthStatus.OK if bus_connected else HealthStatus.DEGRADED
