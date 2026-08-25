# Guía de implementación — Herramienta SDD para Distrito Cracks

18 pasos. Cada uno tiene: **qué**, **por qué**, **contenido completo**,
**verificación**, y **la práctica que demuestra** (útil para la charla).

Hazlos en orden. Cada paso se verifica solo, sin depender del siguiente.

> **Convención:** los archivos que consume Claude Code (agentes, comandos,
> constitution) van en **inglés** — menos tokens y es donde el modelo está
> mejor calibrado. La documentación para humanos va en español.

---

## Índice

| #   | Paso                        | Práctica demostrada                     |
| --- | --------------------------- | --------------------------------------- |
| 0   | Prerrequisitos y estructura | —                                       |
| 1   | `CLAUDE.md`                 | Ownership boundaries                    |
| 2   | Instalar Spec Kit           | Spec-driven development                 |
| 3   | Constitution                | Single source of truth                  |
| 4   | Reglas de negocio con ID    | Traceability                            |
| 5   | `.sdd/config.json`          | Degrees of freedom                      |
| 6   | Hook `git-guard`            | Determinism boundary · Defense in depth |
| 7   | Hook `quality-gate`         | Validator loop                          |
| 8   | Hook `prisma-guard`         | Deterministic gates                     |
| 9   | Hook `telemetry`            | Eval-driven development                 |
| 10  | Agente `implementer`        | Blast radius limiting                   |
| 11  | Agente `test-writer`        | Independencia spec↔código               |
| 12  | Agente `reviewer`           | Judgment agents                         |
| 13  | Comando `/sdd-new`          | Orquestación de comandos                |
| 14  | Comando `/sdd-implement`    | Loop con escalada                       |
| 15  | Comando `/sdd-ship`         | Traceability end-to-end                 |
| 16  | Comando `/sdd-status`       | Observabilidad                          |
| 17  | Template de PR              | Traceability                            |
| 18  | Branch protection           | Defense in depth                        |

---

## Paso 0 — Prerrequisitos y estructura

**Qué.** Preparar el terreno.

**Contenido.**

```bash
# Verifica
node -v        # 20+
gh auth status # autenticado
git branch --show-current

# Crea la estructura
mkdir -p .claude/{agents,commands,hooks}
mkdir -p .sdd/runs
mkdir -p docs
mkdir -p .github

# jq es requisito de los hooks
jq --version || echo "instala jq"
```

Agrega a `.gitignore`:

```
.sdd/runs/
.sdd/blocked.md
```

**Verificación.** `ls -la .claude` muestra las tres carpetas.

---

## Paso 1 — `CLAUDE.md`

**Qué.** El contexto raíz que se carga en toda sesión.

**Por qué.** Es la capa más cara del sistema: está residente siempre. Va corto
y solo con lo que aplica a todo el repo. Nada específico de un agente o comando.

**Contenido** — `CLAUDE.md` en la raíz:

```markdown
# Distrito Cracks

NestJS + Prisma + PostgreSQL. Football field booking management.

## Commands

- `npm run build` · `npm run lint` · `npm test` · `npm run test:e2e`
- `npx prisma migrate dev --name <name>` · `npx prisma generate`

## Layout

- `src/<domain>/` — one NestJS module per bounded context
- `prisma/schema.prisma` — schema. Migrations in `prisma/migrations/`
- `specs/` — feature specs (Spec Kit)
- `docs/business-rules.md` — business rules, IDs BR-xx
- `.specify/memory/constitution.md` — non-negotiable principles

## Non-negotiables

Read `.specify/memory/constitution.md` before writing code.
Never push to main. Never use `--no-verify`.
```

**Verificación.** Menos de 30 líneas. Si crece, algo pertenece a otra capa.

**Práctica.** _Ownership boundaries_ — reglas globales aquí, procedimiento en
comandos, criterio en agentes.

---

## Paso 2 — Instalar Spec Kit

**Qué.** Bootstrap de la estructura SDD dentro del repo.

**Por qué.** Es un instalador, no una dependencia. Escribe archivos en tu
proyecto y después no lo necesitas.

**Contenido.**

```bash
uvx --from git+https://github.com/github/spec-kit.git specify init . --integration claude
```

