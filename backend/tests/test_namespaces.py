"""Tests for :mod:`app.store.namespaces`."""

from __future__ import annotations

from app.store import namespaces


def test_user_preferences_namespace() -> None:
    assert namespaces.user_preferences("u1") == ("users", "u1", "preferences")


def test_project_profile_namespace() -> None:
    assert namespaces.project_profile("p1") == ("projects", "p1", "profile")


def test_user_project_facts_namespace() -> None:
    assert namespaces.user_project_facts("u1", "p1") == (
        "users",
        "u1",
        "p1",
        "facts",
    )


def test_feedback_namespace() -> None:
    assert namespaces.feedback("p1", "thread") == ("feedback", "p1", "thread")


def test_constants_are_strings() -> None:
    assert isinstance(namespaces.USERS, str)
    assert isinstance(namespaces.PROJECTS, str)
    assert isinstance(namespaces.FEEDBACK, str)
