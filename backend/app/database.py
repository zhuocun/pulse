from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional
from uuid import UUID

from bson import ObjectId
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

from app.config import settings


USERS = "users"
PROJECTS = "projects"
COLUMNS = "columns"
TASKS = "tasks"
LABELS = "labels"
COMMENTS = "comments"
NOTIFICATIONS = "notifications"
ORGANIZATIONS = "organizations"
AGENT_MUTATION_JOURNAL = "agent_mutation_journal"
# Schema-less collection owned by :mod:`app.system_config` -- the
# canonical row today is ``{_id: "jwt_secret", value: <hex>}``; Mongo's
# implicit primary-key uniqueness on ``_id`` is the only index needed
# (no explicit ``create_index`` call required in :func:`ensure_indexes`).
SYSTEM_CONFIG = "system_config"


client: MongoClient = MongoClient(settings.mongo_uri, serverSelectionTimeoutMS=5000)
db: Database = client.get_default_database(default=settings.mongo_db)


def ping() -> None:
    client.admin.command("ping")


def ensure_indexes() -> None:
    collection(USERS).create_index("email", unique=True)
    collection(USERS).create_index("username", unique=True)
    collection(AGENT_MUTATION_JOURNAL).create_index(
        [("user_id", 1), ("proposal_id", 1)], unique=True
    )
    # Tenant slug is the public org handle and must be globally unique;
    # the membership index keeps the "orgs I belong to" scan (which today
    # filters in Python) cheap once it moves server-side.
    collection(ORGANIZATIONS).create_index("slug", unique=True)
    collection(ORGANIZATIONS).create_index("members.userId")


def collection(name: str) -> Collection:
    return db[name]


def now() -> datetime:
    return datetime.now(timezone.utc)


def object_id(value: str) -> Optional[ObjectId]:
    if not value or not ObjectId.is_valid(value):
        return None
    return ObjectId(value)


def serialize_document(document: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if document is None:
        return None

    output: Dict[str, Any] = {}
    for key, value in document.items():
        if key == "password":
            continue
        if key == "_id":
            output[key] = str(value)
        elif isinstance(value, (ObjectId, UUID)):
            output[key] = str(value)
        elif isinstance(value, datetime):
            output[key] = value.isoformat()
        elif isinstance(value, list):
            output[key] = [
                item.isoformat() if isinstance(item, datetime) else item
                for item in value
            ]
        else:
            output[key] = value
    return output


def serialize_documents(documents: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [serialize_document(document) for document in documents]  # type: ignore[list-item]


def insert_one(name: str, data: Dict[str, Any]) -> ObjectId:
    timestamp = now()
    payload = {**data, "createdAt": timestamp, "updatedAt": timestamp}
    result = collection(name).insert_one(payload)
    return result.inserted_id


def find_one(name: str, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return collection(name).find_one(query)


def find_many(name: str, query: Dict[str, Any]) -> List[Dict[str, Any]]:
    return list(collection(name).find(query))


def delete_many(name: str, query: Dict[str, Any]) -> int:
    result = collection(name).delete_many(query)
    return result.deleted_count


def find_by_id(name: str, value: str) -> Optional[Dict[str, Any]]:
    oid = object_id(value)
    if oid is None:
        return None
    return collection(name).find_one({"_id": oid})


def update_by_id(
    name: str, value: str, data: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    oid = object_id(value)
    if oid is None:
        return None

    update_data = {key: val for key, val in data.items() if key != "_id"}
    update_data["updatedAt"] = now()
    return collection(name).find_one_and_update(
        {"_id": oid},
        {"$set": update_data},
        return_document=True,
    )


def delete_by_id(name: str, value: str) -> Optional[Dict[str, Any]]:
    oid = object_id(value)
    if oid is None:
        return None
    return collection(name).find_one_and_delete({"_id": oid})
