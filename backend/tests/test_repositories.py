from datetime import datetime
from types import SimpleNamespace
from typing import Any, Dict, Iterable, List, Optional

import pytest

from app import database
from app.config import Settings, env_bool, env_int
from app import repositories


class FakeWaiter:
    def __init__(self) -> None:
        self.waited_for = []

    def wait(self, **kwargs):
        self.waited_for.append(kwargs["TableName"])


class FakeDynamoTable:
    def __init__(self) -> None:
        self.items: Dict[str, Dict[str, Any]] = {}

    def put_item(self, Item):
        self.items[Item["_id"]] = Item

    def scan(self, **kwargs):
        items = list(self.items.values())
        if "ExclusiveStartKey" not in kwargs and len(items) > 1:
            return {"Items": items[:1], "LastEvaluatedKey": {"_id": items[0]["_id"]}}
        return {"Items": items[1:] if len(items) > 1 else items}

    def get_item(self, Key):
        item = self.items.get(Key["_id"])
        return {"Item": item} if item is not None else {}

    def update_item(
        self,
        Key,
        UpdateExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        ReturnValues,
    ):
        assert UpdateExpression.startswith("SET ")
        assert ReturnValues == "ALL_NEW"
        item = self.items[Key["_id"]]
        for name_key, field in ExpressionAttributeNames.items():
            value_key = name_key.replace("#field", ":value")
            item[field] = ExpressionAttributeValues[value_key]
        return {"Attributes": item}

    def delete_item(self, Key, ReturnValues):
        assert ReturnValues == "ALL_OLD"
        item = self.items.pop(Key["_id"], None)
        return {"Attributes": item} if item is not None else {}


class FakeDynamoResource:
    def __init__(self) -> None:
        self.tables: Dict[str, FakeDynamoTable] = {}

    def Table(self, name):
        self.tables.setdefault(name, FakeDynamoTable())
        return self.tables[name]


class FakeDynamoClient:
    def __init__(self, existing_tables: Optional[List[str]] = None) -> None:
        self.tables = set(existing_tables or [])
        self.created = []
        self.waiter = FakeWaiter()

    def list_tables(self, **kwargs):
        return {"TableNames": sorted(self.tables)}

    def create_table(self, **kwargs):
        self.tables.add(kwargs["TableName"])
        self.created.append(kwargs)

    def get_waiter(self, name):
        assert name == "table_exists"
        return self.waiter


class FakeBoto3:
    def __init__(
        self,
        resource: FakeDynamoResource,
        client: FakeDynamoClient,
    ) -> None:
        self.resource_instance = resource
        self.client_instance = client
        self.calls = []

    def resource(self, service, **kwargs):
        self.calls.append(("resource", service, kwargs))
        return self.resource_instance

    def client(self, service, **kwargs):
        self.calls.append(("client", service, kwargs))
        return self.client_instance


def test_dynamodb_repository_uses_boto3_factory(monkeypatch) -> None:
    resource = FakeDynamoResource()
    client = FakeDynamoClient(existing_tables=["test-users"])
    fake_boto3 = FakeBoto3(resource, client)
    monkeypatch.setattr(
        repositories,
        "import_module",
        lambda name: fake_boto3 if name == "boto3" else None,
    )

    settings = Settings(
        database=repositories.DYNAMODB,
        aws_region="us-west-2",
        dynamodb_endpoint_url="http://localhost:8000",
        dynamodb_table_prefix="test-",
    )
    repository = repositories.build_repository(settings)

    assert isinstance(repository, repositories.DynamoDBRepository)
    assert repository.table_name(database.USERS) == "test-users"
    assert fake_boto3.calls == [
        (
            "resource",
            "dynamodb",
            {
                "region_name": "us-west-2",
                "endpoint_url": "http://localhost:8000",
            },
        ),
        (
            "client",
            "dynamodb",
            {
                "region_name": "us-west-2",
                "endpoint_url": "http://localhost:8000",
            },
        ),
    ]

    repository.ping()
    repository.ensure_schema()
    assert "test-users" not in [table["TableName"] for table in client.created]
    assert "test-projects" in [table["TableName"] for table in client.created]
    assert client.waiter.waited_for == ["test-projects", "test-columns", "test-tasks"]


