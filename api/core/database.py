import logging
from contextlib import contextmanager
from typing import Generator
from urllib.parse import quote_plus

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

import core.config as config

logger = logging.getLogger(__name__)


# ── Connection string ────────────────────────────────────────────────────────

def _build_connection_string() -> str:
    return (
        f"DRIVER={{{config.MSSQL_DRIVER}}};"
        f"SERVER={config.MSSQL_SERVER};"
        f"DATABASE={config.MSSQL_DATABASE};"
        f"UID={config.MSSQL_USERNAME};"
        f"PWD={config.MSSQL_PASSWORD};"
        "TrustServerCertificate=yes;"
    )


# ── Engine ───────────────────────────────────────────────────────────────────

_conn_str = _build_connection_string()

engine = create_engine(
    "mssql+pyodbc:///?odbc_connect=" + quote_plus(_conn_str),
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)


# ── Base ─────────────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


# ── Session factory ──────────────────────────────────────────────────────────

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False,
)


@contextmanager
def get_session() -> Generator[Session, None, None]:
    """Sync context manager — auto-commits on clean exit, rolls back on error."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency — yields a session, commits on success."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
