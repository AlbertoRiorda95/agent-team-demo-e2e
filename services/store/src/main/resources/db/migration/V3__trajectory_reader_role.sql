-- V3__trajectory_reader_role: read-only access to the history for the viewer
-- (docs/design/viewer.md > Data and API > Read-only database user).
-- The NOLOGIN role trajectory_reader is created if it does not exist (roles are
-- cluster-wide, so the first prefix creates it and the others reuse it) and
-- gets SELECT on the tables of the prefix in force (${prefix}): every prefix
-- runs its own V3, so every prefix grants it. The login user (viz_web, member
-- of trajectory_reader) is created outside store (compose db-init, M6 Secret):
-- store never holds the reader's password. Additive only: grants, no DDL on
-- the tables. Needs a migrating user with CREATEROLE (or the role created
-- beforehand) on the first run.
--
-- Reverse (by hand):
--   REVOKE SELECT ON ${prefix}trajectory_samples FROM trajectory_reader;
--   REVOKE SELECT ON ${prefix}launches FROM trajectory_reader;
--   DELETE FROM ${prefix}flyway_schema_history WHERE version = '3';
--   -- only once no prefix grants it any more and no user is a member of it:
--   DROP ROLE trajectory_reader;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trajectory_reader') THEN
        CREATE ROLE trajectory_reader NOLOGIN;
    END IF;
EXCEPTION
    -- another prefix (or database of the cluster) created it at the same time
    WHEN duplicate_object THEN NULL;
END
$$;

GRANT SELECT ON ${prefix}launches TO trajectory_reader;
GRANT SELECT ON ${prefix}trajectory_samples TO trajectory_reader;