def test_dynamodb_repository_crud_and_serialization() -> None:
    repository = repositories.DynamoDBRepository(
        Settings(database=repositories.DYNAMODB, dynamodb_table_prefix="app-"),
        resource=FakeDynamoResource(),
        client=FakeDynamoClient(),
    )

    project_id = repository.insert_one(
        database.PROJECTS,
        {
            "projectName": "Jira Python",
            "organization": "OpenAI",
            "managerId": "user-id",
        },
    )
    second_id = repository.insert_one(
        database.PROJECTS,
        {
            "projectName": "Other",
            "organization": "OpenAI",
            "managerId": "user-id",
        },
    )

    stored = repository.find_by_id(database.PROJECTS, project_id)
    assert stored["projectName"] == "Jira Python"
    assert isinstance(stored["createdAt"], str)
    assert (
        repository.find_one(database.PROJECTS, {"projectName": "Other"})["_id"]
        == second_id
    )
    assert repository.find_one(database.PROJECTS, {"projectName": "Missing"}) is None
    assert len(repository.find_many(database.PROJECTS, {"managerId": "user-id"})) == 2

    updated = repository.update_by_id(
        database.PROJECTS,
        project_id,
        {"_id": project_id, "projectName": "Updated"},
    )
    assert updated["projectName"] == "Updated"
    assert isinstance(updated["updatedAt"], str)
    assert (
        repository.update_by_id(database.PROJECTS, "missing", {"projectName": "x"})
        is None
    )

    assert repository.serialize_document({"_id": project_id}) == {"_id": project_id}
    assert repository.serialize_documents([{"_id": second_id}]) == [{"_id": second_id}]
    assert repository.delete_many(database.PROJECTS, {"managerId": "user-id"}) == 2
    assert repository.find_many(database.PROJECTS, {"managerId": "user-id"}) == []
    assert repository.delete_many(database.PROJECTS, {"managerId": "user-id"}) == 0

    project_id = repository.insert_one(
        database.PROJECTS,
        {
            "projectName": "Jira Python",
            "organization": "OpenAI",
            "managerId": "user-id",
        },
    )
    assert repository.delete_by_id(database.PROJECTS, project_id)["_id"] == project_id
    assert repository.delete_by_id(database.PROJECTS, "missing") is None


class FakePostgresCursor:
    def __init__(self, store: "FakePostgresStore") -> None:
        self.store = store
        self.result_one = None
        self.result_all = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, statement, values):
        self.store.statements.append((statement, values))
        normalized = " ".join(statement.split())
        if normalized == "SELECT 1" or normalized.startswith("CREATE "):
            return
        if normalized.startswith("INSERT INTO "):
            self.insert(normalized, values)
        elif normalized.startswith("SELECT * FROM "):
            self.select(normalized, values)
        elif normalized.startswith("UPDATE "):
            self.update(normalized, values)
        elif normalized.startswith("DELETE FROM "):
            self.delete(normalized, values)

    def insert(self, statement: str, values: Iterable[Any]) -> None:
        table = statement.split("INSERT INTO ", 1)[1].split(" ", 1)[0]
        raw_fields = statement.split("(", 1)[1].split(")", 1)[0].split(", ")
        fields = [field.strip('"') for field in raw_fields]
        self.store.data[table].append(dict(zip(fields, values)))

    def select(self, statement: str, values: Iterable[Any]) -> None:
        table = statement.split("FROM ", 1)[1].split(" ", 1)[0]
        rows = list(self.store.data[table])
        if "WHERE" in statement:
            fields = [
                part.split(" = %s", 1)[0].strip('"')
                for part in statement.split(" WHERE ", 1)[1].split(" AND ")
            ]
            rows = [
                row
                for row in rows
                if all(row.get(field) == value for field, value in zip(fields, values))
            ]
        self.result_all = rows
        self.result_one = rows[0] if rows else None

    def update(self, statement: str, values: Iterable[Any]) -> None:
        table = statement.split("UPDATE ", 1)[1].split(" ", 1)[0]
        fields = [
            part.split(" = %s", 1)[0].strip('"')
            for part in statement.split(" SET ", 1)[1]
            .split(" WHERE ", 1)[0]
            .split(", ")
        ]
        *field_values, item_id = values
        row = next(
            (item for item in self.store.data[table] if item["_id"] == item_id),
            None,
        )
        if row is not None:
            row.update(dict(zip(fields, field_values)))
        self.result_one = row

    def delete(self, statement: str, values: Iterable[Any]) -> None:
        table = statement.split("DELETE FROM ", 1)[1].split(" ", 1)[0]
        values = list(values)
        if "WHERE" in statement:
            fields = [
                part.split(" = %s", 1)[0].strip('"')
                for part in statement.split(" WHERE ", 1)[1]
                .split(" RETURNING ", 1)[0]
                .split(" AND ")
            ]
            rows = [
                row
                for row in self.store.data[table]
                if all(row.get(field) == value for field, value in zip(fields, values))
            ]
        else:
            rows = list(self.store.data[table])
        for row in rows:
            self.store.data[table].remove(row)
        self.result_one = rows[0] if rows else None
        self.result_all = rows

    def fetchone(self):
        return self.result_one

    def fetchall(self):
        return self.result_all


class FakePostgresConnection:
    def __init__(self, store: "FakePostgresStore") -> None:
        self.store = store

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return FakePostgresCursor(self.store)


