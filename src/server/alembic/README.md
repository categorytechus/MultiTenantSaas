# Alembic Migrations

This directory contains the Alembic configuration and migration history.

## Compressing / Squashing Migrations

Over time, Alembic migrations can grow significantly. To keep the history clean, we periodically compress all migrations into a single `initial_schema` file.

> [!WARNING]
> **DANGER: Do not compress migrations if you have existing production databases!** 
> Squashing migrations deletes the "upgrade path" needed by Alembic to run `ALTER TABLE` commands on existing tables. Only compress migrations when you are 100% sure all your production environments (EC2, other developers' laptops) are fully up-to-date with the absolute latest schema.

To compress migrations safely (after production is fully synced), simply run the automated compression script from the `src/server` directory:

```bash
uv run python -m scripts.compress_migrations
# (Or just `python -m scripts.compress_migrations` if your virtual environment is active)
```

This script will automatically:
1. Delete all existing migration files in the `versions/` folder.
2. Wipe the local database using `scripts.drop_db` to create a clean baseline.
3. Run the autogenerator to create a single new migration.
4. Inject missing SQLModel/pgvector imports.
5. Guarantee the `vector` extension is created by injecting `CREATE EXTENSION IF NOT EXISTS vector;`.

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
