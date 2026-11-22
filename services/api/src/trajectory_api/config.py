"""Configuration of the api, from the environment only (.env.example)."""

import os
from collections.abc import Mapping
from dataclasses import dataclass

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000


@dataclass(frozen=True, slots=True)
class Settings:
    nats_url: str | None
    host: str
    port: int


def load_settings(env: Mapping[str, str] = os.environ) -> Settings:
    """Reads NATS_URL, API_HOST and API_PORT; raises ValueError on an invalid port."""
    raw_port = env.get("API_PORT", "").strip()
    try:
        port = int(raw_port) if raw_port else DEFAULT_PORT
    except ValueError:
        port = 0
    if not 1 <= port <= 65535:
        raise ValueError(f'API_PORT must be an integer between 1 and 65535, got "{raw_port}"')
    return Settings(
        nats_url=env.get("NATS_URL", "").strip() or None,
        host=env.get("API_HOST", "").strip() or DEFAULT_HOST,
        port=port,
    )