Deja:

- `.specify/` — templates, scripts, `memory/constitution.md`
- `.claude/commands/speckit.*.md` — los slash commands

```bash
git add .specify .claude
git commit -m "chore: bootstrap spec kit"
```

**Verificación.** Abre Claude Code, escribe `/` y confirma que aparecen
`speckit.specify`, `speckit.plan`, `speckit.tasks`, `speckit.analyze`,
`speckit.clarify`, `speckit.implement`.

**Práctica.** _Spec-driven development._

---

## Paso 3 — Constitution

**Qué.** Los principios no negociables del proyecto.

**Por qué.** Es el artefacto de mayor apalancamiento del sistema. Todo comando
de Spec Kit lo consulta, y tus agentes también. Una regla escrita aquí una vez
se aplica en todo el pipeline — eso es lo que hace que el output sea estable
sin repetir instrucciones en cada prompt.

**Contenido** — reemplaza `.specify/memory/constitution.md`:

```markdown
# Distrito Cracks — Constitution

Non-negotiable. Any violation blocks the work.

## I. Architecture

- One NestJS module per bounded context.
- Controllers: input validation and HTTP mapping only. No business logic.
- Services: business rules. Repositories: Prisma access.
- All input validated with DTO + class-validator.
- No `any` in public signatures.

## II. Data

- Every `schema.prisma` change requires a versioned migration in the same commit.
- Never edit an applied migration. Never `prisma db push` outside local dev.
- Business invariants expressible as a Postgres constraint MUST live in the
  database, not only in the service. Concurrency-sensitive rules (overlap,
  uniqueness, capacity) always fall in this category.

## III. Testing

- Every rule BR-xx has at least one test naming its ID.
- Rules involving concurrency or time overlap are tested against a real
  Postgres instance, never a mocked Prisma client.
- Coverage is not the metric. Rule-to-test traceability is.
- A test that passes when its rule is broken is a defect.

## IV. Errors

- Domain exceptions mapped to HTTP in a global filter.
- Never expose Prisma error messages to clients.

## V. Git

- Conventional Commits. One commit per task.
- Branch `feat/<spec-id>-<slug>`.
- Direct push to main is forbidden. `--no-verify` is forbidden.
- Merge is always human.

## VI. Scope

- An agent implements the current task and nothing else.
- Out-of-scope improvements are reported, never applied.
```

**Verificación.** Cada principio es verificable — un revisor puede decidir
sí/no. Si alguno no lo es, reescríbelo o bórralo.

**Práctica.** _Single source of truth._

---

## Paso 4 — Reglas de negocio con ID

**Qué.** El catálogo de reglas de Distrito Cracks, cada una con ID estable.

**Por qué.** El ID es lo que permite la trazabilidad: viaja del spec al task,
al nombre del test, al commit y al PR. Sin ID, "¿está implementada la regla de
cancelación?" se responde leyendo código. Con ID, con un `grep`.

**Contenido** — `docs/business-rules.md`:

```markdown
# Business Rules — Distrito Cracks

Stable IDs. Never renumber. Deprecate instead.

| ID    | Rule                                                          | Enforced at                      |
| ----- | ------------------------------------------------------------- | -------------------------------- |
| BR-01 | No two active bookings may overlap on the same field          | DB constraint + integration test |
| BR-02 | Duration: min 60 min, max 180 min, in 30 min blocks           | DTO + unit test                  |
| BR-03 | Booking must fall within the field's operating hours          | Service + unit test              |
| BR-04 | Free cancellation up to 24h before start; after that, penalty | Service + unit test              |
| BR-05 | Max 3 active bookings per user                                | Service + integration test       |
| BR-06 | Cannot book a slot in the past                                | DTO + unit test                  |
| BR-07 | A field under maintenance accepts no bookings                 | Service + unit test              |

## Open questions

- BR-04: is the penalty a fixed amount or a percentage? What happens if the
  slot was already re-booked by someone else?
```

> **Deja BR-04 abierta a propósito.** En la demo, `/speckit.clarify` la va a
> detectar y preguntar. Es la mejor prueba de que el error se atrapa en
> markdown y no en producción.

