"""Ports the use cases depend on; the adapters implement them."""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from trajectory_api.domain.launch import AcceptedLaunch, AppliedConfig


class BusUnavailableError(Exception):
    """The message bus is not reachable, or did not acknowledge an operation."""


class BusStatus(Protocol):
    """The message bus connection, as far as the health check needs it."""

    @property
    def is_connected(self) -> bool: ...


class Clock(Protocol):
    def __call__(self) -> datetime: ...


class IdGenerator(Protocol):
    def __call__(self) -> UUID: ...


@dataclass(frozen=True, slots=True)
class Claimed:
    """This request holds the window; `revision` identifies the claim."""

    revision: int


@dataclass(frozen=True, slots=True)
class Held:
    """Another launch holds the window since `claimed_at` (the bus server's time)."""

    revision: int
    claimed_at: datetime


class WindowStore(Protocol):
    """Atomic operations on the shared window, the same for every api replica.

    Every method raises BusUnavailableError when the bus does not answer.
    """

    @property
    def is_ready(self) -> bool:
        """Whether the store exists on the bus (False until it is created)."""
        ...

    async def claim(self, launch_id: UUID) -> Claimed | Held:
        """Claims the window if nobody holds it, atomically."""
        ...

    async def take_over(self, held: Held, launch_id: UUID) -> Claimed | None:
        """Replaces the claim `held` (an expired one) atomically; None if it changed meanwhile."""
        ...

    async def release(self, claimed: Claimed) -> None:
        """Gives the window back, as if the claim never happened."""
        ...


class ConfigSource(Protocol):
    async def applied_config(self) -> AppliedConfig | None:
        """The latest config the propagator reported as applied; None when there is none.

        Raises BusUnavailableError when the bus does not answer.
        """
        ...


class LaunchPublisher(Protocol):
    async def publish(self, accepted: AcceptedLaunch) -> None:
        """Publishes the launch and waits for the bus to store it.

        Raises BusUnavailableError when it is not acknowledged.
        """
        ...
