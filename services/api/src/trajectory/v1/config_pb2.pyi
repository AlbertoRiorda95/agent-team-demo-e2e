import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PropagatorConfig(_message.Message):
    __slots__ = ()
    PROPAGATION_TIME_S_FIELD_NUMBER: _ClassVar[int]
    SAMPLE_STEP_S_FIELD_NUMBER: _ClassVar[int]
    propagation_time_s: float
    sample_step_s: float
    def __init__(self, propagation_time_s: _Optional[float] = ..., sample_step_s: _Optional[float] = ...) -> None: ...

class ConfigSet(_message.Message):
    __slots__ = ()
    SERVICE_FIELD_NUMBER: _ClassVar[int]
    CONFIG_VERSION_FIELD_NUMBER: _ClassVar[int]
    PROPAGATOR_FIELD_NUMBER: _ClassVar[int]
    service: str
    config_version: int
    propagator: PropagatorConfig
    def __init__(self, service: _Optional[str] = ..., config_version: _Optional[int] = ..., propagator: _Optional[_Union[PropagatorConfig, _Mapping]] = ...) -> None: ...

class ConfigApplied(_message.Message):
    __slots__ = ()
    SERVICE_FIELD_NUMBER: _ClassVar[int]
    INSTANCE_FIELD_NUMBER: _ClassVar[int]
    CONFIG_VERSION_FIELD_NUMBER: _ClassVar[int]
    OK_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    APPLIED_AT_FIELD_NUMBER: _ClassVar[int]
    PROPAGATOR_FIELD_NUMBER: _ClassVar[int]
    service: str
    instance: str
    config_version: int
    ok: bool
    error: str
    applied_at: _timestamp_pb2.Timestamp
    propagator: PropagatorConfig
    def __init__(self, service: _Optional[str] = ..., instance: _Optional[str] = ..., config_version: _Optional[int] = ..., ok: _Optional[bool] = ..., error: _Optional[str] = ..., applied_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., propagator: _Optional[_Union[PropagatorConfig, _Mapping]] = ...) -> None: ...
