"""The HTTP edge: the routes of docs/api/openapi.yaml.

Requests are validated here, before anything else: a body that does not match
`LaunchRequest` is rejected with 422 `application/problem+json`
(`ValidationProblem`) and logged.
"""

import logging
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated, Any, Literal, Protocol
from uuid import UUID

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from trajectory_api.application.ports import BusStatus
from trajectory_api.application.use_cases import AcceptLaunch, CheckHealth
from trajectory_api.domain.health import HealthStatus
from trajectory_api.domain.launch import Launch, Position

logger = logging.getLogger(__name__)

PROBLEM_JSON = "application/problem+json"

# JSON numbers only: no strings, no booleans, no NaN or infinity.
Number = Annotated[float, Field(strict=True, allow_inf_nan=False)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PositionIn(_Strict):
    x_m: Number
    y_m: Number
    z_m: Annotated[Number, Field(ge=0)]


class LaunchRequest(_Strict):
    mass_kg: Annotated[Number, Field(gt=0)]
    position: PositionIn
    azimuth_deg: Annotated[Number, Field(ge=0, lt=360)]
    elevation_deg: Annotated[Number, Field(gt=0, lt=90)]
    force_n: Annotated[Number, Field(gt=0)]
    burn_duration_s: Annotated[Number, Field(gt=0)]

    def to_domain(self) -> Launch:
        p = self.position
        return Launch(
            mass_kg=self.mass_kg,
            position=Position(x_m=p.x_m, y_m=p.y_m, z_m=p.z_m),
            azimuth_deg=self.azimuth_deg,
            elevation_deg=self.elevation_deg,
            force_n=self.force_n,
            burn_duration_s=self.burn_duration_s,
        )


class LaunchAccepted(BaseModel):
    launch_id: UUID
    accepted_at: datetime


class Health(BaseModel):
    status: Literal["ok", "degraded"]


class Lifecycle(BusStatus, Protocol):
    """The bus connection the app starts and stops with its lifespan."""

    async def start(self) -> None: ...

    async def stop(self) -> None: ...


def json_pointer(loc: Sequence[int | str]) -> str:
    """The JSON pointer (RFC 6901) of a pydantic error location inside the body."""
    parts = list(loc[1:]) if loc and loc[0] == "body" else list(loc)
    return "".join("/" + str(p).replace("~", "~0").replace("/", "~1") for p in parts)


def _validation_problem(error: RequestValidationError) -> dict[str, Any]:
    errors: list[dict[str, str]] = []
    for item in error.errors():
        loc = item.get("loc", ())
        if item.get("type") == "json_invalid":
            # the position in the text is not a field of the document
            loc = ("body",)
        errors.append({"field": json_pointer(loc), "message": str(item.get("msg", ""))})
    return {
        "type": "about:blank",
        "title": "Invalid launch request",
        "status": 422,
        "detail": "The request has a wrong format or a value out of range.",
        "errors": errors,
    }


def create_app(
    bus: Lifecycle,
    accept_launch: AcceptLaunch,
) -> FastAPI:
    check_health = CheckHealth(bus=bus)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        await bus.start()
        try:
            yield
        finally:
            await bus.stop()

    app = FastAPI(
        title="trajectory api",
        lifespan=lifespan,
        # docs/api/openapi.yaml is the contract: no generated schema is served
        openapi_url=None,
        docs_url=None,
        redoc_url=None,
    )

    @app.exception_handler(RequestValidationError)
    async def on_invalid_request(request: Request, error: RequestValidationError) -> JSONResponse:
        problem = _validation_problem(error)
        logger.warning(
            "rejected invalid request",
            extra={
                "event": "validation",
                "path": request.url.path,
                "errors": problem["errors"],
            },
        )
        return JSONResponse(problem, status_code=422, media_type=PROBLEM_JSON)

    @app.get("/healthz", response_model=Health)
    async def healthz() -> JSONResponse:
        status = check_health()
        code = 200 if status is HealthStatus.OK else 503
        return JSONResponse({"status": status.value}, status_code=code)

    @app.post("/launches", status_code=202, response_model=LaunchAccepted)
    async def create_launch(body: LaunchRequest) -> LaunchAccepted:
        accepted = accept_launch(body.to_domain())
        logger.info(
            "launch accepted (placeholder: not published)",
            extra={"event": "launch_accepted", "launch_id": str(accepted.launch_id)},
        )
        return LaunchAccepted(launch_id=accepted.launch_id, accepted_at=accepted.accepted_at)

    return app
