#!/usr/bin/env bash
# Convenience wrapper for the Board Copilot eval harness.
#
# Default invocation runs every fixture with the stub judge (no API
# calls, no cost).  Forward any extra args to the underlying CLI:
#
#   ./scripts/run_eval.sh                    # all agents, stub judge
#   ./scripts/run_eval.sh --judge claude     # LLM judge (Anthropic key required)
#   ./scripts/run_eval.sh --agent chat --max-fixtures 3
#
# Exits with the CLI's exit code (non-zero on any fixture failure).

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

python -m app.eval "$@"
