"""Entry point: `uv run trajectory-api` (or `python -m trajectory_api.main`)."""

import socket
import uuid
from datetime import UTC, datetime
from importlib.metadata import version

import uvicorn
from fastapi import FastAPI

from trajectory_api.adapters.heartbeat import Heartbeat
from trajectory_api.adapters.http import create_app
from trajectory_api.adapters.nats_bus import NatsBus
from trajectory_api.adapters.nats_jetstream import NatsJetStream
from trajectory_api.application.use_cases import AcceptLaunch, ReportStatus
from trajectory_api.config import Settings, load_settings
from trajectory_api.logging_json import configure_logging


def build_app(settings: Settings, *, instance: str | None = None) -> FastAPI:
    bus = NatsBus(settings.nats_url)
    jetstream = NatsJetStream(bus, window_s=settings.launch_window_s)
    # the window bucket is created as soon as NATS is up (and again after a reconnection)
    bus.on_connected(jetstream.ensure_window)
    accept_launch = AcceptLaunch(
        window=jetstream,
        configs=jetstream,
        publisher=jetstream,
        clock=lambda: datetime.now(UTC),
        new_id=uuid.uuid4,
        window_s=settings.launch_window_s,
    )
    heartbeat = Heartbeat(
        bus,
        ReportStatus(bus=bus, window=jetstream, accept_launch=accept_launch),
        jetstream=jetstream,
        instance=instance or socket.gethostname(),
        version=version("trajectory-api"),
    )
    return create_app(
        bus=bus,
        accept_launch=accept_launch,
        window_s=settings.launch_window_s,
        background=[heartbeat],
    )


def main() -> None:
    configure_logging()
    settings = load_settings()
    uvicorn.run(
        build_app(settings),
        host=settings.host,
        port=settings.port,
        log_config=None,
        # one JSON line per request comes from the app itself
        access_log=False,
    )


if __name__ == "__main__":
    main()
