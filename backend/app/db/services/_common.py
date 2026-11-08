"""Shared helpers: run a SELECT, convert rows to dataclasses."""
from __future__ import annotations

import dataclasses
from decimal import Decimal
from typing import Any, TypeVar

from sqlalchemy import Executable, Result
from sqlalchemy.exc import InterfaceError, OperationalError
from sqlalchemy.orm import Session

from ..errors import DatabaseUnavailable

T = TypeVar("T")


def run(session: Session, stmt: Executable) -> Result[Any]:
    """Execute one statement; connection/timeout failures become DatabaseUnavailable."""
    try:
        return session.execute(stmt)
    except (OperationalError, InterfaceError) as e:
        session.rollback()
        raise DatabaseUnavailable(f"Database unavailable: {str(e.orig).strip()[:200]}") from e


def plain(value: Any) -> Any:
    return float(value) if isinstance(value, Decimal) else value


def build(cls: type[T], mapping: Any, **overrides: Any) -> T:
    """Build a dataclass from a row mapping, taking only the dataclass's fields."""
    names = [f.name for f in dataclasses.fields(cls)]  # type: ignore[arg-type]
    values = {n: plain(mapping[n]) for n in names if n not in overrides}
    return cls(**values, **overrides)
