"""Salezilla API — FastAPI application entry point."""

from dotenv import load_dotenv

load_dotenv()

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware

import core.config as config
from core.exceptions import BotApiException

# ── Logging ──────────────────────────────────────────────────────────────────

LOG_FORMAT = "{asctime}.{msecs:03.0f} {levelname} [{name}]: {message}"
logging.basicConfig(format=LOG_FORMAT, style="{", level=config.LOG_LEVEL, datefmt="%Y-%m-%d %H:%M:%S")

logger = logging.getLogger(__name__)

# ── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Salezilla API",
    version="0.1.0",
    description="AI-powered Sales CRM backend",
)

# ── Middleware ────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    SessionMiddleware,
    secret_key=config.JWT_ACCESS_SECRET_KEY,
    max_age=None,
)

# ── Routers ──────────────────────────────────────────────────────────────────

from api.routes.auth import router as auth_router
from api.routes.potentials import router as potentials_router
from api.routes.accounts import router as accounts_router
from api.routes.contacts import router as contacts_router
from api.routes.queue import router as queue_router
from api.routes.notes import router as notes_router
from api.routes.todos import router as todos_router
from api.routes.files import router as files_router
from api.routes.calls import router as calls_router
from api.routes.activities import router as activities_router
from api.routes.agents import router as agents_router
from api.routes.emails import router as emails_router
from api.routes.calendar import router as calendar_router
from api.routes.chat import router as chat_router
from api.routes.sales import router as sales_router
from api.routes.search import router as search_router
from api.routes.global_chat import router as global_chat_router
from api.routes.meeting_briefs import router as meeting_briefs_router

app.include_router(auth_router)
app.include_router(potentials_router)
app.include_router(accounts_router)
app.include_router(contacts_router)
app.include_router(queue_router)
app.include_router(notes_router)
app.include_router(todos_router)
app.include_router(files_router)
app.include_router(calls_router)
app.include_router(activities_router)
app.include_router(agents_router)
app.include_router(emails_router)
app.include_router(calendar_router)
app.include_router(chat_router)
app.include_router(sales_router)
app.include_router(search_router)
app.include_router(global_chat_router)
app.include_router(meeting_briefs_router)

# ── Exception handlers ───────────────────────────────────────────────────────


@app.exception_handler(BotApiException)
async def botapi_exception_handler(request: Request, exc: BotApiException):
    return JSONResponse(
        status_code=exc.code,
        headers=exc.headers,
        content={
            "status": exc.status,
            "message_code": exc.message_code,
            "message": exc.message,
            "data": exc.data,
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "status": "ERROR",
            "message_code": "ERR_VALIDATION",
            "message": "Request validation failed.",
            "data": exc.errors(),
        },
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=500,
        content={
            "status": "ERROR",
            "message_code": "ERR_INTERNAL",
            "message": "An unexpected error occurred.",
            "data": None,
        },
    )


# ── Health check ─────────────────────────────────────────────────────────────


@app.get("/health", tags=["system"])
async def health_check():
    return {"status": "ok"}


# ── Uvicorn entry point ─────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
