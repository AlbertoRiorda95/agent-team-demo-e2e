"""Configuration from the environment."""

import pytest

from trajectory_api.adapters.http import json_pointer
from trajectory_api.config import load_settings


def test_defaults_without_environment() -> None:
    settings = load_settings({})

    assert settings.nats_url is None
    assert settings.host == "127.0.0.1"
    assert settings.port == 8000
    assert settings.launch_window_s == 300


def test_reads_the_environment() -> None:
    settings = load_settings(
        {"NATS_URL": "nats://nats:4222", "API_HOST": "0.0.0.0", "API_PORT": "9000"}  # noqa: S104
    )

    assert settings.nats_url == "nats://nats:4222"
    assert settings.host == "0.0.0.0"  # noqa: S104
    assert settings.port == 9000


@pytest.mark.parametrize("port", ["0", "65536", "http"])
def test_rejects_an_invalid_port(port: str) -> None:
    with pytest.raises(ValueError, match="API_PORT"):
        load_settings({"API_PORT": port})


def test_reads_the_launch_window() -> None:
    assert load_settings({"LAUNCH_WINDOW_S": "2"}).launch_window_s == 2


@pytest.mark.parametrize("window", ["0", "-1", "2.5", "soon"])
def test_rejects_an_invalid_launch_window(window: str) -> None:
    with pytest.raises(ValueError, match="LAUNCH_WINDOW_S"):
        load_settings({"LAUNCH_WINDOW_S": window})


def test_json_pointer_escapes_special_characters() -> None:
    assert json_pointer(("body", "a/b", "c~d", 0)) == "/a~1b/c~0d/0"
    assert json_pointer(("body",)) == ""