**Verificación.** Cada regla declara _dónde_ se hace cumplir. Si alguna dice
"en el service" pero involucra concurrencia, está mal clasificada — revísala
contra el principio II de la constitution.

**Práctica.** _Traceability._

---

## Paso 5 — Configuración

**Qué.** Los niveles de autonomía y los límites.

**Por qué.** "Auto mode" no es un booleano. Los dos gates humanos son fijos en
todos los modos; lo demás se calibra.

**Contenido** — `.sdd/config.json`:

```json
{
  "mode": "semi",
  "modes": {
    "assisted": "Confirms before each task. For live demos.",
    "semi": "Autonomous until PR. Stops at spec gate and at PR.",
    "auto": "Autonomous from tasks.md to PR. Never merges."
  },
  "limits": {
    "maxFilesPerTask": 10,
    "maxReviewRetries": 3,
    "maxTasksPerRun": 5,
    "stopOnFirstFailure": true
  },
  "gates": {
    "specApproval": "always_human",
    "merge": "always_human"
  },
  "branchPrefix": "feat/"
}
```

**Verificación.** `jq . .sdd/config.json` parsea sin error.

**Práctica.** _Degrees of freedom_ — libertad calibrada explícitamente, no
implícita.

---

## Paso 6 — Hook `git-guard`

**Qué.** El bloqueo duro de operaciones peligrosas de git.

**Por qué.** Un `PreToolUse` que devuelve `deny` bloquea la herramienta incluso
en modo `bypassPermissions` o con `--dangerously-skip-permissions`. Los hooks
solo pueden **restringir** permisos, nunca ampliarlos. Nadie se los salta.
Este es el punto técnico más fuerte de tu charla.

**Contenido** — `.claude/hooks/git-guard.sh`:

```bash
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
```

`.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/git-guard.sh"
          }
        ]
      }
    ]
  }
}
```

```bash
chmod +x .claude/hooks/git-guard.sh
```

**Verificación** — pruébalo sin gastar un token:

```bash
echo '{"tool_input":{"command":"git push origin main"}}' | .claude/hooks/git-guard.sh
# → JSON con permissionDecision: deny

echo '{"tool_input":{"command":"git status"}}' | .claude/hooks/git-guard.sh
# → sin salida, exit 0
```

Después, en Claude Code, pídele que haga push a main. Debe bloquearse.

> **Nota de diseño:** usa **una sola** forma de señalizar. Este script usa
> `exit 0` + JSON. La alternativa es `exit 2` + stderr. No mezcles las dos.

**Práctica.** _Determinism boundary_ — esto no puede ser una instrucción en un
prompt porque un prompt se puede ignorar; un hook no.

---

## Paso 7 — Hook `quality-gate`

**Qué.** Lint, typecheck, tests y build automáticos.

**Por qué.** Dos niveles de velocidad. El chequeo rápido corre en cada edición;
el caro corre cuando un subagente termina. Si corres la suite completa en cada
`Edit`, el flujo se vuelve inusable.

**Contenido** — `.claude/hooks/fast-check.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
[[ "$FILE" != *.ts ]] && exit 0
[[ ! -f "$FILE" ]] && exit 0

npx eslint --fix "$FILE" >/dev/null 2>&1 || true
exit 0
```

`.claude/hooks/quality-gate.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

FAILED=""

npx tsc --noEmit 2>&1 | tail -20 > /tmp/tsc.log || FAILED="$FAILED typecheck"
npm run lint --silent > /tmp/lint.log 2>&1      || FAILED="$FAILED lint"
npm test --silent > /tmp/test.log 2>&1          || FAILED="$FAILED tests"
npm run build --silent > /tmp/build.log 2>&1    || FAILED="$FAILED build"

if [[ -n "$FAILED" ]]; then
  {
    echo "QUALITY GATE FAILED:$FAILED"
    echo "This is an automated gate, not a user denial. Fix the errors and retry."
    echo "--- output ---"
    for f in tsc lint test build; do
      [[ -s /tmp/$f.log ]] && { echo "[$f]"; tail -15 /tmp/$f.log; }
    done
  } >&2
  exit 2
fi
exit 0
```

Agrega a `.claude/settings.json` dentro de `"hooks"`:

