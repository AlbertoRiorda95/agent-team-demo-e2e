"""The Protobuf messages the api sends, with the generated trajectory.v1 types."""

from datetime import UTC, datetime

from tests.conftest import FIXED_ID, FIXED_TIME
from trajectory.v1 import config_pb2, launch_pb2, service_pb2
from trajectory_api.adapters.heartbeat import service_status_message
from trajectory_api.adapters.nats_jetstream import applied_config, launch_accepted_message
from trajectory_api.domain.launch import DEFAULT_CONFIG, AcceptedLaunch, Launch, Position
from trajectory_api.domain.status import ServiceState, StatusReport


def test_launch_accepted_round_trips_with_every_value() -> None:
    accepted = AcceptedLaunch(
        launch_id=FIXED_ID,
        accepted_at=datetime(2026, 11, 22, 12, 0, 1, 250000, tzinfo=UTC),
        launch=Launch(
            mass_kg=2.0,
            position=Position(x_m=1.5, y_m=-2.0, z_m=3.0),
            azimuth_deg=45.0,
            elevation_deg=60.0,
            force_n=100.0,
            burn_duration_s=1.5,
        ),
        config=DEFAULT_CONFIG,
    )

    raw = launch_accepted_message(accepted).SerializeToString()
    decoded = launch_pb2.LaunchAccepted.FromString(raw)

    assert decoded.launch_id == str(FIXED_ID)
    assert decoded.accepted_at.ToDatetime(tzinfo=UTC) == accepted.accepted_at
    assert decoded.request.position.y_m == -2.0
    assert decoded.request.burn_duration_s == 1.5
    assert decoded.config.propagation_time_s == 60.0
    assert decoded.config.sample_step_s == 0.01
    assert decoded.config.gravity_mps2 == 9.80665
    assert decoded.config.config_version == 0


def test_applied_config_reads_the_propagator_payload() -> None:
    message = config_pb2.ConfigApplied(
        service="propagator",
        config_version=5,
        ok=True,
        propagator=config_pb2.PropagatorConfig(propagation_time_s=20.0, sample_step_s=0.1),
    )
    empty = config_pb2.ConfigApplied(service="propagator", config_version=6, ok=True)

    assert applied_config(message).propagation_time_s == 20.0
    assert applied_config(message).config_version == 5
    assert applied_config(empty).sample_step_s is None


def test_service_status_message() -> None:
    report = StatusReport(ServiceState.DEGRADED, "KV bucket launch_window is missing", 0)

    message = service_status_message(report, instance="api-0", version="1.0", sent_at=FIXED_TIME)

    assert message.service == "api"
    assert message.state == service_pb2.ServiceStatus.STATE_DEGRADED
    assert message.detail == report.detail
    assert message.sent_at.ToDatetime(tzinfo=UTC) == FIXED_TIME
