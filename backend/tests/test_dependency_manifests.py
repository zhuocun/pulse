from __future__ import annotations

import re
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def _requirement_name(requirement: str) -> str:
    return re.split(r"[\[<>=!~;]", requirement, maxsplit=1)[0].strip().lower()


def test_requirements_txt_covers_runtime_and_ai_dependencies() -> None:
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text())
    requirements = {
        _requirement_name(line)
        for line in (ROOT / "requirements.txt").read_text().splitlines()
        if line.strip() and not line.startswith("#")
    }
    project = pyproject["project"]
    expected = {
        _requirement_name(requirement)
        for requirement in (
            *project["dependencies"],
            *project["optional-dependencies"]["ai"],
        )
    }

    assert requirements == expected
    assert not (ROOT / "uv.lock").exists()
