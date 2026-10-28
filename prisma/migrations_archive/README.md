# Archived migrations

These 43 migrations (14/08/2026 to 27/10/2026) are kept for history only.
Prisma no longer reads this folder.

They never rebuilt an empty database: `20260826093554_domain_model_refinement`
recreates types that the migrations before it had already created. Every
existing database was built with `prisma db push`. They are replaced by a
single baseline, `prisma/migrations/20261028000000_baseline`, which rebuilds
exactly the same schema.

## What to do with your own database

Check that your database matches the current schema:

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

- **The output is empty** (your database is up to date): record the baseline
  as applied. Nothing is replayed and no data is touched.

  ```bash
  npx prisma migrate resolve --applied 20261028000000_baseline
  npx prisma migrate deploy   # applies whatever came after the baseline
  ```

- **The output lists changes** (your database is behind or different): rebuild
  it. This deletes its data.

  ```bash
  npx prisma migrate reset
  ```

From now on, a new database (production included) is created with
`npx prisma migrate deploy` only, and schema changes go through new
migrations in `prisma/migrations/`, never through `db push`.
