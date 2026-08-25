#!/usr/bin/env bash
set -uo pipefail

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
[[ "$FILE" != *.ts ]] && exit 0
[[ ! -f "$FILE" ]] && exit 0

npx eslint --fix "$FILE" >/dev/null 2>&1 || true
exit 0
