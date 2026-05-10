from dataclasses import replace

from starlette.applications import Starlette

from app.config import settings as global_settings
from app.main import _mount_mcp_if_enabled


def test_mount_mcp_noop_when_disabled() -> None:
    app = Starlette()
    cfg = replace(global_settings, mcp_enabled=False)
    _mount_mcp_if_enabled(app, cfg)
    assert not app.routes


def test_mount_mcp_registers_stack_when_enabled() -> None:
    app = Starlette()
    cfg = replace(global_settings, mcp_enabled=True)
    _mount_mcp_if_enabled(app, cfg)
    assert len(app.routes) == 1
