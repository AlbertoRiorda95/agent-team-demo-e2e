"""POST /launches and the heartbeat against a real NATS with the streams of proto/nats/streams/.

Catches the KV claim, the publish and its ack, concurrency between two
instances, the window expiry and the recovery after a NATS outage.
"""

import itertools
import json
import threading
import time
from collections.abc import Callable
from datetime import UTC
from typing import Any
from uuid import UUID

import nats.js.errors
import pytest
from fastapi.testclient import TestClient
from httpx import Response
from nats.aio.client import Client
from openapi_core import OpenAPI

from tests.conftest import assert_matches_contract
from tests.integration.conftest import add_stream, nats_server, reset, run, wait_until
from tests.test_launches import VALID
from trajectory.v1 import config_pb2, launch_pb2, service_pb2

pytestmark = pytest.mark.integration

StartApi = Callable[..., TestClient]


def post(client: TestClient, body: object = VALID) -> tuple[bytes, Response]:
    raw = json.dumps(body).encode()
    return raw, client.post("/launches", content=raw, headers={"content-type": "application/json"})


def launches(url: str) -> list[tuple[dict[str, str], launch_pb2.LaunchAccepted]]:
    """Every message of the LAUNCHES stream, with its headers."""

    async def scenario(client: Client) -> list[tuple[dict[str, str], launch_pb2.LaunchAccepted]]:
        js = client.jetstream()
        info = await js.stream_info("LAUNCHES")
        found = []
        for seq in range(info.state.first_seq, info.state.last_seq + 1):
            if info.state.messages == 0:
                break
            msg = await js.get_msg("LAUNCHES", seq)
            found.append((msg.headers or {}, launch_pb2.LaunchAccepted.FromString(msg.data or b"")))
        return found

    return run(scenario, url)


def window_entry(url: str) -> bytes | None:
    async def scenario(client: Client) -> bytes | None:
        kv = await client.jetstream().key_value("launch_window")
        try:
            return (await kv.get("last")).value
        except nats.js.errors.KeyNotFoundError:
            return None

    return run(scenario, url)


def test_accepted_launch_is_on_the_launches_stream(
    start_api: StartApi, nats_url: str, contract: OpenAPI
) -> None:
    api = start_api()

    raw, response = post(api)

    assert response.status_code == 202
    assert_matches_contract(contract, response, request_body=raw)
    launch_id = response.json()["launch_id"]
    [(headers, message)] = launches(nats_url)
    assert message.launch_id == launch_id
    assert headers["Nats-Msg-Id"] == launch_id
    assert UUID(launch_id).version == 4
    assert (
        message.accepted_at.ToDatetime(tzinfo=UTC)
        .isoformat()
        .startswith(response.json()["accepted_at"][:19])
    )
    assert message.request.mass_kg == VALID["mass_kg"]
    assert message.request.azimuth_deg == VALID["azimuth_deg"]
    assert message.request.force_n == VALID["force_n"]
    assert message.config.propagation_time_s == 60
    assert message.config.sample_step_s == 0.01
    assert message.config.gravity_mps2 == 9.80665
    assert message.config.config_version == 0
    assert window_entry(nats_url) == launch_id.encode()


def test_second_launch_within_the_window_is_rate_limited(
    start_api: StartApi, nats_url: str, contract: OpenAPI
) -> None:
    api = start_api()
    post(api)

    raw, first = post(api)
    time.sleep(1.1)
    _, later = post(api)

    assert first.status_code == 429
    assert_matches_contract(contract, first, request_body=raw)
    first_s = first.json()["retry_after_s"]
    assert first.headers["retry-after"] == str(first_s)
    assert 1 <= first_s <= 300
    assert later.json()["retry_after_s"] < first_s
    assert len(launches(nats_url)) == 1


def test_three_bad_fields_are_listed_and_nothing_is_published(
    start_api: StartApi, nats_url: str, contract: OpenAPI
) -> None:
    api = start_api()
    body: dict[str, Any] = json.loads(json.dumps(VALID))
    body["mass_kg"] = -1
    body["elevation_deg"] = 95
    body["position"]["z_m"] = "high"

    raw, response = post(api, body)

    assert response.status_code == 422
    assert_matches_contract(contract, response, request_body=raw)
    fields = sorted(error["field"] for error in response.json()["errors"])
    assert fields == ["/elevation_deg", "/mass_kg", "/position/z_m"]
    assert launches(nats_url) == []
    assert window_entry(nats_url) is None


