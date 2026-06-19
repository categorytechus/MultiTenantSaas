# Alembic Migrations

This directory contains the Alembic configuration and migration history.

## Compressing / Squashing Migrations

Over time, Alembic migrations can grow significantly. To keep the history clean, we periodically compress all migrations into a single `initial_schema` file.

> [!WARNING]
> **DANGER: Do not compress migrations blindly if you have existing live databases!** 
> Squashing migrations deletes the "upgrade path" needed by Alembic to run `ALTER TABLE` commands on existing tables. Only compress migrations when you are 100% sure all your production environments are fully synced with the latest schema *before* squashing.

To compress migrations safely (after production is fully synced), run the automated compression script from the `src/server` directory:

```bash
uv run python -m scripts.compress_migrations
# (Or just `python -m scripts.compress_migrations` if your virtual environment is active)
```

This script will automatically:
1. Delete all existing migration files in the `versions/` folder.
2. Wipe the local database using `scripts.drop_db` to create a clean baseline.
3. Run the autogenerator to create a single new migration explicitly named `001_initial_schema.py`.
4. Inject missing SQLModel/pgvector imports.
5. Guarantee the `vector` extension is created by injecting `CREATE EXTENSION IF NOT EXISTS vector;`.

### Deploying the Squashed Migration

When deploying the squash to other environments, you must handle the missing history:
- **For new environments / when wiping is acceptable:** Connect to the server, run `docker compose exec server python -m scripts.drop_db` to wipe the old schema, deploy using `make redeploy-ecr`, and re-seed the roles.
- **For live environments (Never wipe data):** Do **not** drop the database. Instead, temporarily edit your `Makefile` to change `alembic upgrade head` to `alembic stamp head`. Deploy the code once. This safely updates the Alembic version tracker to `001` without touching any tables or live user data. Afterward, change the `Makefile` back to `upgrade head`.

### Applying and Seeding

After the script finishes, run the new migration to verify it works:
```bash
uv run alembic upgrade head
```

Then seed the database. **Never** put raw SQL data inserts into Alembic migrations. Always extract them to the seeder script.
```bash
uv run python -m scripts.seed
# (Or just `python -m scripts.seed` if your virtual environment is active)
```
