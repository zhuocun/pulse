from datetime import datetime, timezone
from importlib import import_module
from typing import Any, Callable, Dict, Iterable, List, Optional, Protocol
from uuid import uuid4

from app import database
from app.config import Settings, settings


MONGODB = "mongoDB"
DYNAMODB = "dynamoDB"
POSTGRESQL = "postgreSQL"

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
        "createdAt",
        "updatedAt",
    },
    database.COLUMNS: {
        "_id",
        "columnName",
        "projectId",
        "index",
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
        "createdAt",
        "updatedAt",
    },
}

TABLES = tuple(TABLE_FIELDS.keys())

POSTGRES_SCHEMA = (
    'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',
    """
    CREATE TABLE IF NOT EXISTS users (
        _id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        username VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        "likedProjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS projects (
        _id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "projectName" VARCHAR(255) NOT NULL,
        organization VARCHAR(255) NOT NULL,
        "managerId" VARCHAR(255) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS columns (
        _id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "columnName" VARCHAR(255) NOT NULL,
        "projectId" VARCHAR(255) NOT NULL,
        index INTEGER NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS tasks (
        _id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "taskName" VARCHAR(255) NOT NULL,
        "coordinatorId" VARCHAR(255) NOT NULL,
        epic VARCHAR(255) NOT NULL,
        "columnId" VARCHAR(255) NOT NULL,
        note TEXT NOT NULL,
        type VARCHAR(255) NOT NULL,
        "projectId" VARCHAR(255) NOT NULL,
        "storyPoints" INTEGER NOT NULL,
        index INTEGER NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
)


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


def require_optional(package_name: str) -> Any:
    try:
        return import_module(package_name)
    except ImportError as exc:
        raise RuntimeError(
            f"{package_name} is required when DATABASE selects this backend"
        ) from exc


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
        validate_fields(name, data)
        return database.insert_one(name, data)

    def find_one(self, name: str, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
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


class DynamoDBRepository:
    def __init__(
        self,
        app_settings: Settings = settings,
        resource: Optional[Any] = None,
        client: Optional[Any] = None,
    ) -> None:
        kwargs = dynamodb_kwargs(app_settings)
        if resource is None or client is None:
            boto3 = require_optional("boto3")
            resource = resource or boto3.resource("dynamodb", **kwargs)
            client = client or boto3.client("dynamodb", **kwargs)

        self.resource = resource
        self.client = client
        self.table_prefix = app_settings.dynamodb_table_prefix

    def table_name(self, name: str) -> str:
        validate_table(name)
        return f"{self.table_prefix}{name}"

    def table(self, name: str) -> Any:
        return self.resource.Table(self.table_name(name))

    def ping(self) -> None:
        self.client.list_tables(Limit=1)

    def ensure_schema(self) -> None:
        existing = set(self.client.list_tables().get("TableNames", []))
        for name in TABLES:
            table_name = self.table_name(name)
            if table_name in existing:
                continue
            self.client.create_table(
                TableName=table_name,
                KeySchema=[{"AttributeName": "_id", "KeyType": "HASH"}],
                AttributeDefinitions=[{"AttributeName": "_id", "AttributeType": "S"}],
                BillingMode="PAY_PER_REQUEST",
            )
            self.client.get_waiter("table_exists").wait(TableName=table_name)

    def insert_one(self, name: str, data: Dict[str, Any]) -> Any:
        validate_fields(name, data)
        item_id = str(uuid4())
        payload = timestamped_payload(
            data,
            item_id=item_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
        self.table(name).put_item(Item=payload)
        return item_id

    def find_one(self, name: str, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        items = self.find_many(name, query)
        return items[0] if items else None

    def find_many(self, name: str, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        validate_fields(name, query)
        scan_kwargs: Dict[str, Any] = {}
        items = []
        while True:
            response = self.table(name).scan(**scan_kwargs)
            items.extend(response.get("Items", []))
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            scan_kwargs["ExclusiveStartKey"] = last_key
        return [item for item in items if matches(item, query)]

    def find_by_id(self, name: str, value: str) -> Optional[Dict[str, Any]]:
        response = self.table(name).get_item(Key={"_id": value})
        return response.get("Item")

    def update_by_id(
        self, name: str, value: str, data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        validate_fields(name, data)
        if self.find_by_id(name, value) is None:
            return None

        payload = update_payload(data, timestamp=datetime.now(timezone.utc).isoformat())
        expression_names = {
            f"#field{index}": key for index, key in enumerate(payload.keys())
        }
        expression_values = {
            f":value{index}": value for index, value in enumerate(payload.values())
        }
        assignments = [
            f"{field_name} = :value{index}"
            for index, field_name in enumerate(expression_names.keys())
        ]
        response = self.table(name).update_item(
            Key={"_id": value},
            UpdateExpression=f"SET {', '.join(assignments)}",
            ExpressionAttributeNames=expression_names,
            ExpressionAttributeValues=expression_values,
            ReturnValues="ALL_NEW",
        )
        return response.get("Attributes")

    def delete_by_id(self, name: str, value: str) -> Optional[Dict[str, Any]]:
        response = self.table(name).delete_item(
            Key={"_id": value},
            ReturnValues="ALL_OLD",
        )
        return response.get("Attributes")

    def delete_many(self, name: str, query: Dict[str, Any]) -> int:
        validate_fields(name, query)
        items = self.find_many(name, query)
        for item in items:
            self.delete_by_id(name, str(item["_id"]))
        return len(items)

    def serialize_document(
        self, document: Optional[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        return database.serialize_document(document)

    def serialize_documents(
        self, documents: Iterable[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        return database.serialize_documents(documents)


class PostgreSQLRepository:
    def __init__(
        self,
        app_settings: Settings = settings,
        connection_factory: Optional[Callable[[], Any]] = None,
    ) -> None:
        self.settings = app_settings
        if connection_factory is None:
            psycopg = require_optional("psycopg")
            dict_row = require_optional("psycopg.rows").dict_row

            def connection_factory() -> Any:
                return psycopg.connect(
                    self.connection_info(),
                    row_factory=dict_row,
                )

        self.connection_factory = connection_factory

    def connection_info(self) -> Any:
        if self.settings.postgres_uri:
            return self.settings.postgres_uri

        info: Dict[str, Any] = {
            "user": self.settings.postgres_user,
            "host": self.settings.postgres_host,
            "dbname": self.settings.postgres_database,
            "password": self.settings.postgres_password,
            "port": self.settings.postgres_port,
        }
        if self.settings.postgres_ssl:
            info["sslmode"] = "require"
        return info

    def ping(self) -> None:
        self.execute("SELECT 1")

    def ensure_schema(self) -> None:
        for statement in POSTGRES_SCHEMA:
            self.execute(statement)

    def execute(
        self,
        statement: str,
        values: Iterable[Any] = (),
        fetch: str = "none",
    ) -> Any:
        with self.connection_factory() as connection:
            with connection.cursor() as cursor:
                cursor.execute(statement, tuple(values))
                if fetch == "one":
                    return cursor.fetchone()
                if fetch == "all":
                    return cursor.fetchall()
        return None

    def insert_one(self, name: str, data: Dict[str, Any]) -> Any:
        validate_fields(name, data)
        item_id = str(uuid4())
        payload = timestamped_payload(data, item_id=item_id)
        fields = list(payload.keys())
        statement = (
            f"INSERT INTO {table_sql(name)} ({columns_sql(name, fields)}) "
            f"VALUES ({placeholders(fields)})"
        )
        self.execute(statement, [payload[field] for field in fields])
        return item_id

    def find_one(self, name: str, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        rows = self.find_many(name, query)
        return rows[0] if rows else None

    def find_many(self, name: str, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        validate_fields(name, query)
        statement = f"SELECT * FROM {table_sql(name)}"
        values = list(query.values())
        if query:
            statement += f" WHERE {where_sql(name, query)}"
        return list(self.execute(statement, values, fetch="all") or [])

    def find_by_id(self, name: str, value: str) -> Optional[Dict[str, Any]]:
        statement = f"SELECT * FROM {table_sql(name)} WHERE _id = %s"
        return self.execute(statement, [value], fetch="one")

    def update_by_id(
        self, name: str, value: str, data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        validate_fields(name, data)
        payload = update_payload(data)
        fields = list(payload.keys())
        set_clause = ", ".join(f"{column_sql(name, field)} = %s" for field in fields)
        statement = (
            f"UPDATE {table_sql(name)} SET {set_clause} WHERE _id = %s RETURNING *"
        )
        values = [payload[field] for field in fields] + [value]
        return self.execute(statement, values, fetch="one")

    def delete_by_id(self, name: str, value: str) -> Optional[Dict[str, Any]]:
        statement = f"DELETE FROM {table_sql(name)} WHERE _id = %s RETURNING *"
        return self.execute(statement, [value], fetch="one")

    def delete_many(self, name: str, query: Dict[str, Any]) -> int:
        validate_fields(name, query)
        statement = f"DELETE FROM {table_sql(name)}"
        values = list(query.values())
        if query:
            statement += f" WHERE {where_sql(name, query)}"
        statement += " RETURNING *"
        rows = self.execute(statement, values, fetch="all") or []
        return len(rows)

    def serialize_document(
        self, document: Optional[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        return database.serialize_document(document)

    def serialize_documents(
        self, documents: Iterable[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        return database.serialize_documents(documents)


def dynamodb_kwargs(app_settings: Settings) -> Dict[str, Any]:
    kwargs: Dict[str, Any] = {"region_name": app_settings.aws_region}
    if app_settings.dynamodb_endpoint_url:
        kwargs["endpoint_url"] = app_settings.dynamodb_endpoint_url
    return kwargs


def table_sql(name: str) -> str:
    validate_table(name)
    return name


def column_sql(name: str, field: str) -> str:
    validate_fields(name, {field: None})
    return field if field == "_id" else f'"{field}"'


def columns_sql(name: str, fields: Iterable[str]) -> str:
    return ", ".join(column_sql(name, field) for field in fields)


def placeholders(fields: Iterable[str]) -> str:
    return ", ".join("%s" for _ in fields)


def where_sql(name: str, query: Dict[str, Any]) -> str:
    return " AND ".join(f"{column_sql(name, field)} = %s" for field in query)


def build_repository(app_settings: Settings = settings) -> Repository:
    if app_settings.database == MONGODB:
        return MongoRepository()
    if app_settings.database == DYNAMODB:
        return DynamoDBRepository(app_settings)
    if app_settings.database == POSTGRESQL:
        return PostgreSQLRepository(app_settings)
    raise ValueError(f"Unknown database: {app_settings.database}")


repository = build_repository()
