"""A launch: a point mass pushed by a directed force for a burn duration.

SI units, frame ENU with z up and the origin on the ground (docs/api/openapi.yaml).
"""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

# Standard gravity, m/s^2: the only gravity of the demo (docs/design/launch-intake.md).
STANDARD_GRAVITY_MPS2 = 9.80665


@dataclass(frozen=True, slots=True)
class Position:
    x_m: float
    y_m: float
    z_m: float


@dataclass(frozen=True, slots=True)
class Launch:
    mass_kg: float
    position: Position
    azimuth_deg: float
    elevation_deg: float
    force_n: float
    burn_duration_s: float


@dataclass(frozen=True, slots=True)
class PropagationConfig:
    """The settings a launch is propagated with; version 0 means the defaults."""

    propagation_time_s: float
    sample_step_s: float
    gravity_mps2: float
    config_version: int


DEFAULT_CONFIG = PropagationConfig(
    propagation_time_s=60.0,
    sample_step_s=0.01,
    gravity_mps2=STANDARD_GRAVITY_MPS2,
    config_version=0,
)


@dataclass(frozen=True, slots=True)
class AppliedConfig:
    """The latest config the propagator reported as applied (`config.propagator.applied`).

    `propagation_time_s` and `sample_step_s` are None when the report carries no
    propagator payload.
    """

    ok: bool
    config_version: int
    propagation_time_s: float | None
    sample_step_s: float | None


def config_snapshot(applied: AppliedConfig | None) -> PropagationConfig:
    """The config attached to an accepted launch: the one in force, or the defaults.

    No report, a refused one (`ok` false) or one without a propagator payload
    gives the defaults. Gravity is always standard gravity.
    """
    if (
        applied is None
        or not applied.ok
        or applied.propagation_time_s is None
        or applied.sample_step_s is None
    ):
        return DEFAULT_CONFIG
    return PropagationConfig(
        propagation_time_s=applied.propagation_time_s,
        sample_step_s=applied.sample_step_s,
        gravity_mps2=STANDARD_GRAVITY_MPS2,
        config_version=applied.config_version,
    )


@dataclass(frozen=True, slots=True)
class AcceptedLaunch:
    launch_id: UUID
    accepted_at: datetime
    launch: Launch
    config: PropagationConfig
