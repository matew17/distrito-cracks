#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
[[ -z "$CMD" ]] && exit 0

deny() {
  jq -n --arg r "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

# Push explícito a main/master
if echo "$CMD" | grep -qE 'git[[:space:]]+push([[:space:]]+[^[:space:]]+)*[[:space:]]+(main|master)([[:space:]]|$)'; then
  deny "Direct push to main is forbidden. Use branch feat/<spec-id>-<slug> and open a PR."
fi

# Push estando parado en main
if echo "$CMD" | grep -qE 'git[[:space:]]+push'; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
    deny "Current branch is $BRANCH. Create a feature branch before pushing."
  fi
fi

# Evasión de gates
echo "$CMD" | grep -qE '\-\-no\-verify' \
  && deny "--no-verify is forbidden: it bypasses quality gates."
echo "$CMD" | grep -qE 'git[[:space:]]+push[^|;]*\-\-force' \
  && deny "Force push is forbidden."
echo "$CMD" | grep -qE 'git[[:space:]]+reset[[:space:]]+\-\-hard' \
  && deny "git reset --hard is forbidden. Use git revert."
echo "$CMD" | grep -qE 'gh[[:space:]]+pr[[:space:]]+merge' \
  && deny "Merging is a human decision."

# Destructivos de datos
echo "$CMD" | grep -qiE 'DROP[[:space:]]+TABLE|TRUNCATE[[:space:]]|prisma[[:space:]]+migrate[[:space:]]+reset' \
  && deny "Destructive database operation blocked."

exit 0
