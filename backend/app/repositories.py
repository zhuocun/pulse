from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Protocol

from app import database
from app.config import Settings, settings


MONGODB = "mongoDB"

TABLE_FIELDS = {
    database.USERS: {
        "_id",
        "username",
        "email",
        "password",
        "likedProjects",
        "createdAt",
        "updatedAt",
    },
    database.PROJECTS: {
        "_id",
        "projectName",
        "organization",
        "managerId",
        # RBAC membership: a list of ``{"userId": str, "role": str}``
        # objects (roles: owner > editor > viewer). Optional on read so
        # pre-existing manager-only project docs keep deserializing; the
        # ``managerId`` is always treated as owner-level regardless.
        "memberIds",
        # Owning tenant (see ORGANIZATIONS). Not yet written by any
        # project flow -- registered now only so the organization
        # service's forward-compat delete guard can run its
        # ``find_many(PROJECTS, {"organizationId": ...})`` lookup without
        # tripping the field allowlist. Whitelisting a field never forces
        # it onto a document, so existing project behaviour is unchanged.
        "organizationId",
        # Soft-archive / soft-delete (trash) markers (PRD §5.4 / §5.5):
        # tz-aware ``datetime`` (serialized to ISO on read) or ``null``.
        # ``null`` means active; ``archivedAt`` set hides the project from
        # the default ``GET /projects`` listing, ``deletedAt`` set moves it
        # to trash. Both are managed ONLY by the archive/trash/restore
        # endpoints, never via a raw PUT /projects body.
        "archivedAt",
        "deletedAt",
        "createdAt",
        "updatedAt",
    },
    database.COLUMNS: {
        "_id",
        "columnName",
        "projectId",
        "index",
        # Per-column WIP limit (int). 0 / missing / negative means "no
        # limit". The drift detector already honours ``wipLimit``; this
        # field lets the board actually set it.
        "wipLimit",
        # Per-column "done" semantics: one of ``"todo"`` / ``"in_progress"``
        # / ``"done"``. The stored source of truth for done-ness (replacing
        # the locale-fragile column-name heuristic); ``be_tools`` prefers
        # ``category == "done"`` and only falls back to the name match when
        # the field is absent on legacy column docs.
        "category",
        "createdAt",
        "updatedAt",
    },
    database.TASKS: {
        "_id",
        "taskName",
        "coordinatorId",
        "epic",
        "columnId",
        "note",
        "type",
        "projectId",
        "storyPoints",
        "index",
        # Scheduling: ISO-8601 date strings (or null / empty).
        "startDate",
        "dueDate",
        # Free labels: a list of label ``_id`` strings (see LABELS).
        "labelIds",
        # Additional assignees beyond the single ``coordinatorId`` primary.
        "assigneeIds",
        # Sub-tasks: the ``_id`` of the parent task (null / empty = top-level).
        "parentTaskId",
        # Prerequisites: a ``list[str]`` of same-project task ids this task is
        # blocked by (the tasks that must be done first). Default ``[]``;
        # validated by ``task_service._depends_on_error`` to exist, stay
        # in-project, exclude self, and remain ACYCLIC (a DAG of arbitrary
        # depth -- distinct from the one-level ``parentTaskId`` tree).
        "dependsOn",
        # Urgency/importance: one of ``"none"`` / ``"low"`` / ``"medium"`` /
        # ``"high"`` / ``"urgent"``. Default ``"none"``; validated by
        # ``task_service._priority_error`` against the five-member enum. A
        # derived rank (urgent=4 … none=0) drives sorting server-side and is
        # never stored.
        "priority",
        # Completion stamp: a tz-aware ``datetime`` (serialized to an ISO
        # string on read) or ``null``. Server-managed (PRD §5.3 / AC-W8):
        # set when the task enters a ``category=="done"`` column and cleared
        # when it leaves. Never client-written -- ``task_service`` sets it
        # after the PUT allowlist filter so a client-sent value is dropped.
        "completedAt",
        # Soft-archive / soft-delete (trash) markers (PRD §5.4 / §5.5):
        # tz-aware ``datetime`` (serialized to ISO on read) or ``null``.
        # ``null`` means active; ``archivedAt`` set hides the task from the
        # board, ``deletedAt`` set moves it to trash. Both are managed only
        # by the archive/trash/restore endpoints, never via PUT /tasks.
        "archivedAt",
        "deletedAt",
        "createdAt",
        "updatedAt",
    },
    database.LABELS: {
        "_id",
        "projectId",
        "name",
        "color",
        "createdAt",
        "updatedAt",
    },
    database.COMMENTS: {
        "_id",
        "taskId",
        "projectId",
        "authorId",
        "body",
        "mentions",
        "createdAt",
        "updatedAt",
    },
    database.NOTIFICATIONS: {
        "_id",
        "userId",
        "kind",
        "refId",
        "projectId",
        "summary",
        "isRead",
        "createdAt",
        "updatedAt",
    },
    database.ORGANIZATIONS: {
        "_id",
        "name",
        # Globally-unique public handle for the tenant.
        "slug",
        # Org RBAC membership: a list of ``{"userId": str, "role": str}``
        # objects (roles: org_owner > org_admin > member). Managed only
        # through the dedicated member endpoints, never a raw PUT body.
        "members",
        # Free-form tenant settings blob (opaque to the service today).
        "settings",
        "createdAt",
        "updatedAt",
    },
}

