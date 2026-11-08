"""Errors raised by the db layer. Callers map them to HTTP codes; the db layer never does."""
from __future__ import annotations


class DatabaseError(RuntimeError):
    """Base class for db-layer errors."""


class AccountNotFound(DatabaseError, LookupError):
    def __init__(self, account_id: int):
        super().__init__(f"Account {account_id} not found")
        self.account_id = account_id


class NoHistory(DatabaseError, LookupError):
    """The account exists but its baseline values have not been filled in yet."""

    def __init__(self, account_id: int):
        super().__init__(f"Account {account_id} has no monthly history")
        self.account_id = account_id


class DatabaseUnavailable(DatabaseError):
    """Not configured, unreachable, timed out, or authentication failed."""
