# Backup and Restore

---

## Supabase managed backups

Supabase Pro plans include daily automated backups with a 7-day retention period.
Point-in-time recovery (PITR) is available on higher plans.

To access backups: Supabase dashboard → Settings → Database → Backups.

---

## Manual backup (pg_dump)

For an on-demand backup of production data:

```bash
# Get the connection string from: supabase db status (or dashboard)
pg_dump \
  --dbname="postgres://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
  --format=custom \
  --no-acl \
  --no-owner \
  --file="nutri-backup-$(date +%Y%m%d).dump"
```

Store the dump file securely (encrypted at rest, off-site).

---

## Restore from backup

```bash
pg_restore \
  --dbname="<connection-string>" \
  --no-acl \
  --no-owner \
  nutri-backup-20260802.dump
```

**Warning**: This overwrites the target database. Only run against a fresh
database or a staging environment unless you intend a full restore.

---

## Local development backup

For a local backup before testing destructive migrations:

```bash
supabase db dump --local > local-backup-$(date +%Y%m%d).sql
```

To restore locally:
```bash
supabase db reset --local            # resets to migrations only
psql postgresql://postgres:postgres@localhost:54322/postgres < local-backup.sql
```

---

## Disaster recovery procedure

1. Identify the last known-good backup timestamp
2. Restore to a staging environment first and verify data integrity
3. Run migration health check: `SELECT COUNT(*) FROM supabase_migrations.schema_migrations` (expect 28)
4. Run a smoke test against staging
5. If staging is healthy, restore to production during a maintenance window
6. Redeploy edge functions after restore (`supabase functions deploy`)
7. Run the production smoke test

---

## User data export (per-user recovery)

Users can export their own data at any time via `GET /functions/v1/export-my-data`.
This is not a backup mechanism but allows users to retain a copy of their data
independently of the platform backup schedule.
