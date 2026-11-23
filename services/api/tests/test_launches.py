"""POST /launches through the test client (fake bus, fake clock), checked against
docs/api/openapi.yaml: validation, the global window, the config snapshot, bus failures."""

import copy
import json
import logging
from typing import Any

import pytest
from fastapi.testclient import TestClient
from openapi_core import OpenAPI

from tests.conftest import (
    FIXED_ID,
    FIXED_TIME,
    WINDOW_S,
    FakeBus,
    FakeClock,
    assert_matches_contract,
)
from trajectory_api.domain.launch import DEFAULT_CONFIG, AppliedConfig, PropagationConfig

VALID: dict[str, Any] = {
    "mass_kg": 2.0,
    "position": {"x_m": 0.0, "y_m": 0.0, "z_m": 0.0},
    "azimuth_deg": 45.0,
    "elevation_deg": 60.0,
    "force_n": 100,
    "burn_duration_s": 1.5,
}


def with_value(pointer: str, value: Any) -> dict[str, Any]:
    body = copy.deepcopy(VALID)
    *parents, last = pointer.strip("/").split("/")
    target = body
    for key in parents:
        target = target[key]
    target[last] = value
    return body


def without(pointer: str) -> dict[str, Any]:
    body = copy.deepcopy(VALID)
    *parents, last = pointer.strip("/").split("/")
    target = body
    for key in parents:
        target = target[key]
    del target[last]
    return body


def post(client: TestClient, body: object) -> tuple[bytes, Any]:
    raw = json.dumps(body).encode()
    return raw, client.post("/launches", content=raw, headers={"content-type": "application/json"})


def test_valid_launch_is_accepted_and_published_with_the_default_config(
    client: TestClient, bus: FakeBus, contract: OpenAPI
) -> None:
    raw, response = post(client, VALID)

    assert response.status_code == 202
    assert response.json() == {
        "launch_id": str(FIXED_ID),
        "accepted_at": FIXED_TIME.isoformat().replace("+00:00", "Z"),
    }
    assert_matches_contract(contract, response, request_body=raw)
    [published] = bus.published
    assert published.launch_id == FIXED_ID
    assert published.accepted_at == FIXED_TIME
    assert published.launch.force_n == 100
    assert published.launch.position.z_m == 0.0
    assert published.config == DEFAULT_CONFIG
    assert published.config.config_version == 0
    assert bus.entry is not None
    assert bus.entry[1] == FIXED_ID


def test_second_launch_within_the_window_is_rate_limited(
    client: TestClient, bus: FakeBus, clock: FakeClock, contract: OpenAPI
) -> None:
    post(client, VALID)
    clock.advance(10.2)

    raw, response = post(client, VALID)

    assert response.status_code == 429
    assert response.headers["content-type"].startswith("application/problem+json")
    problem = response.json()
    assert problem["status"] == 429
    assert problem["retry_after_s"] == 290  # 289.8 s left, rounded up
    assert response.headers["retry-after"] == "290"
    assert_matches_contract(contract, response, request_body=raw)
    assert len(bus.published) == 1


def test_retry_after_decreases_and_rejected_requests_do_not_restart_the_window(
    client: TestClient, clock: FakeClock
) -> None:
    post(client, VALID)
    seen = []
    for step in (100, 100, 99.5):
        clock.advance(step)
        response = post(client, VALID)[1]
        assert response.headers["retry-after"] == str(response.json()["retry_after_s"])
        seen.append(response.json()["retry_after_s"])

    # rounded up, never below 1, counted from the accepted launch only
    assert seen == [200, 100, 1]


def test_launch_exactly_at_the_end_of_the_window_is_accepted(
    client: TestClient, bus: FakeBus, clock: FakeClock
) -> None:
    post(client, VALID)
    clock.advance(WINDOW_S)

    _, response = post(client, VALID)

    assert response.status_code == 202
    assert len(bus.published) == 2
    assert bus.published[1].launch_id != FIXED_ID
    assert bus.entry is not None
    assert bus.entry[2] == clock()


def test_invalid_launch_inside_the_window_is_a_validation_problem(
    client: TestClient, bus: FakeBus, clock: FakeClock
) -> None:
    post(client, VALID)
    entry = bus.entry
    clock.advance(5)

    _, response = post(client, with_value("/force_n", -1))

    assert response.status_code == 422
    assert bus.entry == entry


def test_invalid_launch_does_not_touch_the_window(client: TestClient, bus: FakeBus) -> None:
    body = with_value("/mass_kg", 0)
    body["azimuth_deg"] = 400
    body["position"]["z_m"] = -1

    _, response = post(client, body)

    assert response.status_code == 422
    fields = sorted(error["field"] for error in response.json()["errors"])
    assert fields == ["/azimuth_deg", "/mass_kg", "/position/z_m"]
    assert bus.entry is None
    assert bus.published == []