```json
"PostToolUse": [
  {
    "matcher": "Edit|Write",
    "hooks": [
      { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/fast-check.sh" }
    ]
  }
],
"SubagentStop": [
  {
    "hooks": [
      { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/quality-gate.sh" }
    ]
  }
]
```

```bash
chmod +x .claude/hooks/fast-check.sh .claude/hooks/quality-gate.sh
```

**Verificación.** Rompe el build a propósito (mete un `const x: number = "a"`)
y corre `.claude/hooks/quality-gate.sh; echo $?` → debe dar `2` y explicar qué
falló.

> El mensaje dice explícitamente "automated gate, not a user denial". Sin eso,
> el modelo a veces interpreta el bloqueo como una negativa del usuario y se
> detiene en vez de corregir.

**Práctica.** _Validator loop_ — generar → validar → corregir → repetir.

---

## Paso 8 — Hook `prisma-guard`

**Qué.** Impedir cambios de schema sin migración.

**Por qué.** Es el error silencioso más común: el agente edita
`schema.prisma`, el código compila, los tests con mock pasan, y descubres en
deploy que la base no tiene la columna.

**Contenido** — `.claude/hooks/prisma-guard.sh`:

```bash
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
```

Agrega al array `PostToolUse` de `.claude/settings.json`:

```json
{
  "matcher": "Edit|Write",
  "hooks": [
    {
      "type": "command",
      "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/prisma-guard.sh"
    }
  ]
}
```

**Verificación.** Edita `schema.prisma` sin migrar y corre el hook manualmente
pasándole el `file_path`. Debe salir con `2`.

---

## Paso 9 — Hook `telemetry`

**Qué.** Registro de tokens, costo y duración por feature.

**Por qué.** Para la charla necesitas números, no anécdotas. Y para ti, es la
única forma de saber si el flujo vale lo que cuesta.

**Contenido** — `.claude/hooks/telemetry.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

INPUT=$(cat)
SPEC=$(cat .sdd/current-spec 2>/dev/null || echo "none")
mkdir -p .sdd/runs

echo "$INPUT" | jq -c --arg ts "$(date -Iseconds)" --arg spec "$SPEC" \
  '{ts: $ts, spec: $spec, session: .session_id, event: "stop"}' \
  >> ".sdd/runs/$(date +%Y-%m-%d).jsonl"

exit 0
```

En `.claude/settings.json`:

```json
"Stop": [
  {
    "hooks": [
      { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/telemetry.sh" }
    ]
  }
]
```

**Verificación.** Después de una sesión, `.sdd/runs/<fecha>.jsonl` tiene líneas.

**Práctica.** _Eval-driven development_ — no puedes mejorar lo que no mides.

---

## Paso 10 — Agente `implementer`

**Qué.** El subagente que escribe código de producción.

**Por qué.** Va en su propio contexto para que el ruido de la implementación no
contamine al reviewer. Y va **corto** — el detalle vive en la constitution y
el spec, que ya están en contexto.

**Contenido** — `.claude/agents/implementer.md`:

```markdown
---
name: implementer
description: Implements exactly one task from tasks.md. Use after a task is selected and before tests are written.
tools: Read, Edit, Write, Grep, Glob, Bash
---

Implement exactly one task.

## Inputs

- The task ID given to you
- `specs/<spec-id>/spec.md` and `tasks.md`
- `.specify/memory/constitution.md`
- `docs/business-rules.md`

## Rules

- Implement the given task and nothing else. Report out-of-scope issues; never fix them.
- Follow the constitution. Concurrency invariants go in the database, not the service.
- Schema change means a migration in the same change.
- Do not write tests. Do not edit `spec.md` or `tasks.md`.
- If the task needs more than 10 files, stop and report it as badly scoped.

## Done when

The task is implemented and `npm run build` passes.

## Output

- Files changed
- Rules BR-xx addressed
- Anything out of scope you found and did not touch
```

**Verificación.** El archivo cabe en una pantalla. Si necesitas más, algo
pertenece a la constitution.

**Práctica.** _Blast radius limiting_ + _progressive disclosure_.

---

## Paso 11 — Agente `test-writer`

**Qué.** El subagente que escribe tests.

