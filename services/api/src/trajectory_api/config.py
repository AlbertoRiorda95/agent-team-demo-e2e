"""Configuration of the api, from the environment only (.env.example)."""

import os
from collections.abc import Mapping
from dataclasses import dataclass

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
DEFAULT_LAUNCH_WINDOW_S = 300


@dataclass(frozen=True, slots=True)
class Settings:
    nats_url: str | None
    host: str
    port: int
    launch_window_s: int = DEFAULT_LAUNCH_WINDOW_S


def _integer(env: Mapping[str, str], name: str, default: int, low: int, high: int) -> int:
    raw = env.get(name, "").strip()
    try:
        value = int(raw) if raw else default
    except ValueError:
        value = low - 1
    if not low <= value <= high:
        raise ValueError(f'{name} must be an integer between {low} and {high}, got "{raw}"')
    return value


def load_settings(env: Mapping[str, str] = os.environ) -> Settings:
    """Reads NATS_URL, API_HOST, API_PORT and LAUNCH_WINDOW_S; raises ValueError on a bad value.

    LAUNCH_WINDOW_S (seconds, default 300) is for tests only.
    """
    return Settings(
        nats_url=env.get("NATS_URL", "").strip() or None,
        host=env.get("API_HOST", "").strip() or DEFAULT_HOST,
        port=_integer(env, "API_PORT", DEFAULT_PORT, 1, 65535),
        launch_window_s=_integer(env, "LAUNCH_WINDOW_S", DEFAULT_LAUNCH_WINDOW_S, 1, 86400),
    )