def test_bus_down_answers_503_and_accepts_nothing(
    client: TestClient, bus: FakeBus, contract: OpenAPI
) -> None:
    bus.is_connected = False

    raw, response = post(client, VALID)

    assert response.status_code == 503
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["status"] == 503
    assert_matches_contract(contract, response, request_body=raw)
    assert bus.entry is None
    assert bus.published == []


def test_publish_without_ack_releases_the_window(
    client: TestClient, bus: FakeBus, contract: OpenAPI
) -> None:
    bus.fail_publish = True

    raw, response = post(client, VALID)

    assert response.status_code == 503
    assert_matches_contract(contract, response, request_body=raw)
    assert bus.entry is None
    bus.fail_publish = False
    assert post(client, VALID)[1].status_code == 202


def test_publish_without_ack_leaves_an_earlier_window_as_it_was(
    client: TestClient, bus: FakeBus, clock: FakeClock
) -> None:
    post(client, VALID)
    clock.advance(WINDOW_S + 1)  # expired, not yet removed by the bus
    entry = bus.entry
    bus.fail_publish = True

    _, response = post(client, VALID)

    assert response.status_code == 503
    # the expired claim was taken over, then released: the window is free, as it
    # was (expired) before the request, and nothing was accepted
    assert entry is not None
    assert bus.entry is None
    assert len(bus.published) == 1


def test_applied_config_is_the_snapshot(client: TestClient, bus: FakeBus) -> None:
    bus.applied = AppliedConfig(
        ok=True, config_version=7, propagation_time_s=30.0, sample_step_s=0.05
    )

    post(client, VALID)

    assert bus.published[0].config == PropagationConfig(
        propagation_time_s=30.0, sample_step_s=0.05, gravity_mps2=9.80665, config_version=7
    )


def test_refused_config_gives_the_defaults(client: TestClient, bus: FakeBus) -> None:
    bus.applied = AppliedConfig(
        ok=False, config_version=8, propagation_time_s=30.0, sample_step_s=0.05
    )

    post(client, VALID)

    assert bus.published[0].config == DEFAULT_CONFIG


def test_one_log_line_per_request(
    client: TestClient, bus: FakeBus, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="trajectory_api.adapters.http"):
        post(client, VALID)
        post(client, VALID)
        post(client, with_value("/mass_kg", 0))
        bus.is_connected = False
        post(client, VALID)

    lines = [r for r in caplog.records if getattr(r, "event", None) == "request"]
    assert [(r.status, r.outcome) for r in lines] == [  # type: ignore[attr-defined]
        (202, "accepted"),
        (429, "rate_limited"),
        (422, "invalid"),
        (503, "bus_unavailable"),
    ]
    assert lines[0].launch_id == str(FIXED_ID)  # type: ignore[attr-defined]
    assert all(r.launch_id is None for r in lines[1:])  # type: ignore[attr-defined]
    assert all(r.duration_ms >= 0 for r in lines)  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    ("body", "field"),
    [
        (with_value("/mass_kg", 0), "/mass_kg"),
        (with_value("/mass_kg", "2"), "/mass_kg"),
        (with_value("/mass_kg", True), "/mass_kg"),
        (with_value("/position/z_m", -0.1), "/position/z_m"),
        (with_value("/azimuth_deg", 360), "/azimuth_deg"),
        (with_value("/azimuth_deg", -1), "/azimuth_deg"),
        (with_value("/elevation_deg", 0), "/elevation_deg"),
        (with_value("/elevation_deg", 90), "/elevation_deg"),
        (with_value("/force_n", 0), "/force_n"),
        (with_value("/burn_duration_s", -1), "/burn_duration_s"),
        (without("/force_n"), "/force_n"),
        (without("/position/x_m"), "/position/x_m"),
        (with_value("/extra", 1), "/extra"),
        (with_value("/position/w_m", 1), "/position/w_m"),
        (with_value("/position", None), "/position"),
    ],
)
def test_invalid_launch_is_rejected_with_a_validation_problem(
    client: TestClient, contract: OpenAPI, body: dict[str, Any], field: str
) -> None:
    raw, response = post(client, body)

    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    problem = response.json()
    assert problem["status"] == 422
    assert field in [error["field"] for error in problem["errors"]]
    assert_matches_contract(contract, response, request_body=raw)


@pytest.mark.parametrize("raw", [b"", b"{not json", b"[]", b"null"])
def test_malformed_body_is_rejected_with_a_validation_problem(
    client: TestClient, contract: OpenAPI, raw: bytes
) -> None:
    response = client.post("/launches", content=raw, headers={"content-type": "application/json"})

    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["errors"]
    assert_matches_contract(contract, response, request_body=raw or None)


def test_non_finite_number_is_rejected(client: TestClient) -> None:
    raw = json.dumps(with_value("/force_n", float("inf"))).encode()  # Python emits Infinity

    response = client.post("/launches", content=raw, headers={"content-type": "application/json"})

    assert response.status_code == 422
