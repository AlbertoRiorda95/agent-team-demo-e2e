"""Ports the use cases depend on; the adapters implement them."""

from datetime import datetime
from typing import Protocol
from uuid import UUID


class BusStatus(Protocol):
    """The message bus connection, as far as the health check needs it."""

    @property
    def is_connected(self) -> bool: ...


class Clock(Protocol):
    def __call__(self) -> datetime: ...


class IdGenerator(Protocol):
    def __call__(self) -> UUID: ...
