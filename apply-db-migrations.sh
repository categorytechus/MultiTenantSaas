#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

CONTAINER="${POSTGRES_CONTAINER:-multitenant-postgres}"

echo "Repo root: $REPO_ROOT"
echo "Copying migrations to ${CONTAINER} ..."

docker exec "$CONTAINER" sh -c 'rm -rf /tmp/migrations && mkdir -p /tmp/migrations'
docker cp "$REPO_ROOT/infrastructure/database/migrations/." "$CONTAINER:/tmp/migrations"

echo "Running migrations in sort order..."

docker exec "$CONTAINER" sh -c '
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
done
'

echo "Done."