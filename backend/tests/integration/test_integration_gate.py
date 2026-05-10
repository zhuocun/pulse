"""Optional integration gate (design-partner CI wiring).

Real Redis / Postgres / provider smoke belongs here.  The default unit suite
stays hermetic; enable with ``RUN_INTEGRATION=1`` in CI when secrets and
service containers are available.
"""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.integration


@pytest.mark.skipif(
    not os.environ.get("RUN_INTEGRATION"),
    reason="Set RUN_INTEGRATION=1 to exercise real-stack integration checks.",
)
def test_integration_gate_placeholder() -> None:
    assert True
