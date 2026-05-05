from datetime import datetime
from types import SimpleNamespace
from uuid import UUID

from bson import ObjectId

from app import database
from app.repositories import MongoRepository


class FakeCollection:
    def __init__(self) -> None:
        self.documents = []
        self.indexes = []

    def create_index(self, key, unique=False):
        self.indexes.append((key, unique))

    def insert_one(self, payload):
        oid = ObjectId()
        self.documents.append({**payload, "_id": oid})
        return SimpleNamespace(inserted_id=oid)

    def find_one(self, query):
        return next((doc for doc in self.documents if self.matches(doc, query)), None)

    def find(self, query):
        return [doc for doc in self.documents if self.matches(doc, query)]

    def find_one_and_update(self, query, update, return_document=True):
        doc = self.find_one(query)
        if doc is None:
            return None
        doc.update(update["$set"])
        return doc

    def find_one_and_delete(self, query):
        doc = self.find_one(query)
        if doc is None:
            return None
        self.documents.remove(doc)
        return doc

    def delete_many(self, query):
        docs = self.find(query)
        for doc in docs:
            self.documents.remove(doc)
        return SimpleNamespace(deleted_count=len(docs))

    @staticmethod
    def matches(doc, query):
        return all(doc.get(key) == value for key, value in query.items())


class FakeDb:
    def __init__(self) -> None:
        self.collections = {}

    def __getitem__(self, name):
        self.collections.setdefault(name, FakeCollection())
        return self.collections[name]


def test_database_helpers(monkeypatch):
    fake_db = FakeDb()
    fake_admin = SimpleNamespace(command=lambda command: {"ok": command == "ping"})
    monkeypatch.setattr(database, "db", fake_db)
    monkeypatch.setattr(database, "client", SimpleNamespace(admin=fake_admin))

    database.ping()
    database.ensure_indexes()
    assert fake_db[database.USERS].indexes == [("email", True), ("username", True)]

    assert database.object_id("bad") is None
    oid = database.insert_one(database.USERS, {"email": "a@example.com"})
    assert database.object_id(str(oid)) == oid
    uuid_value = UUID("00000000-0000-0000-0000-000000000001")

    found = database.find_one(database.USERS, {"email": "a@example.com"})
    assert found is not None
    assert database.find_by_id(database.USERS, str(oid)) is found
    assert database.find_by_id(database.USERS, "bad") is None
    assert database.find_many(database.USERS, {}) == [found]
    assert database.delete_many(database.TASKS, {"projectId": "missing"}) == 0

    serialized = database.serialize_document(
        {
            "_id": oid,
            "password": "hidden",
            "createdAt": datetime(2026, 1, 1),
            "items": [datetime(2026, 1, 2), "x"],
            "owner": oid,
            "externalId": uuid_value,
        }
    )
    assert serialized == {
        "_id": str(oid),
        "createdAt": "2026-01-01T00:00:00",
        "items": ["2026-01-02T00:00:00", "x"],
        "owner": str(oid),
        "externalId": str(uuid_value),
    }
    assert database.serialize_document(None) is None
    assert database.serialize_documents([found])[0]["email"] == "a@example.com"

    updated = database.update_by_id(
        database.USERS,
        str(oid),
        {"email": "b@example.com"},
    )
    assert updated["email"] == "b@example.com"
    assert database.update_by_id(database.USERS, "bad", {"email": "c"}) is None

    deleted = database.delete_by_id(database.USERS, str(oid))
    assert deleted is updated
    assert database.delete_by_id(database.USERS, "bad") is None

    repository = MongoRepository()
    repository.ping()
    repository.ensure_schema()
    repo_oid = repository.insert_one(database.PROJECTS, {"projectName": "Repo"})
    assert repository.find_one(database.PROJECTS, {"projectName": "Repo"}) is not None
    assert len(repository.find_many(database.PROJECTS, {})) == 1
    assert repository.find_by_id(database.PROJECTS, str(repo_oid)) is not None
    assert (
        repository.update_by_id(
            database.PROJECTS,
            str(repo_oid),
            {"projectName": "Repo updated"},
        )["projectName"]
        == "Repo updated"
    )
    assert repository.serialize_document({"_id": repo_oid}) == {"_id": str(repo_oid)}
    assert repository.serialize_documents([{"_id": repo_oid}]) == [
        {"_id": str(repo_oid)}
    ]
    assert repository.delete_many(database.TASKS, {"projectId": "missing"}) == 0
    assert repository.delete_by_id(database.PROJECTS, str(repo_oid)) is not None
