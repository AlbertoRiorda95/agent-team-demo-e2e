"""GET /healthz through the test client, checked against docs/api/openapi.yaml."""

import asyncio

from fastapi.testclient import TestClient
from openapi_core import OpenAPI

from tests.conftest import FakeBus, FakeClock, assert_matches_contract, make_client
from trajectory_api.adapters.nats_bus import NatsBus


def test_healthz_is_ok_when_connected_to_nats(
    client: TestClient, bus: FakeBus, contract: OpenAPI
) -> None:
    bus.is_connected = True

    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert_matches_contract(contract, response)


def test_healthz_is_degraded_without_nats(
    client: TestClient, bus: FakeBus, contract: OpenAPI
) -> None:
    bus.is_connected = False

    response = client.get("/healthz")

    assert response.status_code == 503
    assert response.json() == {"status": "degraded"}
    assert_matches_contract(contract, response)


def test_lifespan_starts_and_stops_the_bus() -> None:
    bus = FakeBus(FakeClock())

    with make_client(bus):
        assert bus.started
        assert not bus.stopped

    assert bus.stopped


def test_nats_bus_keeps_retrying_when_nats_is_unreachable() -> None:
    async def scenario() -> tuple[bool, bool]:
        # port 9 (discard) on localhost: nothing listens, the connection is refused
        bus = NatsBus("nats://127.0.0.1:9", initial_backoff_s=0.01, connect_timeout_s=0.2)
        await bus.start()
        await asyncio.sleep(0.3)
        retrying = bus._task is not None and not bus._task.done()
        connected = bus.is_connected
        await bus.stop()
        return retrying, connected

    retrying, connected = asyncio.run(scenario())

    assert retrying
    assert not connected


def test_nats_bus_without_url_stays_degraded() -> None:
    async def scenario() -> bool:
        bus = NatsBus(None)
        await bus.start()
        connected = bus.is_connected
        await bus.stop()
        return connected

    assert asyncio.run(scenario()) is False
