"""Tests for :mod:`app.agents.errors` -- focused on new hardening additions.

Covers the ``_safe_cause_kind`` helper and the ``cause_kind`` / ``cause_message``
fields added to :class:`AgentExecutionError` in the cost/correctness hardening pass.
"""

from __future__ import annotations

from app.agents.errors import AgentExecutionError, _safe_cause_kind


# ---------------------------------------------------------------------------
# _safe_cause_kind -- classification by exception class name/module
# ---------------------------------------------------------------------------


def test_safe_cause_kind_timeout_by_name() -> None:
    class MyTimeoutError(Exception):
        pass

    assert _safe_cause_kind(MyTimeoutError()) == "timeout_error"


def test_safe_cause_kind_timeout_by_qualname_variant() -> None:
    class RequestTimeout(Exception):
        pass

    assert _safe_cause_kind(RequestTimeout()) == "timeout_error"


class _PsycopgError(Exception):
    """Simulate psycopg.OperationalError without requiring psycopg."""


# Give it a psycopg-like module path at definition time via __module__
_PsycopgError.__module__ = "psycopg.errors"


class _OperationalError(Exception):
    """Class whose qualname contains 'operational'."""


class _DatabaseConnectionError(Exception):
    """Class whose qualname contains 'database'."""


class _DBError(Exception):
    """Class whose qualname ends in 'db'."""


def test_safe_cause_kind_database_by_module() -> None:
    assert _safe_cause_kind(_PsycopgError()) == "database_error"


def test_safe_cause_kind_database_by_qualname_operational() -> None:
    assert _safe_cause_kind(_OperationalError()) == "database_error"


def test_safe_cause_kind_database_by_qualname_database() -> None:
    assert _safe_cause_kind(_DatabaseConnectionError()) == "database_error"


def test_safe_cause_kind_database_by_qualname_db() -> None:
    assert _safe_cause_kind(_DBError()) == "database_error"


class _ConnectionRefusedError(Exception):
    """Class whose qualname contains 'connection'."""


class _SSLError(Exception):
    """Class whose qualname contains 'ssl'."""


class _HttpError(Exception):
    """Class whose qualname contains 'http'."""


class _NetworkError(Exception):
    """Class whose qualname contains 'network'."""


def test_safe_cause_kind_network_by_qualname_connection() -> None:
    assert _safe_cause_kind(_ConnectionRefusedError()) == "network_error"


def test_safe_cause_kind_network_by_qualname_ssl() -> None:
    assert _safe_cause_kind(_SSLError()) == "network_error"


def test_safe_cause_kind_network_by_qualname_http() -> None:
    assert _safe_cause_kind(_HttpError()) == "network_error"


def test_safe_cause_kind_network_by_qualname_network() -> None:
    assert _safe_cause_kind(_NetworkError()) == "network_error"


class _HttpxError(Exception):
    """Simulate httpx._exceptions.ConnectError."""


_HttpxError.__module__ = "httpx._exceptions"


def test_safe_cause_kind_network_by_module_httpx() -> None:
    assert _safe_cause_kind(_HttpxError()) == "network_error"


def test_safe_cause_kind_unknown_for_generic_value_error() -> None:
    assert _safe_cause_kind(ValueError("nope")) == "unknown_error"


def test_safe_cause_kind_unknown_for_runtime_error() -> None:
    assert _safe_cause_kind(RuntimeError("boom")) == "unknown_error"


# ---------------------------------------------------------------------------
# AgentExecutionError -- cause_kind and cause_message fields
# ---------------------------------------------------------------------------


def test_agent_execution_error_cause_kind_database() -> None:
    err = AgentExecutionError("svc", cause=_OperationalError("conn reset"))
    assert err.detail["details"]["cause_kind"] == "database_error"


def test_agent_execution_error_cause_kind_unknown() -> None:
    err = AgentExecutionError("svc", cause=ValueError("bad value"))
    assert err.detail["details"]["cause_kind"] == "unknown_error"


def test_agent_execution_error_cause_kind_none_when_no_cause() -> None:
    err = AgentExecutionError("svc")
    assert err.detail["details"]["cause_kind"] is None


def test_agent_execution_error_cause_message_truncated() -> None:
    long_msg = "x" * 300
    err = AgentExecutionError("svc", cause=ValueError(long_msg))
    assert len(err.detail["details"]["cause_message"]) == 200


def test_agent_execution_error_cause_message_short_passthrough() -> None:
    err = AgentExecutionError("svc", cause=ValueError("short"))
    assert err.detail["details"]["cause_message"] == "short"


def test_agent_execution_error_cause_message_none_when_no_cause() -> None:
    err = AgentExecutionError("svc")
    assert err.detail["details"]["cause_message"] is None


def test_agent_execution_error_backward_compat_cause_field() -> None:
    """``details["cause"]`` still holds the raw class name for existing callers."""

    err = AgentExecutionError("svc", cause=ValueError("oops"))
    assert err.detail["details"]["cause"] == "ValueError"
