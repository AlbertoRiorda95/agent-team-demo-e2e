import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from trajectory.v1 import launch_pb2 as _launch_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Sample(_message.Message):
    __slots__ = ()
    class Phase(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        PHASE_UNSPECIFIED: _ClassVar[Sample.Phase]
        PHASE_BURN: _ClassVar[Sample.Phase]
        PHASE_BALLISTIC: _ClassVar[Sample.Phase]
    PHASE_UNSPECIFIED: Sample.Phase
    PHASE_BURN: Sample.Phase
    PHASE_BALLISTIC: Sample.Phase
    SEQ_FIELD_NUMBER: _ClassVar[int]
    T_S_FIELD_NUMBER: _ClassVar[int]
    X_M_FIELD_NUMBER: _ClassVar[int]
    Y_M_FIELD_NUMBER: _ClassVar[int]
    Z_M_FIELD_NUMBER: _ClassVar[int]
    VX_MPS_FIELD_NUMBER: _ClassVar[int]
    VY_MPS_FIELD_NUMBER: _ClassVar[int]
    VZ_MPS_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    seq: int
    t_s: float
    x_m: float
    y_m: float
    z_m: float
    vx_mps: float
    vy_mps: float
    vz_mps: float
    phase: Sample.Phase
    def __init__(self, seq: _Optional[int] = ..., t_s: _Optional[float] = ..., x_m: _Optional[float] = ..., y_m: _Optional[float] = ..., z_m: _Optional[float] = ..., vx_mps: _Optional[float] = ..., vy_mps: _Optional[float] = ..., vz_mps: _Optional[float] = ..., phase: _Optional[_Union[Sample.Phase, str]] = ...) -> None: ...

class TrajectoryComputed(_message.Message):
    __slots__ = ()
    class EndReason(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        END_REASON_UNSPECIFIED: _ClassVar[TrajectoryComputed.EndReason]
        END_REASON_GROUND: _ClassVar[TrajectoryComputed.EndReason]
        END_REASON_TIME_LIMIT: _ClassVar[TrajectoryComputed.EndReason]
    END_REASON_UNSPECIFIED: TrajectoryComputed.EndReason
    END_REASON_GROUND: TrajectoryComputed.EndReason
    END_REASON_TIME_LIMIT: TrajectoryComputed.EndReason
    LAUNCH_ID_FIELD_NUMBER: _ClassVar[int]
    ACCEPTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPUTED_AT_FIELD_NUMBER: _ClassVar[int]
    REQUEST_FIELD_NUMBER: _ClassVar[int]
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    END_REASON_FIELD_NUMBER: _ClassVar[int]
    FLIGHT_TIME_S_FIELD_NUMBER: _ClassVar[int]
    MAX_HEIGHT_M_FIELD_NUMBER: _ClassVar[int]
    RANGE_M_FIELD_NUMBER: _ClassVar[int]
    SAMPLES_FIELD_NUMBER: _ClassVar[int]
    launch_id: str
    accepted_at: _timestamp_pb2.Timestamp
    computed_at: _timestamp_pb2.Timestamp
    request: _launch_pb2.LaunchRequest
    config: _launch_pb2.PropagationConfig
    end_reason: TrajectoryComputed.EndReason
    flight_time_s: float
    max_height_m: float
    range_m: float
    samples: _containers.RepeatedCompositeFieldContainer[Sample]
    def __init__(self, launch_id: _Optional[str] = ..., accepted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., computed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., request: _Optional[_Union[_launch_pb2.LaunchRequest, _Mapping]] = ..., config: _Optional[_Union[_launch_pb2.PropagationConfig, _Mapping]] = ..., end_reason: _Optional[_Union[TrajectoryComputed.EndReason, str]] = ..., flight_time_s: _Optional[float] = ..., max_height_m: _Optional[float] = ..., range_m: _Optional[float] = ..., samples: _Optional[_Iterable[_Union[Sample, _Mapping]]] = ...) -> None: ...

class TrajectoryStored(_message.Message):
    __slots__ = ()
    LAUNCH_ID_FIELD_NUMBER: _ClassVar[int]
    STORED_AT_FIELD_NUMBER: _ClassVar[int]
    SAMPLE_COUNT_FIELD_NUMBER: _ClassVar[int]
    launch_id: str
    stored_at: _timestamp_pb2.Timestamp
    sample_count: int
    def __init__(self, launch_id: _Optional[str] = ..., stored_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., sample_count: _Optional[int] = ...) -> None: ...
