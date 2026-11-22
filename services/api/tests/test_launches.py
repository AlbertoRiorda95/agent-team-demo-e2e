"""POST /launches (placeholder) through the test client, checked against docs/api/openapi.yaml."""

import copy
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from openapi_core import OpenAPI

from tests.conftest import FIXED_ID, FIXED_TIME, assert_matches_contract

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


def test_valid_launch_is_accepted_with_a_new_id(client: TestClient, contract: OpenAPI) -> None:
    raw, response = post(client, VALID)

    assert response.status_code == 202
    assert response.json() == {
        "launch_id": str(FIXED_ID),
        "accepted_at": FIXED_TIME.isoformat().replace("+00:00", "Z"),
    }
    assert_matches_contract(contract, response, request_body=raw)


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
