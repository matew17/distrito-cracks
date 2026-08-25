---
description: Run the full Spec Kit analysis phase for a new feature, from one sentence to an approved task list.
argument-hint: [feature description in plain language]
allowed-tools: SlashCommand, Read, Write, Edit, Bash(git:*)
---

Run the analysis phase for: $ARGUMENTS

Execute these steps in order. Stop immediately if any step reports a blocking
problem — do not continue to the next.

1. Read `.specify/memory/constitution.md` and `docs/business-rules.md`.

2. Invoke `/speckit.specify` with the feature description, enriched with the
   BR-xx rules that apply. Name every applicable rule ID explicitly.

3. Invoke `/speckit.clarify`. Surface its questions to the user and STOP.
   Do not answer them yourself. Ambiguity resolved by guessing is the failure
   mode this whole workflow exists to prevent.
   Resume only after the user answers.

4. Invoke `/speckit.plan` with: NestJS, Prisma, PostgreSQL, module structure
   per the constitution. Any concurrency invariant must be planned as a
   database constraint.

5. Invoke `/speckit.tasks`.

6. Invoke `/speckit.analyze`. If it reports gaps or inconsistencies, report
   them and STOP.

7. Write the spec id to `.sdd/current-spec`.

8. Print a summary:
   - spec path
   - task count
   - BR-xx rules covered, and any rule in scope with no task
   - open questions

Then STOP. Spec approval is always human. Do not implement anything.
