"""Entry point: `uv run trajectory-api` (or `python -m trajectory_api.main`)."""

import uuid
from datetime import UTC, datetime

import uvicorn
from fastapi import FastAPI

from trajectory_api.adapters.http import create_app
from trajectory_api.adapters.nats_bus import NatsBus
from trajectory_api.application.use_cases import AcceptLaunch
from trajectory_api.config import Settings, load_settings
from trajectory_api.logging_json import configure_logging


def build_app(settings: Settings) -> FastAPI:
    return create_app(
        bus=NatsBus(settings.nats_url),
        accept_launch=AcceptLaunch(clock=lambda: datetime.now(UTC), new_id=uuid.uuid4),
    )


def main() -> None:
    configure_logging()
    settings = load_settings()
    uvicorn.run(build_app(settings), host=settings.host, port=settings.port, log_config=None)


if __name__ == "__main__":
    main()
