"""Process-wide engine and Session factory."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import build_engine, load_config

_engine: Engine | None = None
_factory: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    global _engine, _factory
    if _engine is None:
        _engine = build_engine(load_config())
        _factory = sessionmaker(_engine, expire_on_commit=False)
    return _engine


def set_engine(engine: Engine | None) -> None:
    """Swap the engine (tests, scripts). None resets to lazy config loading."""
    global _engine, _factory
    if _engine is not None and _engine is not engine:
        _engine.dispose()
    _engine = engine
    _factory = sessionmaker(engine, expire_on_commit=False) if engine is not None else None


@contextmanager
def session_scope() -> Iterator[Session]:
    get_engine()
    assert _factory is not None
    with _factory() as session:
        yield session


def get_session() -> Iterator[Session]:
    """Generator form of session_scope, usable as a framework dependency."""
    with session_scope() as session:
        yield session
