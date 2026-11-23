"""A real NATS (testcontainers) with the streams of proto/nats/streams/, and api instances on it.

Needs Docker. Run only these tests with `uv run pytest -m integration`, skip
them with `-m "not integration"`.
"""

import asyncio
import contextlib
import json
import random
import socket
import time
from collections.abc import Awaitable, Callable, Iterator
from pathlib import Path

import nats
import nats.js.errors
import pytest
from fastapi.testclient import TestClient
from nats.aio.client import Client
from testcontainers.community.nats import NatsContainer

from tests.conftest import SERVER
from trajectory_api.config import Settings
from trajectory_api.main import build_app

# the image of compose.yml (nats-server 2.15.3)
NATS_IMAGE = "nats:2-alpine@sha256:558394a23dd3c36f2d3a64b51865fd09908010e80a542cea5e75c2af543ed62a"
STREAMS = Path(__file__).resolve().parents[4] / "proto" / "nats" / "streams"


def run[T](scenario: Callable[[Client], Awaitable[T]], url: str) -> T:
    """Runs `scenario` with its own NATS connection, outside the apps' event loops."""

    async def main() -> T:
        client = await nats.connect(url, connect_timeout=5)
        try:
            return await scenario(client)
        finally:
            await client.close()

    return asyncio.run(main())


async def add_stream(client: Client, name: str) -> None:
    """Creates a stream from its proto/nats/streams/ file, as `nats stream add --config` does."""
    config = (STREAMS / f"{name}.json").read_bytes()
    reply = await client.request(f"$JS.API.STREAM.CREATE.{name}", config, timeout=5)
    answer = json.loads(reply.data)
    assert "error" not in answer, answer


async def reset(client: Client) -> None:
    """The state before each test: the four streams empty, no launch window bucket."""
    js = client.jetstream()
    for path in sorted(STREAMS.glob("*.json")):
        with contextlib.suppress(nats.js.errors.NotFoundError):
            await js.delete_stream(path.stem)
        await add_stream(client, path.stem)
    with contextlib.suppress(nats.js.errors.NotFoundError):
        await js.delete_key_value("launch_window")


def free_port() -> int:
    """A free host port below the ephemeral range (32768 and up) Docker picks random ports from.

    Docker may hold its ports without a listening socket, so a port the kernel
    hands out can still collide with one Docker gave another container.
    """
    for port in random.sample(range(20000, 32000), 200):
        with socket.socket() as probe:
            try:
                probe.bind(("0.0.0.0", port))  # noqa: S104 - the host side of a Docker binding
            except OSError:
                continue
            return port
    raise RuntimeError("no free port between 20000 and 32000")


def nats_server(*, fixed_port: bool = False) -> NatsContainer:
    """A JetStream NATS, started by `with`; with `fixed_port` its address survives a restart."""
    container = NatsContainer(NATS_IMAGE, jetstream=True)
    if fixed_port:
        container.with_bind_ports(4222, free_port())
    return container


@pytest.fixture(scope="session")
def nats_container() -> Iterator[NatsContainer]:
    with nats_server() as container:
        yield container


@pytest.fixture
def nats_url(nats_container: NatsContainer) -> str:
    url = nats_container.nats_uri()
    run(reset, url)
    return url


def wait_until(check: Callable[[], bool], timeout_s: float = 15.0) -> None:
    deadline = time.monotonic() + timeout_s
    while not check():
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out after {timeout_s} s")
        time.sleep(0.1)


def api_client(url: str, *, window_s: int = 300, instance: str = "api-test") -> TestClient:
    settings = Settings(nats_url=url, host="127.0.0.1", port=8000, launch_window_s=window_s)
    return TestClient(build_app(settings, instance=instance), base_url=SERVER)


@pytest.fixture
def start_api(nats_url: str) -> Iterator[Callable[..., TestClient]]:
    """Starts api instances on the test NATS and waits until they are connected."""
    started: list[TestClient] = []

    def start(
        *, url: str = nats_url, window_s: int = 300, instance: str = "api-test"
    ) -> TestClient:
        client = api_client(url, window_s=window_s, instance=instance)
        client.__enter__()
        started.append(client)
        wait_until(lambda: client.get("/healthz").status_code == 200)
        return client

    yield start
    for client in reversed(started):
        client.__exit__(None, None, None)
