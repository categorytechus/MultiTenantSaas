# Apply infrastructure/database/migrations to the dev Postgres container (existing DBs).
# Usage: from repo root, .\scripts\apply-db-migrations.ps1
# Prerequisite: docker compose is up, container multitenant-postgres is running.
# Uses image pgvector/pgvector:pg15 (see docker-compose*.yml). If `vector` extension fails,
# reset the DB volume and recreate: docker compose -f docker-compose.dev.yml down -v
# then docker compose -f docker-compose.dev.yml up --build

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$container = if ($env:POSTGRES_CONTAINER) { $env:POSTGRES_CONTAINER } else { "multitenant-postgres" }
$migrations = Join-Path $repoRoot "infrastructure\database\migrations"

Write-Host "Copying migrations to $container ..."
docker exec $container sh -c 'rm -rf /tmp/migrations && mkdir -p /tmp/migrations'
docker cp "${migrations}\." "${container}:/tmp/migrations"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Running migrations in sort order..."
docker exec $container sh -c '
psql -U postgres -d multitenant_saas -v ON_ERROR_STOP=1 -c "
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);"

for f in $(ls -1 /tmp/migrations/*.sql | sort); do
  fname=$(basename "$f")
  already_applied=$(psql -U postgres -d multitenant_saas -Atqc "SELECT 1 FROM schema_migrations WHERE filename = '\''$fname'\'' LIMIT 1;")
  if [ "$already_applied" = "1" ]; then
    echo "Skipping $f (already applied)"
    continue
  fi

  echo "Applying $f"
  set +e
  output=$(psql -U postgres -d multitenant_saas -v ON_ERROR_STOP=1 -f "$f" 2>&1)
  status=$?
  set -e

  if [ "$status" -ne 0 ]; then
    echo "$output"
    case "$output" in
      *"already exists"*)
        echo "Detected existing objects for $f, marking as applied"
        psql -U postgres -d multitenant_saas -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations (filename) VALUES ('\''$fname'\'');" || exit 1
        continue
        ;;
      *)
        echo "Migration failed: $f"
        exit 1
        ;;
    esac
  fi

  echo "$output"
  psql -U postgres -d multitenant_saas -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations (filename) VALUES ('\''$fname'\'');" || exit 1
done'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Done."
