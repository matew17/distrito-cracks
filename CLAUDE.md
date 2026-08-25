# Distrito Cracks

NestJS + Prisma + PostgreSQL + Jest. Football field booking management.

## Commands

- `npm run build` · `npm run lint` · `npm test` · `npm run test:e2e`
- `npx prisma migrate dev --name <name>` · `npx prisma generate`

## Architecture & Code Conventions

1. **NestJS Standards:** Always use classes with appropriate decorators (`@Injectable()`, `@Controller()`, etc.). Dependency injection must be done through the constructor.
2. **Error Handling:** Use native NestJS HTTP Exceptions (e.g., `BadRequestException`, `NotFoundException`, `ConflictException`) when business rules are violated. Do not return generic 500 errors for user-facing validations.
3. **Typing:** Strict typing is mandatory. The use of `any` is strictly forbidden. Rely on Prisma-generated types and interfaces.
4. **Data Validation:** Use `class-validator` and `class-transformer` in DTOs to validate incoming request payloads.

## Layout

- `src/<domain>/` — one NestJS module per bounded context
- `prisma/schema.prisma` — schema. Migrations in `prisma/migrations/`
- `specs/` — feature specs (Spec Kit)
- `docs/business-rules.md` — business rules, IDs BR-xx
- `.specify/memory/constitution.md` — non-negotiable principles

## Non-negotiables

Read `.specify/memory/constitution.md` before writing code.
Never push to main. Never use `--no-verify`.
