import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Position(_message.Message):
    __slots__ = ()
    X_M_FIELD_NUMBER: _ClassVar[int]
    Y_M_FIELD_NUMBER: _ClassVar[int]
    Z_M_FIELD_NUMBER: _ClassVar[int]
    x_m: float
    y_m: float
    z_m: float
    def __init__(self, x_m: _Optional[float] = ..., y_m: _Optional[float] = ..., z_m: _Optional[float] = ...) -> None: ...

class LaunchRequest(_message.Message):
    __slots__ = ()
    MASS_KG_FIELD_NUMBER: _ClassVar[int]
    POSITION_FIELD_NUMBER: _ClassVar[int]
    AZIMUTH_DEG_FIELD_NUMBER: _ClassVar[int]
    ELEVATION_DEG_FIELD_NUMBER: _ClassVar[int]
    FORCE_N_FIELD_NUMBER: _ClassVar[int]
    BURN_DURATION_S_FIELD_NUMBER: _ClassVar[int]
    mass_kg: float
    position: Position
    azimuth_deg: float
    elevation_deg: float
    force_n: float
    burn_duration_s: float
    def __init__(self, mass_kg: _Optional[float] = ..., position: _Optional[_Union[Position, _Mapping]] = ..., azimuth_deg: _Optional[float] = ..., elevation_deg: _Optional[float] = ..., force_n: _Optional[float] = ..., burn_duration_s: _Optional[float] = ...) -> None: ...

class PropagationConfig(_message.Message):
    __slots__ = ()
    PROPAGATION_TIME_S_FIELD_NUMBER: _ClassVar[int]
    SAMPLE_STEP_S_FIELD_NUMBER: _ClassVar[int]
    GRAVITY_MPS2_FIELD_NUMBER: _ClassVar[int]
    CONFIG_VERSION_FIELD_NUMBER: _ClassVar[int]
    propagation_time_s: float
    sample_step_s: float
    gravity_mps2: float
    config_version: int
    def __init__(self, propagation_time_s: _Optional[float] = ..., sample_step_s: _Optional[float] = ..., gravity_mps2: _Optional[float] = ..., config_version: _Optional[int] = ...) -> None: ...

class LaunchAccepted(_message.Message):
    __slots__ = ()
    LAUNCH_ID_FIELD_NUMBER: _ClassVar[int]
    ACCEPTED_AT_FIELD_NUMBER: _ClassVar[int]
    REQUEST_FIELD_NUMBER: _ClassVar[int]
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    launch_id: str
    accepted_at: _timestamp_pb2.Timestamp
    request: LaunchRequest
    config: PropagationConfig
    def __init__(self, launch_id: _Optional[str] = ..., accepted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., request: _Optional[_Union[LaunchRequest, _Mapping]] = ..., config: _Optional[_Union[PropagationConfig, _Mapping]] = ...) -> None: ...
