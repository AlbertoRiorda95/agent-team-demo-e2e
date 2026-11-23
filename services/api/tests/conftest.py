"""Fixtures: the app through the FastAPI test client with a fake bus and a fake clock,
and the contract of docs/api/openapi.yaml."""

import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from openapi_core import Config, OpenAPI
from openapi_core.testing import MockRequest, MockResponse

from trajectory_api.adapters.http import create_app
from trajectory_api.application.ports import BusUnavailableError, Claimed, Held
from trajectory_api.application.use_cases import AcceptLaunch
from trajectory_api.domain.launch import AcceptedLaunch, AppliedConfig

CONTRACT = Path(__file__).resolve().parents[3] / "docs" / "api" / "openapi.yaml"
SERVER = "http://localhost:8000"
FIXED_ID = UUID("6f1c2b8e-4d3a-4e5f-9a7b-0c1d2e3f4a5b")
FIXED_TIME = datetime(2026, 11, 22, 12, 0, tzinfo=UTC)
WINDOW_S = 300


class FakeClock:
    """The time of the api and of the fake bus server; the tests move it."""

    def __init__(self, now: datetime = FIXED_TIME) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


class FakeBus:
    """Stands in for NATS: the connection, the window KV entry, the config and the stream.

    `is_connected` False makes every operation fail as NATS does when it is down;
    `fail_publish` makes only the publish fail (no ack).
    """

    def __init__(self, clock: FakeClock, connected: bool = True) -> None:
        self.clock = clock
        self.is_connected = connected
        self.is_ready = True
        self.started = False
        self.stopped = False
        self.fail_publish = False
        self.applied: AppliedConfig | None = None
        self.published: list[AcceptedLaunch] = []
        # the window entry: (revision, launch_id, server time) or None
        self.entry: tuple[int, UUID, datetime] | None = None
        self._revision = 0

    async def start(self) -> None:
        self.started = True

    async def stop(self) -> None:
        self.stopped = True

    def _check(self) -> None:
        if not self.is_connected:
            raise BusUnavailableError("not connected")

    def _write(self, launch_id: UUID) -> Claimed:
        self._revision += 1
        self.entry = (self._revision, launch_id, self.clock())
        return Claimed(revision=self._revision)

    async def claim(self, launch_id: UUID) -> Claimed | Held:
        self._check()
        if self.entry is None:
            return self._write(launch_id)
        revision, _, claimed_at = self.entry
        return Held(revision=revision, claimed_at=claimed_at)

    async def take_over(self, held: Held, launch_id: UUID) -> Claimed | None:
        self._check()
        if self.entry is None or self.entry[0] != held.revision:
            return None
        return self._write(launch_id)

    async def release(self, claimed: Claimed) -> None:
        self._check()
        if self.entry is not None and self.entry[0] == claimed.revision:
            self.entry = None

    async def applied_config(self) -> AppliedConfig | None:
        self._check()
        return self.applied

    async def publish(self, accepted: AcceptedLaunch) -> None:
        self._check()
        if self.fail_publish:
            raise BusUnavailableError("no ack")
        self.published.append(accepted)


class SequentialIds:
    """FIXED_ID first, then new ids that differ only in the last digits."""

    def __init__(self) -> None:
        self.count = 0

    def __call__(self) -> UUID:
        self.count += 1
        return FIXED_ID if self.count == 1 else UUID(int=FIXED_ID.int + self.count)


@pytest.fixture(scope="session")
def contract() -> OpenAPI:
    # RFC 9457 problem details are JSON: openapi-core only knows application/json
    config = Config(extra_media_type_deserializers={"application/problem+json": json.loads})
    return OpenAPI.from_file_path(str(CONTRACT), config=config)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def bus(clock: FakeClock) -> FakeBus:
    return FakeBus(clock)


def make_client(bus: FakeBus) -> TestClient:
    accept_launch = AcceptLaunch(
        window=bus,
        configs=bus,
        publisher=bus,
        clock=bus.clock,
        new_id=SequentialIds(),
        window_s=WINDOW_S,
    )
    app = create_app(bus=bus, accept_launch=accept_launch, window_s=WINDOW_S)
    return TestClient(app, base_url=SERVER)


@pytest.fixture
def client(bus: FakeBus) -> Iterator[TestClient]:
    with make_client(bus) as test_client:
        yield test_client


def assert_matches_contract(
    contract: OpenAPI,
    response: Response,
    *,
    request_body: bytes | None = None,
) -> None:
    """Validates the response (status, headers, content type, body) against the contract."""
    request = MockRequest(
        SERVER,
        response.request.method,
        response.request.url.path,
        data=request_body,
        content_type="application/json",
    )
    mock_response = MockResponse(
        response.content,
        status_code=response.status_code,
        headers=dict(response.headers),
        content_type=response.headers["content-type"].split(";")[0],
    )
    contract.validate_response(request, mock_response)
