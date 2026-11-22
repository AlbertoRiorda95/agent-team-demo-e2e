"""A launch: a point mass pushed by a directed force for a burn duration.

SI units, frame ENU with z up and the origin on the ground (docs/api/openapi.yaml).
"""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


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
class AcceptedLaunch:
    launch_id: UUID
    accepted_at: datetime
    launch: Launch