**Por qué — y esto es lo más importante del diseño.** Escribe tests leyendo
**el spec, no el código**. Si lee la implementación, los tests confirman lo
que el código hace en vez de lo que el spec pide, y pierdes toda capacidad de
detectar que el implementer entendió mal. Vale una diapositiva entera.

**Contenido** — `.claude/agents/test-writer.md`:

```markdown
---
name: test-writer
description: Writes tests from the spec, without reading the implementation. Use after implementer finishes a task.
tools: Read, Write, Edit, Grep, Glob, Bash
---

Write tests for the given task from the specification.

## Critical rule

Do NOT read the implementation files for the task under test. Derive every
test from `spec.md` and `docs/business-rules.md` only. If a test fails, that
is a finding — report it, do not adjust the test to match the code.

## Naming

Every test naming a rule starts with its ID:
`it('BR-01: rejects an overlapping booking on the same field')`

## Coverage

- One test minimum per BR-xx in scope, including the failure path.
- Rules involving overlap, concurrency or capacity: integration test against
  a real Postgres. A mocked Prisma client cannot detect a race condition.
- Every test must fail if its rule is removed. A test that passes either way
  is a defect, not coverage.

## Forbidden

- Editing production code
- Empty or trivial assertions
- Weakening an assertion to make a test pass

## Output

- Tests written, mapped to BR-xx
- Any test that fails, with the discrepancy against the spec
```

**Verificación.** Rompe una regla en el código a propósito. El test
correspondiente debe fallar. Si pasa, el test no sirve.

---

## Paso 12 — Agente `reviewer`

**Qué.** La revisión de criterio, después de los gates deterministas.

**Por qué.** Los hooks ya verificaron lo verificable. El reviewer solo mira lo
que requiere juicio: si el diff hace lo que el spec pide, y nada más. Corre
después para no gastar tokens revisando código que no compila.

**Contenido** — `.claude/agents/reviewer.md`:

```markdown
---
name: reviewer
description: Reviews a diff against the spec and constitution. Use only after lint, typecheck, tests and build pass.
tools: Read, Grep, Glob, Bash
---

Review the current diff. Read-only: never edit files.

## Check in this order

1. Does the diff implement the task and nothing beyond it?
2. Does every BR-xx in scope have a test naming its ID?
3. Would each test fail if its rule were removed? Flag empty or trivial assertions.
4. Any constitution violation? Quote the principle.
5. Business logic in a controller?
6. Concurrency invariant enforced only in the service instead of the database?

## Do not review

Formatting, naming style, or anything the linter already covers.

## Output

Verdict on the first line: `APPROVED` or `CHANGES_REQUESTED`

For each finding:

- `file:line`
- What is wrong
- Which rule or principle it violates
- What must change

No praise. No suggestions outside the task scope.
```

**Verificación.** Mete una violación obvia (lógica de negocio en un
controller) y confirma que la detecta citando el principio I.

**Práctica.** _Judgment agents vs deterministic gates._

---

## Paso 13 — Comando `/sdd-new` (orquesta Spec Kit)

**Qué.** Un prompt en lenguaje natural dispara toda la fase de análisis.

**Por qué.** Es exactamente lo que pediste. Funciona porque el **SlashCommand
tool** permite que Claude invoque slash commands programáticamente y los
encadene. Requisito: los comandos invocados deben tener `description` en su
frontmatter — los de Spec Kit ya la traen.

**Contenido** — `.claude/commands/sdd-new.md`:

```markdown
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
```

**Uso.**

```
/sdd-new Nueva API para gestión de usuarios de las canchas
```

**Verificación.** Corre el comando. Debe detenerse en el paso 3 con las
preguntas de BR-04 y no continuar hasta que respondas.

> Si el SlashCommand tool no está habilitado en tu configuración, reemplaza
> "Invoke `/speckit.x`" por "Read `.claude/commands/speckit.x.md` and follow
> its instructions". Funciona igual, solo es menos directo.

**Práctica.** _Orquestación_ + gate humano explícito.

---

## Paso 14 — Comando `/sdd-implement`

**Qué.** El loop de implementación task por task.

