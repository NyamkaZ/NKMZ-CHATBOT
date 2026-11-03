import re
from contextlib import asynccontextmanager
import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings
from app.core.redis import get_redis, close_redis
from app.api.v1.router import api_router

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.processors.JSONRenderer(),
    ]
)
logger = structlog.get_logger()


IS_PRODUCTION = settings.ENVIRONMENT.lower() == "production"
_DEV_ORIGIN_RE = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$")
_ALLOWED_ORIGINS = set(settings.cors_origins_list) | (
    set()
    if IS_PRODUCTION
    else {
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    }
)


def _origin_allowed(origin: str) -> bool:
    if origin in _ALLOWED_ORIGINS:
        return True
    return not IS_PRODUCTION and bool(_DEV_ORIGIN_RE.match(origin))


def _cors_headers(request: Request) -> dict:
    origin = request.headers.get("origin") or ""
    # Only echo origins we actually allow — never reflect arbitrary ones.
    if not _origin_allowed(origin):
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Guest-Id,Accept,Origin",
        "Access-Control-Expose-Headers": "*",
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("starting_up", environment=settings.ENVIRONMENT)
    try:
        redis = await get_redis()
        await redis.ping()
        logger.info("redis_connected")
    except Exception as e:
        logger.error("redis_connection_failed", error=str(e))
    yield
    await close_redis()
    logger.info("shutdown_complete")


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS: dev allows any localhost port; production only CORS_ORIGINS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(_ALLOWED_ORIGINS),
    allow_origin_regex=None if IS_PRODUCTION else _DEV_ORIGIN_RE.pattern,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
        headers=_cors_headers(request),
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=_cors_headers(request),
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("unhandled_exception", path=request.url.path, error=str(exc))
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error"
            if IS_PRODUCTION
            else f"Internal server error: {exc}"
        },
        headers=_cors_headers(request),
    )


app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.options("/{full_path:path}")
async def options_handler(full_path: str, request: Request):
    """Ensure preflight always succeeds for allowed origins."""
    return JSONResponse(content={"ok": True}, headers=_cors_headers(request))


@app.get("/health")
async def health():
    return {"status": "ok", "service": settings.PROJECT_NAME}


@app.get("/health/ollama")
async def health_ollama():
    from app.services.llm.ollama import ollama_service

    result = await ollama_service.health_check()
    return {
        "status": "ok" if result.get("available") else "error",
        **result,
    }


@app.get("/")
async def root():
    return {
        "message": "AI Chatbot Platform API",
        "docs": "/docs",
        "version": "1.0.0",
    }
