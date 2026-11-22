"""The NATS connection of the api.

The service never crashes because NATS is down: start-up connects in the
background, retrying with exponential backoff, and the health check reports
`degraded` until the connection is up. Once connected, nats-py reconnects on its
own; `is_connected` follows it.
"""

import asyncio
import contextlib
import logging

import nats
from nats.aio.client import Client

logger = logging.getLogger(__name__)


class NatsBus:
    def __init__(
        self,
        url: str | None,
        *,
        initial_backoff_s: float = 0.5,
        max_backoff_s: float = 30.0,
        connect_timeout_s: float = 2.0,
    ) -> None:
        self._url = url
        self._initial_backoff_s = initial_backoff_s
        self._max_backoff_s = max_backoff_s
        self._connect_timeout_s = connect_timeout_s
        self._client: Client | None = None
        self._task: asyncio.Task[None] | None = None

    @property
    def is_connected(self) -> bool:
        return self._client is not None and self._client.is_connected

    async def start(self) -> None:
        """Starts connecting in the background; returns at once."""
        if self._url is None:
            logger.error("NATS_URL is not set: the api stays degraded", extra={"event": "nats"})
            return
        self._task = asyncio.create_task(self._connect_with_backoff(self._url))

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        if self._client is not None:
            with contextlib.suppress(Exception):
                await self._client.close()
            self._client = None

    async def _connect_with_backoff(self, url: str) -> None:
        backoff_s = self._initial_backoff_s
        attempt = 0
        while True:
            attempt += 1
            try:
                self._client = await nats.connect(
                    url,
                    connect_timeout=self._connect_timeout_s,
                    allow_reconnect=True,
                    max_reconnect_attempts=-1,
                    error_cb=self._on_error,
                    disconnected_cb=self._on_disconnected,
                    reconnected_cb=self._on_reconnected,
                )
            except asyncio.CancelledError:
                raise
            except Exception as error:  # nats-py raises several unrelated types
                logger.error(
                    "cannot connect to NATS, retrying",
                    extra={
                        "event": "nats",
                        "attempt": attempt,
                        "retry_in_s": backoff_s,
                        "error": repr(error),
                    },
                )
                await asyncio.sleep(backoff_s)
                backoff_s = min(backoff_s * 2, self._max_backoff_s)
            else:
                logger.info("connected to NATS", extra={"event": "nats", "attempt": attempt})
                return

    async def _on_error(self, error: Exception) -> None:
        logger.error("NATS error", extra={"event": "nats", "error": repr(error)})

    async def _on_disconnected(self) -> None:
        logger.error("disconnected from NATS", extra={"event": "nats"})

    async def _on_reconnected(self) -> None:
        logger.info("reconnected to NATS", extra={"event": "nats"})
