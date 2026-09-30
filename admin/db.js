const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// All additive (IF NOT EXISTS) — safe to run on every boot, same as the main app.
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_users (
      id                   SERIAL PRIMARY KEY,
      name                 VARCHAR(100) NOT NULL,
      username             VARCHAR(50)  UNIQUE NOT NULL,
      password_hash        VARCHAR(255) NOT NULL,
      is_active            BOOLEAN      NOT NULL DEFAULT true,
      must_change_password BOOLEAN      NOT NULL DEFAULT false,
      last_login_at        TIMESTAMP,
      created_at           TIMESTAMP    NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tenants (
      id             SERIAL PRIMARY KEY,
      name           VARCHAR(120) NOT NULL,
      url            VARCHAR(300) NOT NULL,
      key_enc        TEXT         NOT NULL,
      key_hint       VARCHAR(8),
      plan           VARCHAR(60),
      notes          TEXT,
      is_active      BOOLEAN      NOT NULL DEFAULT true,
      last_ok_at     TIMESTAMP,
      last_error     TEXT,
      created_by     INTEGER REFERENCES portal_users(id),
      created_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMP    NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS portal_audit (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES portal_users(id),
      username    VARCHAR(50),
      tenant_id   INTEGER,
      tenant_name VARCHAR(120),
      action      VARCHAR(60)  NOT NULL,
      detail      JSONB,
      ip          VARCHAR(64),
      created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS portal_audit_tenant_idx ON portal_audit (tenant_id, created_at DESC);
  `);
  console.log('[db] Migrations complete.');
}

async function audit(req, action, { tenant = null, detail = null } = {}) {
  try {
    await pool.query(
      `INSERT INTO portal_audit (user_id, username, tenant_id, tenant_name, action, detail, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.user?.id ?? null, req.user?.username ?? null, tenant?.id ?? null, tenant?.name ?? null,
       action, detail ? JSON.stringify(detail) : null, req.ip || null]
    );
  } catch (e) {
    console.error('[audit] failed:', e.message);
  }
}

module.exports = { pool, migrate, audit };
