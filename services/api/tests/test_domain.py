"""Rules of the domain: the window, the config snapshot, the status report."""

from datetime import timedelta

import pytest

from tests.conftest import FIXED_TIME
from trajectory_api.domain.launch import DEFAULT_CONFIG, AppliedConfig, config_snapshot
from trajectory_api.domain.status import ServiceState, status_report
from trajectory_api.domain.window import remaining_s


@pytest.mark.parametrize(
    ("elapsed_s", "expected"),
    [
        (0, 300),
        (0.4, 300),
        (1, 299),
        (299, 1),
        (299.999, 1),
        (300, None),
        (301, None),
        (-5, 300),  # the api clock behind the NATS server: capped at the window
    ],
)
def test_remaining_seconds_are_rounded_up_within_the_window(
    elapsed_s: float, expected: int | None
) -> None:
    now = FIXED_TIME + timedelta(seconds=elapsed_s)

    assert remaining_s(300, FIXED_TIME, now) == expected


def test_defaults_without_an_applied_config() -> None:
    assert config_snapshot(None) == DEFAULT_CONFIG
    assert DEFAULT_CONFIG.propagation_time_s == 60
    assert DEFAULT_CONFIG.sample_step_s == 0.01
    assert DEFAULT_CONFIG.gravity_mps2 == 9.80665
    assert DEFAULT_CONFIG.config_version == 0


def test_defaults_when_the_applied_config_has_no_propagator_payload() -> None:
    applied = AppliedConfig(ok=True, config_version=3, propagation_time_s=None, sample_step_s=None)

    assert config_snapshot(applied) == DEFAULT_CONFIG


def test_status_is_degraded_while_the_window_bucket_is_missing() -> None:
    assert status_report(True, True, 4).state is ServiceState.OK
    missing = status_report(True, False, 0)
    assert missing.state is ServiceState.DEGRADED
    assert "launch_window" in missing.detail
    assert status_report(False, True, 0).state is ServiceState.DEGRADED
