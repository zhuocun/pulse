import pytest

from app import database
from app.config import Settings, env_bool, env_int
from app import repositories


def test_repository_helpers_and_errors(monkeypatch) -> None:
    assert env_bool("MISSING_BOOL") is False
    monkeypatch.setenv("TEST_BOOL", "yes")
    assert env_bool("TEST_BOOL") is True
    monkeypatch.setenv("BAD_INT", "not-a-number")
    with pytest.raises(RuntimeError, match="BAD_INT must be an integer"):
        env_int("BAD_INT", "1")

    assert repositories.timestamped_payload({"x": 1})["x"] == 1
    assert repositories.update_payload({"_id": "1", "x": 2})["x"] == 2
    assert repositories.matches({"x": 1}, {"x": 1}) is True
    assert repositories.matches({"x": 1}, {"x": 2}) is False

    with pytest.raises(ValueError, match="Unknown table"):
        repositories.validate_table("bad")
    with pytest.raises(ValueError, match="Unknown field"):
        repositories.validate_fields(database.USERS, {"bad": "field"})
    with pytest.raises(ValueError, match="Unknown database"):
        repositories.build_repository(Settings(database="bad"))


def test_build_repository_returns_mongo() -> None:
    settings = Settings(database=repositories.MONGODB)
    repository = repositories.build_repository(settings)
    assert isinstance(repository, repositories.MongoRepository)