**Por qué.** Aquí vive la secuencia de agentes y la escalada. Sin límite de
reintentos tienes un loop que quema tokens hasta que lo notas.

**Contenido** — `.claude/commands/sdd-implement.md`:

```markdown
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
6. Commit:
```

<type>(<scope>): <what changed>

Task: <task-id> · Spec: <spec-id>
Rules: BR-xx, BR-yy
Tests: <test file>

```
7. Mark the task done in `tasks.md`.

## Limits
- Stop after `maxTasksPerRun` tasks.
- In `assisted` mode, confirm with the user before each task.
- Never push. Never open a PR. That is `/sdd-ship`.

## Final output
Tasks completed, tasks remaining, anything blocked.
```

**Verificación.** Corre con una sola task. Debe hacer un commit atómico con el
BR-xx en el mensaje, y no hacer push.

**Práctica.** _Escalation path_ — un flujo semi-autónomo sin ruta de
recuperación no es semi-autónomo, es un flujo que te deja tirado.

---

## Paso 15 — Comando `/sdd-ship`

**Qué.** Push y creación del PR.

**Contenido** — `.claude/commands/sdd-ship.md`:

```markdown
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
```

**Verificación.** El PR se crea, la tabla de trazabilidad apunta a líneas
reales, y no hay merge.

---

## Paso 16 — Comando `/sdd-status`

**Qué.** Dónde va el flujo.

**Contenido** — `.claude/commands/sdd-status.md`:

```markdown
---
description: Show current spec, task progress, blockers and run cost.
allowed-tools: Read, Bash(git:*), Bash(jq:*), Grep, Glob
---

Report, in this order and nothing else:

1. Active spec (`.sdd/current-spec`) and current branch
2. Task progress: done / total, and the next pending task
3. `.sdd/blocked.md` if it exists — task, attempts, last finding
4. BR-xx rules with no test referencing them (grep the test files)
5. Last run summary from `.sdd/runs/`

Plain output. No suggestions unless something is blocked.
```

**Verificación.** Barato de construir, y en vivo te evita hacer scroll.

---

## Paso 17 — Template de PR

**Contenido** — `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## Spec

`specs/<spec-id>/spec.md`

## Business rules

| ID    | Rule | Test                |
| ----- | ---- | ------------------- |
| BR-xx |      | `file.spec.ts:line` |

## Gates

- [ ] lint - [ ] typecheck - [ ] tests - [ ] build
- [ ] reviewer: APPROVED

## Out of scope

<what the spec explicitly excluded>

## Cost

Tokens: · USD: · Duration:
```

---

## Paso 18 — Branch protection

**Qué.** La misma regla, en el servidor.

**Por qué.** _Defense in depth._ El hook protege del agente pero es local y se
puede borrar. La branch protection no.

**Contenido.**

```bash
gh api -X PUT repos/:owner/:repo/branches/main/protection \
  -f "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "enforce_admins=true" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false"
```

O por UI: Settings → Branches → Add rule sobre `main` → Require a pull request.

**Verificación.** Intenta un push directo a main desde tu terminal, fuera de
Claude Code. GitHub debe rechazarlo.

---

## Orden de verificación final

Cuando termines los 18 pasos, prueba el flujo completo con una feature real:

```
/sdd-new Gestión de usuarios: registro, listado, desactivación
   → responde las preguntas de clarify
   → revisa y aprueba el spec
/sdd-implement
/sdd-status
/sdd-ship
```

**Regla de verificación general:** para cada capa, rómpela a propósito. Si no
puedes hacerla fallar y ver cómo lo atrapa, no la controlas todavía.

| Capa         | Cómo romperla                      | Qué debe pasar                        |
| ------------ | ---------------------------------- | ------------------------------------- |
| git-guard    | `git push origin main`             | Bloqueo con razón                     |
| quality-gate | `const x: number = "a"`            | Exit 2, el agente corrige             |
| prisma-guard | Editar schema sin migrar           | Exit 2                                |
| test-writer  | Borrar una regla del service       | El test BR-xx falla                   |
| reviewer     | Lógica de negocio en un controller | CHANGES_REQUESTED citando principio I |
| escalada     | Forzar 3 rechazos                  | `.sdd/blocked.md` y detención         |