def test_a_new_launch_is_accepted_after_the_window(start_api: StartApi, nats_url: str) -> None:
    api = start_api(window_s=2)
    assert post(api)[1].status_code == 202
    assert post(api)[1].status_code == 429

    time.sleep(2.1)

    assert post(api)[1].status_code == 202
    assert len(launches(nats_url)) == 2


def test_two_instances_at_the_same_time_accept_exactly_one(
    start_api: StartApi, nats_url: str
) -> None:
    apis = [start_api(instance="api-a"), start_api(instance="api-b")]
    barrier = threading.Barrier(len(apis))
    codes: list[int] = []

    def send(api: TestClient) -> None:
        barrier.wait()
        codes.append(post(api)[1].status_code)

    threads = [threading.Thread(target=send, args=(api,)) for api in apis]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(codes) == [202, 429]
    assert len(launches(nats_url)) == 1


def test_publish_without_a_stream_answers_503_and_frees_the_window(
    start_api: StartApi, nats_url: str, contract: OpenAPI
) -> None:
    api = start_api()

    async def drop_launches(client: Client) -> None:
        await client.jetstream().delete_stream("LAUNCHES")

    run(drop_launches, nats_url)
    raw, response = post(api)

    assert response.status_code == 503
    assert_matches_contract(contract, response, request_body=raw)
    assert window_entry(nats_url) is None

    run(lambda client: add_stream(client, "LAUNCHES"), nats_url)
    assert post(api)[1].status_code == 202


def test_applied_config_is_the_snapshot(start_api: StartApi, nats_url: str) -> None:
    applied = config_pb2.ConfigApplied(
        service="propagator",
        instance="propagator-0",
        config_version=4,
        ok=True,
        propagator=config_pb2.PropagatorConfig(propagation_time_s=30.0, sample_step_s=0.05),
    )

    async def publish_config(client: Client) -> None:
        await client.jetstream().publish(
            "config.propagator.applied", applied.SerializeToString(), stream="CONFIG"
        )

    run(publish_config, nats_url)
    api = start_api()

    assert post(api)[1].status_code == 202
    [(_, message)] = launches(nats_url)
    assert message.config.propagation_time_s == 30.0
    assert message.config.sample_step_s == 0.05
    assert message.config.config_version == 4


def test_nats_outage_answers_503_and_recovers_without_restart(
    start_api: StartApi, contract: OpenAPI
) -> None:
    with nats_server(fixed_port=True) as container:
        url = container.nats_uri()
        run(reset, url)
        api = start_api(url=url)
        wrapped = container.get_wrapped_container()

        wrapped.stop(timeout=2)
        wait_until(lambda: api.get("/healthz").status_code == 503)
        health = api.get("/healthz")
        raw, response = post(api)

        assert health.json() == {"status": "degraded"}
        assert_matches_contract(contract, health)
        assert response.status_code == 503
        assert_matches_contract(contract, response, request_body=raw)

        wrapped.start()
        wait_until(lambda: api.get("/healthz").status_code == 200, timeout_s=30)
        assert post(api)[1].status_code == 202


def test_heartbeat_every_five_seconds(start_api: StartApi, nats_url: str) -> None:
    async def listen(client: Client) -> list[tuple[float, service_pb2.ServiceStatus]]:
        beats: list[tuple[float, service_pb2.ServiceStatus]] = []
        sub = await client.subscribe("status.api")
        while len(beats) < 3:
            msg = await sub.next_msg(timeout=8)
            beats.append((time.monotonic(), service_pb2.ServiceStatus.FromString(msg.data)))
        return beats

    start_api(instance="api-beat")
    beats = run(listen, nats_url)

    intervals = [later[0] - earlier[0] for earlier, later in itertools.pairwise(beats)]
    assert all(4.0 <= interval <= 6.0 for interval in intervals), intervals
    for _, status in beats:
        assert status.service == "api"
        assert status.instance == "api-beat"
        assert status.state == service_pb2.ServiceStatus.STATE_OK
        assert status.config_version == 0