class FakePostgresStore:
    def __init__(self) -> None:
        self.statements = []
        self.data = {
            database.USERS: [],
            database.PROJECTS: [],
            database.COLUMNS: [],
            database.TASKS: [],
        }

    def connect(self):
        return FakePostgresConnection(self)


def test_postgresql_repository_uses_psycopg_factory(monkeypatch) -> None:
    store = FakePostgresStore()
    fake_psycopg = SimpleNamespace(
        connect=lambda connection_info, row_factory: store.connect()
    )
    fake_rows = SimpleNamespace(dict_row=object())

    def fake_import(name):
        return {"psycopg": fake_psycopg, "psycopg.rows": fake_rows}[name]

    monkeypatch.setattr(repositories, "import_module", fake_import)
    settings = Settings(database=repositories.POSTGRESQL, postgres_uri="postgres://db")
    repository = repositories.build_repository(settings)

    assert isinstance(repository, repositories.PostgreSQLRepository)
    assert repository.connection_info() == "postgres://db"
    repository.ping()
    assert store.statements[0] == ("SELECT 1", ())


def test_postgresql_repository_crud_schema_and_serialization() -> None:
    store = FakePostgresStore()
    settings = Settings(
        database=repositories.POSTGRESQL,
        postgres_uri="",
        postgres_user="jira",
        postgres_host="db.example.com",
        postgres_database="jira",
        postgres_password="secret",
        postgres_port=5433,
        postgres_ssl=True,
    )
    repository = repositories.PostgreSQLRepository(settings, store.connect)

    assert repository.connection_info() == {
        "user": "jira",
        "host": "db.example.com",
        "dbname": "jira",
        "password": "secret",
        "port": 5433,
        "sslmode": "require",
    }

    repository.ensure_schema()
    assert len(store.statements) == len(repositories.POSTGRES_SCHEMA)

    project_id = repository.insert_one(
        database.PROJECTS,
        {
            "projectName": "Jira Python",
            "organization": "OpenAI",
            "managerId": "user-id",
        },
    )
    assert repository.find_by_id(database.PROJECTS, project_id)["_id"] == project_id
    assert len(repository.find_many(database.PROJECTS, {})) == 1
    assert repository.find_one(database.PROJECTS, {"projectName": "Missing"}) is None
    assert (
        repository.find_one(database.PROJECTS, {"projectName": "Jira Python"})[
            "organization"
        ]
        == "OpenAI"
    )

    updated = repository.update_by_id(
        database.PROJECTS,
        project_id,
        {"_id": project_id, "organization": "OpenAI API"},
    )
    assert updated["organization"] == "OpenAI API"
    assert isinstance(updated["updatedAt"], datetime)

    assert repository.serialize_document({"_id": project_id}) == {"_id": project_id}
    assert repository.serialize_documents([{"_id": project_id}]) == [
        {"_id": project_id}
    ]
    assert (
        repository.delete_many(database.PROJECTS, {"organization": "OpenAI API"}) == 1
    )
    assert repository.find_many(database.PROJECTS, {}) == []

    project_id = repository.insert_one(
        database.PROJECTS,
        {
            "projectName": "Jira Python",
            "organization": "OpenAI",
            "managerId": "user-id",
        },
    )
    assert repository.delete_by_id(database.PROJECTS, project_id)["_id"] == project_id
    assert repository.delete_by_id(database.PROJECTS, "missing") is None


def test_repository_helpers_and_errors(monkeypatch) -> None:
    assert env_bool("MISSING_BOOL") is False
    monkeypatch.setenv("TEST_BOOL", "yes")
    assert env_bool("TEST_BOOL") is True
    monkeypatch.setenv("BAD_INT", "not-a-number")
    with pytest.raises(RuntimeError, match="BAD_INT must be an integer"):
        env_int("BAD_INT", "1")

    assert repositories.dynamodb_kwargs(Settings(aws_region="us-east-2")) == {
        "region_name": "us-east-2"
    }
    assert repositories.columns_sql(database.PROJECTS, ["_id", "projectName"]) == (
        '_id, "projectName"'
    )
    assert repositories.placeholders(["a", "b"]) == "%s, %s"
    assert repositories.where_sql(database.PROJECTS, {"projectName": "x"}) == (
        '"projectName" = %s'
    )
    assert repositories.timestamped_payload({"x": 1})["x"] == 1
    assert repositories.update_payload({"_id": "1", "x": 2})["x"] == 2
    assert repositories.matches({"x": 1}, {"x": 1}) is True
    assert repositories.matches({"x": 1}, {"x": 2}) is False

    with pytest.raises(ValueError, match="Unknown table"):
        repositories.validate_table("bad")
    with pytest.raises(ValueError, match="Unknown field"):
        repositories.validate_fields(database.USERS, {"bad": "field"})
    with pytest.raises(RuntimeError, match="missing"):
        repositories.require_optional("missing_backend_package")
    with pytest.raises(ValueError, match="Unknown database"):
        repositories.build_repository(Settings(database="bad"))
