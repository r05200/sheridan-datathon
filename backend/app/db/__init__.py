"""Database layer (Tiger Data / Postgres): read-only, parameterized, no business math.

    from app.db import session_scope, services
    with session_scope() as s:
        snap = services.get_account_snapshot(s, 20111)
"""
from . import services, types
from .config import build_engine, load_config
from .errors import AccountNotFound, DatabaseError, DatabaseUnavailable, NoHistory
from .session import get_engine, get_session, session_scope, set_engine

__all__ = [
    "services", "types", "build_engine", "load_config", "AccountNotFound", "DatabaseError",
    "DatabaseUnavailable", "NoHistory", "get_engine", "get_session", "session_scope", "set_engine",
]
