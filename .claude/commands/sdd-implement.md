---
description: Implement approved tasks one at a time with implementer, test-writer, quality gates and reviewer.
argument-hint: [optional task id; default is next pending task]
allowed-tools: Task, Read, Edit, Write, Bash, Grep, Glob
---

Implement tasks from the approved spec. Target: $ARGUMENTS (empty = next pending).

## Preconditions — verify before anything

- `.sdd/current-spec` exists
- `specs/<id>/tasks.md` exists
- Current branch is NOT main. If it is, create `feat/<spec-id>-<slug>` first.
- Read `.sdd/config.json` for limits

If any fails, stop and report.

## Per task

1. Delegate to `implementer` with the task id.
2. Delegate to `test-writer` with the same task id.
3. Quality gates run automatically on subagent stop. If they fail, hand the
   errors back to `implementer` and retry. This is a gate, not a denial —
   keep working.
4. Delegate to `reviewer`.
   - `APPROVED` → continue
   - `CHANGES_REQUESTED` → back to step 1 with the findings
5. On the third `CHANGES_REQUESTED` for the same task: write `.sdd/blocked.md`
   with task id, attempt count, every finding, and the last diff. Then STOP.
6. Commit: (): Task: · Spec: Rules: BR-xx, BR-yy Tests:
7. Mark the task done in `tasks.md`.

## Limits

- Stop after `maxTasksPerRun` tasks.
- In `assisted` mode, confirm with the user before each task.
- Never push. Never open a PR. That is `/sdd-ship`.

## Final output

Tasks completed, tasks remaining, anything blocked.
