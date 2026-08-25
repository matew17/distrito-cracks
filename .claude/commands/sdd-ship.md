---
description: Push the feature branch and open a PR with full spec-to-test traceability.
allowed-tools: Bash(git:*), Bash(gh:*), Read, Write, Grep, Glob
---

Ship the current feature.

## Preconditions

- Not on main
- Working tree clean
- All tasks in `tasks.md` done, or the user explicitly asked for a partial PR
- Quality gates green

## Steps

1. `git push -u origin <current-branch>`
2. Build the PR body into `.sdd/pr-body.md` using `.github/PULL_REQUEST_TEMPLATE.md`.
   Fill the traceability table by grepping test files for BR-xx IDs. Every
   `file:line` must be real — verify each one. Never invent a reference.
3. `gh pr create --base main --title "<type>(<scope>): <summary>" --body-file .sdd/pr-body.md`
4. Print the PR URL.

## Never

Merge. Push to main. Use `--force` or `--no-verify`.
