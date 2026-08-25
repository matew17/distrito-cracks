#!/usr/bin/env bash
set -uo pipefail

INPUT=$(cat)
SPEC=$(cat .sdd/current-spec 2>/dev/null || echo "none")
mkdir -p .sdd/runs

echo "$INPUT" | jq -c --arg ts "$(date -Iseconds)" --arg spec "$SPEC" \
  '{ts: $ts, spec: $spec, session: .session_id, event: "stop"}' \
  >> ".sdd/runs/$(date +%Y-%m-%d).jsonl"

exit 0
