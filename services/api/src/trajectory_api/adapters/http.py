"""The HTTP edge: the routes of docs/api/openapi.yaml.

Requests are validated here, before anything else: a body that does not match
`LaunchRequest` is rejected with 422 `application/problem+json`
(`ValidationProblem`) and the window is not touched. Then the use case
answers 202 (accepted and published), 429 (window held, `Retry-After`) or 503
(bus failure, nothing accepted). Every request is logged as one JSON line
(launch_id or none, outcome, status code, duration).
"""

import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated, Any, Literal, Protocol
from uuid import UUID

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from trajectory_api.application.ports import BusStatus, BusUnavailableError
from trajectory_api.application.use_cases import AcceptLaunch, CheckHealth, RateLimited
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


class Service(Protocol):
    """Something the app starts and stops with its lifespan."""

    async def start(self) -> None: ...

    async def stop(self) -> None: ...


class Lifecycle(BusStatus, Service, Protocol):
    """The bus connection the app starts and stops with its lifespan."""


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


def _rate_limit_problem(limited: RateLimited, window_s: int) -> JSONResponse:
    problem = {
        "type": "about:blank",
        "title": "Too many launches",
        "status": 429,
        "detail": (
            f"A launch was accepted less than {window_s} seconds ago: "
            f"retry in {limited.retry_after_s} s."
        ),
        "retry_after_s": limited.retry_after_s,
    }
    return JSONResponse(
        problem,
        status_code=429,
        media_type=PROBLEM_JSON,
        headers={"Retry-After": str(limited.retry_after_s)},
    )


def _bus_problem() -> JSONResponse:
    problem = {
        "type": "about:blank",
        "title": "Message bus unavailable",
        "status": 503,
        "detail": "The message bus is not reachable; nothing was accepted.",
    }
    return JSONResponse(problem, status_code=503, media_type=PROBLEM_JSON)


def create_app(
    bus: Lifecycle,
    accept_launch: AcceptLaunch,
    *,
    window_s: int,
    background: Sequence[Service] = (),
) -> FastAPI:
    check_health = CheckHealth(bus=bus)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        await bus.start()
        started: list[Service] = []
        try:
            for service in background:
                await service.start()
                started.append(service)
            yield
        finally:
            for service in reversed(started):
                await service.stop()
            await bus.stop()

    app = FastAPI(
        title="trajectory api",
        lifespan=lifespan,
        # docs/api/openapi.yaml is the contract: no generated schema is served
        openapi_url=None,
        docs_url=None,
        redoc_url=None,
    )

    @app.middleware("http")
    async def log_request(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        started = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            state = request.state
            extra: dict[str, Any] = {
                "event": "request",
                "method": request.method,
                "path": request.url.path,
                "status": status_code,
                "outcome": getattr(state, "outcome", "ok" if status_code < 500 else "error"),
                "launch_id": getattr(state, "launch_id", None),
                "duration_ms": round((time.perf_counter() - started) * 1000, 3),
            }
            for key in ("errors", "error"):
                value = getattr(state, key, None)
                if value is not None:
                    extra[key] = value
            level = logging.INFO if status_code < 500 else logging.ERROR
            logger.log(level, "request", extra=extra)

    @app.exception_handler(RequestValidationError)
    async def on_invalid_request(request: Request, error: RequestValidationError) -> JSONResponse:
        problem = _validation_problem(error)
        request.state.outcome = "invalid"
        request.state.errors = problem["errors"]
        return JSONResponse(problem, status_code=422, media_type=PROBLEM_JSON)

    @app.get("/healthz", response_model=Health)
    async def healthz() -> JSONResponse:
        status = check_health()
        code = 200 if status is HealthStatus.OK else 503
        return JSONResponse({"status": status.value}, status_code=code)

    @app.post(
        "/launches",
        status_code=202,
        response_model=LaunchAccepted,
        responses={429: {}, 503: {}},
    )
    async def create_launch(request: Request, body: LaunchRequest) -> Response:
        try:
            result = await accept_launch(body.to_domain())
        except BusUnavailableError as error:
            request.state.outcome = "bus_unavailable"
            request.state.error = str(error)
            return _bus_problem()
        if isinstance(result, RateLimited):
            request.state.outcome = "rate_limited"
            return _rate_limit_problem(result, window_s)
        request.state.outcome = "accepted"
        request.state.launch_id = str(result.launch_id)
        accepted = LaunchAccepted(launch_id=result.launch_id, accepted_at=result.accepted_at)
        return JSONResponse(accepted.model_dump(mode="json"), status_code=202)

    return app
