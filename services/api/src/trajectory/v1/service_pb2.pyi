import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PipelineError(_message.Message):
    __slots__ = ()
    LAUNCH_ID_FIELD_NUMBER: _ClassVar[int]
    SERVICE_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    OCCURRED_AT_FIELD_NUMBER: _ClassVar[int]
    launch_id: str
    service: str
    subject: str
    message: str
    occurred_at: _timestamp_pb2.Timestamp
    def __init__(self, launch_id: _Optional[str] = ..., service: _Optional[str] = ..., subject: _Optional[str] = ..., message: _Optional[str] = ..., occurred_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ServiceStatus(_message.Message):
    __slots__ = ()
    class State(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        STATE_UNSPECIFIED: _ClassVar[ServiceStatus.State]
        STATE_OK: _ClassVar[ServiceStatus.State]
        STATE_DEGRADED: _ClassVar[ServiceStatus.State]
        STATE_DOWN: _ClassVar[ServiceStatus.State]
    STATE_UNSPECIFIED: ServiceStatus.State
    STATE_OK: ServiceStatus.State
    STATE_DEGRADED: ServiceStatus.State
    STATE_DOWN: ServiceStatus.State
    SERVICE_FIELD_NUMBER: _ClassVar[int]
    INSTANCE_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    DETAIL_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    CONFIG_VERSION_FIELD_NUMBER: _ClassVar[int]
    SENT_AT_FIELD_NUMBER: _ClassVar[int]
    service: str
    instance: str
    state: ServiceStatus.State
    detail: str
    version: str
    config_version: int
    sent_at: _timestamp_pb2.Timestamp
    def __init__(self, service: _Optional[str] = ..., instance: _Optional[str] = ..., state: _Optional[_Union[ServiceStatus.State, str]] = ..., detail: _Optional[str] = ..., version: _Optional[str] = ..., config_version: _Optional[int] = ..., sent_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
