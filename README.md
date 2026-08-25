# distrito-cracks

Booking API for padel/tennis court reservations. [NestJS](https://nestjs.com) 11 + [Prisma ORM](https://www.prisma.io) 7 on PostgreSQL 15 (local DB via Docker Compose).

The data model lives in `prisma/schema.prisma`: `Court`, `Customer`, and `Reservation` (with a `ReservationStatus` enum, plus recurring and training flags).

## Setup

```bash
npm install
cp .env.example .env
npm run db:up            # start Postgres in Docker
npm run prisma:generate  # generate the Prisma client
npm run prisma:deploy    # apply existing migrations
npm run start:dev
```

`npm run prisma:generate` is required after a fresh clone — the generated client lands in `src/generated/prisma`, which is gitignored.

## Prisma workflow

After **any** change to `prisma/schema.prisma`:

```bash
npm run prisma:migrate -- --name describe_your_change   # create + apply the migration
npm run prisma:generate                                 # update the TypeScript client
```

Both steps are needed. `migrate dev` writes the migration to `prisma/migrations/` and applies it, but it does **not** regenerate the client when the generator uses a custom `output` path — so your types stay stale until you run `prisma:generate`. Commit the new migration folder together with the schema change.

Other commands:

```bash
npm run prisma:deploy  # apply pending migrations without creating one (CI / production)
npm run prisma:studio  # browse the data in a GUI
npm run prisma:reset   # drop the DB, replay all migrations — destroys local data
```

### Notes

- Pin `prisma` to 7.x. The `latest` tag on npm is the Prisma 8 Platform CLI, which has no `migrate` or `generate` commands.
- `DATABASE_URL` is read from `.env` and used in two places: `prisma.config.ts` for migrations, and `PrismaService` for the runtime connection via the `@prisma/adapter-pg` driver adapter.
- Inject `PrismaService` anywhere — `PrismaModule` is `@Global()`.

## Database

```bash
npm run db:up    # start Postgres
npm run db:down  # stop it (the postgres_data volume persists)
```

## Other commands

```bash
npm run start:dev   # watch mode
npm run start:prod  # run the build from dist/
npm run build
npm run test        # unit tests
npm run test:e2e    # e2e tests
npm run lint
npm run format
```
