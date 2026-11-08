"""Connection config and engine construction. Settings come from the environment, with backend/.env loaded
automatically (real environment variables win over .env).

Either one connection string:   DATABASE_URL=postgres://user:password@host:port/dbname?sslmode=require
or separate values:             DB_HOST, DB_PORT (5432), DB_USER, DB_PASSWORD, DB_NAME, DB_SSLMODE (require)
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError

from .errors import DatabaseUnavailable

BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")
CONNECT_TIMEOUT_S = 5
STATEMENT_TIMEOUT_MS = 5000
DRIVER = "postgresql+psycopg2"


def _env(name: str) -> str | None:
    return os.getenv(name) or None          # empty counts as unset


def load_config() -> dict[str, Any]:
    """Config dict {url, ...} or {host, port, user, password, dbname, sslmode} from the environment."""
    url = _env("DATABASE_URL")
    if url:
        return {"url": url}
    if _env("DB_HOST"):
        return {k: v for k, v in {
            "host": _env("DB_HOST"), "port": _env("DB_PORT") or 5432, "user": _env("DB_USER"),
            "password": _env("DB_PASSWORD"), "dbname": _env("DB_NAME"), "sslmode": _env("DB_SSLMODE"),
        }.items() if v}
    raise DatabaseUnavailable("Database not configured: set DATABASE_URL (or DB_HOST, DB_USER, DB_PASSWORD, "
                              "DB_NAME) in backend/.env")


def build_url(config: dict[str, Any]) -> URL:
    if config.get("url"):
        try:
            url = make_url(config["url"])
            url.port  # noqa: B018  (a placeholder like host:port parses lazily and fails here)
        except (ArgumentError, ValueError) as e:
            raise DatabaseUnavailable(f"Invalid database URL (check DATABASE_URL): {e}") from e
        if url.drivername in ("postgres", "postgresql"):
            url = url.set(drivername=DRIVER)
        if "sslmode" not in url.query:
            url = url.update_query_dict({"sslmode": config.get("sslmode", "require")})
        return url
    missing = [k for k in ("host", "user", "dbname") if not config.get(k)]
    if missing:
        raise DatabaseUnavailable(f"Database config missing: {', '.join(missing)}")
    return URL.create(
        DRIVER, username=config["user"], password=config.get("password"), host=config["host"],
        port=int(config.get("port", 5432)), database=config["dbname"],
        query={"sslmode": config.get("sslmode", "require")},
    )


def build_engine(config: dict[str, Any], *, read_only: bool = True,
                 statement_timeout_ms: int = STATEMENT_TIMEOUT_MS) -> Engine:
    """Engine with a 5 s connect timeout and a server-side statement timeout.

    The app uses the default read-only engine; only scripts/setup_db.py asks for a writable one.
    """
    options = f"-c statement_timeout={int(statement_timeout_ms)}"
    if read_only:
        options += " -c default_transaction_read_only=on"
    return create_engine(
        build_url(config),
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
        connect_args={"connect_timeout": CONNECT_TIMEOUT_S, "options": options},
    )