TABLES = tuple(TABLE_FIELDS.keys())


class Repository(Protocol):
    def ping(self) -> None: ...

    def ensure_schema(self) -> None: ...

    def insert_one(self, name: str, data: Dict[str, Any]) -> Any: ...

    def find_one(
        self, name: str, query: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]: ...

    def find_many(self, name: str, query: Dict[str, Any]) -> List[Dict[str, Any]]: ...

    def find_by_id(self, name: str, value: str) -> Optional[Dict[str, Any]]: ...

    def update_by_id(
        self, name: str, value: str, data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]: ...

    def delete_by_id(self, name: str, value: str) -> Optional[Dict[str, Any]]: ...

    def delete_many(self, name: str, query: Dict[str, Any]) -> int: ...

    def serialize_document(
        self, document: Optional[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]: ...

    def serialize_documents(
        self, documents: Iterable[Dict[str, Any]]
    ) -> List[Dict[str, Any]]: ...

    def upsert_system_config(
        self, doc_id: str, document: Dict[str, Any]
    ) -> None: ...


def validate_table(name: str) -> None:
    if name not in TABLE_FIELDS:
        raise ValueError(f"Unknown table: {name}")


def validate_fields(name: str, data: Dict[str, Any]) -> None:
    validate_table(name)
    invalid = set(data) - TABLE_FIELDS[name]
    if invalid:
        raise ValueError(f"Unknown field(s) for {name}: {', '.join(sorted(invalid))}")


def timestamped_payload(
    data: Dict[str, Any],
    item_id: Optional[str] = None,
    timestamp: Optional[Any] = None,
) -> Dict[str, Any]:
    timestamp = timestamp or datetime.now(timezone.utc)
    payload = {**data, "createdAt": timestamp, "updatedAt": timestamp}
    if item_id is not None:
        payload["_id"] = item_id
    return payload


def update_payload(
    data: Dict[str, Any],
    timestamp: Optional[Any] = None,
) -> Dict[str, Any]:
    return {
        **{key: value for key, value in data.items() if key != "_id"},
        "updatedAt": timestamp or datetime.now(timezone.utc),
    }


def matches(item: Dict[str, Any], query: Dict[str, Any]) -> bool:
    return all(item.get(key) == value for key, value in query.items())


class MongoRepository:
    def ping(self) -> None:
        database.ping()

    def ensure_schema(self) -> None:
        database.ensure_indexes()

    def insert_one(self, name: str, data: Dict[str, Any]) -> Any:
        # ``system_config`` is owned by :mod:`app.system_config` and uses
        # a sentinel string ``_id`` (e.g. ``"jwt_secret"``) plus arbitrary
        # value fields, so the per-table field allowlist does not apply.
        if name == "system_config":
            return database.insert_one(name, data)
        validate_fields(name, data)
        return database.insert_one(name, data)

    def find_one(self, name: str, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        # See ``insert_one`` -- ``system_config`` documents are queried
        # by their sentinel ``_id`` and the schema-less collection skips
        # the allowlist entirely.
        if name == "system_config":
            return database.find_one(name, query)
        validate_fields(name, query)
        return database.find_one(name, query)

    def find_many(self, name: str, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        validate_fields(name, query)
        return database.find_many(name, query)

    def find_by_id(self, name: str, value: str) -> Optional[Dict[str, Any]]:
        return database.find_by_id(name, value)

    def update_by_id(
        self, name: str, value: str, data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        validate_fields(name, data)
        return database.update_by_id(name, value, data)

    def delete_by_id(self, name: str, value: str) -> Optional[Dict[str, Any]]:
        return database.delete_by_id(name, value)

    def delete_many(self, name: str, query: Dict[str, Any]) -> int:
        validate_fields(name, query)
        return database.delete_many(name, query)

    def serialize_document(
        self, document: Optional[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        return database.serialize_document(document)

    def serialize_documents(
        self, documents: Iterable[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        return database.serialize_documents(documents)

    def upsert_system_config(
        self, doc_id: str, document: Dict[str, Any]
    ) -> None:
        """Idempotent insert of a ``system_config`` row.

        Uses Mongo's ``$setOnInsert`` so a concurrent insert from
        another worker is a no-op rather than an overwrite; the caller
        re-reads after this returns to converge on the row that won
        the race.
        """

        payload = {key: value for key, value in document.items() if key != "_id"}
        database.collection("system_config").update_one(
            {"_id": doc_id},
            {"$setOnInsert": payload},
            upsert=True,
        )


def build_repository(app_settings: Settings = settings) -> Repository:
    if app_settings.database == MONGODB:
        return MongoRepository()
    raise ValueError(f"Unknown database: {app_settings.database}")


repository = build_repository()
