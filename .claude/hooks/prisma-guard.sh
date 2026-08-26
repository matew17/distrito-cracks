#!/usr/bin/env bash
set -uo pipefail

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
[[ "$FILE" != *"schema.prisma" ]] && exit 0

if git diff --quiet -- prisma/schema.prisma 2>/dev/null; then
  exit 0
fi

NEW_MIGRATIONS=$(git status --porcelain prisma/migrations 2>/dev/null | grep -c '^??' || echo 0)
if [[ "$NEW_MIGRATIONS" -eq 0 ]]; then
  {
    echo "schema.prisma changed without a migration."
    echo "Run: npx prisma migrate dev --name <descriptive_name>"
    echo "Constitution II: schema changes require a versioned migration in the same commit."
  } >&2
  exit 2
fi
exit 0
