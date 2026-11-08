"""Connection config and engine construction.

Config dict: {host, port, user, password, dbname, sslmode="require"} or {url}.
Source order: DATABASE_URL env var, then the JSON file at DB_CONFIG_PATH
(default backend/db_config.json, git-ignored).
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError

from .errors import DatabaseUnavailable

BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG_PATH = BACKEND_DIR / "db_config.json"
CONNECT_TIMEOUT_S = 5
STATEMENT_TIMEOUT_MS = 5000
DRIVER = "postgresql+psycopg2"


def load_config() -> dict[str, Any]:
    url = os.getenv("DATABASE_URL")
    if url:
        return {"url": url}
    path = Path(os.getenv("DB_CONFIG_PATH", DEFAULT_CONFIG_PATH))
    if path.exists():
        return json.loads(path.read_text())
    raise DatabaseUnavailable(f"Database not configured: set DATABASE_URL or create {path}")


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
