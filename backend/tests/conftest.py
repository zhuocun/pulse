from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from bson import ObjectId
import pytest
from fastapi.testclient import TestClient
from pytest import FixtureRequest

from app import database
from app import main
from app import security
from app.database import COLUMNS, PROJECTS, TASKS, USERS
from app.routers import health as health_router
from app.services import (
    auth_service,
    board_service,
    project_service,
    task_service,
    user_service,
)


# ---------------------------------------------------------------------------
# Shared polish-helper test scaffolding
#
# Catalog ``polish_*`` helpers branch on ``is_stub_model(model)``: stub →
# deterministic Python; real → ``model.with_structured_output(Schema,
# include_raw=True).invoke(...)``. ``is_not_stub`` flips the stub guard
# and ``structured_model`` returns a dummy model whose
# ``with_structured_output`` returns a runnable that yields a scripted
# ``{raw, parsed, parsing_error}`` dict -- the only shape the catalog
# helpers consume from a real provider.
# ---------------------------------------------------------------------------


def is_not_stub(_model: object) -> bool:
    return False


class StructuredRunnable:
    def __init__(self, payload: Any) -> None:
        self._payload = payload

    def invoke(self, _messages: Any, **_: Any) -> Any:
        return self._payload


def structured_model(
    *,
    parsed: Any = None,
    raw_message: Any = None,
    parsing_error: Any = None,
    raise_on_call: Optional[Exception] = None,
) -> Any:
    """Build a fake chat model with a scripted ``with_structured_output``.

    ``raise_on_call`` simulates a provider that does not implement
    structured output (e.g. an older model class). The catalog catches
    the exception and falls back to deterministic.
    """

    payload = {
        "raw": raw_message,
        "parsed": parsed,
        "parsing_error": parsing_error,
    }

    class _Model:
        def with_structured_output(
            self, _schema: Any, *, include_raw: bool = False
        ) -> Any:
            assert include_raw, "catalog must request the raw AIMessage"
            if raise_on_call is not None:
                raise raise_on_call
            return StructuredRunnable(payload)

    return _Model()


SERVICE_MODULES = [
    auth_service,
    board_service,
    project_service,
    task_service,
    user_service,
]


# Modules that import the repository directly at module top-level need
# the same monkeypatch as the service modules; otherwise tests run
# against the real Mongo singleton and crash without a live cluster.
EXTRA_REPOSITORY_MODULES = [main, health_router]


class FakeStore:
    def __init__(self) -> None:
        self.data: Dict[str, List[Dict[str, Any]]] = {
            USERS: [],
            PROJECTS: [],
            COLUMNS: [],
            TASKS: [],
        }

    def ping(self) -> None:
        return None

    def ensure_schema(self) -> None:
        return None

    def insert_one(self, name: str, data: Dict[str, Any]) -> Any:
        payload = dict(data)
        oid = payload.pop("_id", None)
        if oid is None:
            oid = ObjectId()
        timestamp = datetime.now(timezone.utc)
        self.data[name].append(
            {
                **payload,
                "_id": oid,
                "createdAt": timestamp,
                "updatedAt": timestamp,
            }
        )
        return oid

    def find_one(self, name: str, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return next(
            (item for item in self.data[name] if self.matches(item, query)),
            None,
        )

    def find_many(self, name: str, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        return [item for item in self.data[name] if self.matches(item, query)]

    def find_by_id(self, name: str, value: str) -> Optional[Dict[str, Any]]:
        return next(
            (item for item in self.data[name] if str(item.get("_id")) == str(value)),
            None,
        )

    def update_by_id(
        self, name: str, value: str, data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        item = self.find_by_id(name, value)
        if item is None:
            return None
        for key, val in data.items():
            if key != "_id":
                item[key] = val
        item["updatedAt"] = datetime.now(timezone.utc)
        return item

    def delete_by_id(self, name: str, value: str) -> Optional[Dict[str, Any]]:
        item = self.find_by_id(name, value)
        if item is None:
            return None
        self.data[name].remove(item)
        return item

    def delete_many(self, name: str, query: Dict[str, Any]) -> int:
        items = self.find_many(name, query)
        for item in items:
            self.data[name].remove(item)
        return len(items)

    @staticmethod
    def serialize_document(
        document: Optional[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        return database.serialize_document(document)

    @staticmethod
    def serialize_documents(
        documents: Iterable[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        return database.serialize_documents(documents)

    @staticmethod
    def matches(item: Dict[str, Any], query: Dict[str, Any]) -> bool:
        return all(item.get(key) == value for key, value in query.items())


def seed_agent_test_projects_if_absent(store: FakeStore) -> None:
    """Ensure synthetic ``project_id`` strings used in agent HTTP tests exist.

    Router gates require the JWT subject to manage ``project_id`` when it
    is present. Tests historically passed arbitrary ids; seed minimal
    project rows owned by the matching test users.
    """

    specs: tuple[tuple[str, str], ...] = (
        ("router-user", "p-cfg"),
        ("router-user", "p-real"),
        ("router-user", "p-budget-track"),
        ("agent-user", "p-budget-agent"),
        ("agent-user", "p-record"),
        ("agent-user", "p-stream-record"),
        ("agent-user", "blocked-project"),
        ("agent-user", "p-cite"),
        ("agent-user", "p-chat-cite"),
        ("agent-user", "p-est-cite"),
        ("idem-user", "p-replay"),
        ("idem-user", "p-idem"),
        ("fill-user", "p-already"),
        ("fill-user", "p-other"),
        ("fill-user", "p-no-stream"),
        ("fill-user", "p-fill-chat"),
        ("ai-user", "p-1"),
        ("ai-user", "p-idem"),
        ("ai-user", "p-budget"),
    )
    for manager_id, project_id in specs:
        if store.find_by_id(PROJECTS, project_id) is None:
            store.insert_one(
                PROJECTS,
                {
                    "_id": project_id,
                    "projectName": "Agent test project",
                    "organization": "TestOrg",
                    "managerId": manager_id,
                },
            )


@pytest.fixture()
def store(monkeypatch: pytest.MonkeyPatch) -> FakeStore:
    fake = FakeStore()
    object.__setattr__(
        security.settings,
        "jwt_secret",
        "test-secret-change-me-32-bytes-long",
    )
    for module in SERVICE_MODULES:
        monkeypatch.setattr(module, "repository", fake)
    for module in EXTRA_REPOSITORY_MODULES:
        monkeypatch.setattr(module, "repository", fake)
    return fake


@pytest.fixture()
def client(request: FixtureRequest) -> Iterable[TestClient]:
    store: FakeStore = request.getfixturevalue("store")
    seed_agent_test_projects_if_absent(store)
    with TestClient(main.app) as test_client:
        yield test_client
