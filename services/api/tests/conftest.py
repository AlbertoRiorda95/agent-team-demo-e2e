"""Fixtures: the app through the FastAPI test client, and the contract of docs/api/openapi.yaml."""

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from openapi_core import Config, OpenAPI
from openapi_core.testing import MockRequest, MockResponse

from trajectory_api.adapters.http import create_app
from trajectory_api.application.use_cases import AcceptLaunch

CONTRACT = Path(__file__).resolve().parents[3] / "docs" / "api" / "openapi.yaml"
SERVER = "http://localhost:8000"
FIXED_ID = UUID("6f1c2b8e-4d3a-4e5f-9a7b-0c1d2e3f4a5b")
FIXED_TIME = datetime(2026, 11, 22, 12, 0, tzinfo=UTC)


class FakeBus:
    """Stands in for the NATS connection: the tests set `is_connected`."""

    def __init__(self, connected: bool = True) -> None:
        self.is_connected = connected
        self.started = False
        self.stopped = False

    async def start(self) -> None:
        self.started = True

    async def stop(self) -> None:
        self.stopped = True


@pytest.fixture(scope="session")
def contract() -> OpenAPI:
    # RFC 9457 problem details are JSON: openapi-core only knows application/json
    config = Config(extra_media_type_deserializers={"application/problem+json": json.loads})
    return OpenAPI.from_file_path(str(CONTRACT), config=config)


@pytest.fixture
def bus() -> FakeBus:
    return FakeBus()


def make_client(bus: FakeBus) -> TestClient:
    app = create_app(
        bus=bus,
        accept_launch=AcceptLaunch(clock=lambda: FIXED_TIME, new_id=lambda: FIXED_ID),
    )
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
    """Validates the response (status, content type, body) against the contract."""
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
