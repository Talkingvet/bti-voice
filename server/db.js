const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(100) NOT NULL,
      username    VARCHAR(50)  UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      phone_number  VARCHAR(20) NOT NULL DEFAULT 'TBD',
      twilio_number_sid VARCHAR(50),
      color       VARCHAR(7)  DEFAULT '#3b82f6',
      initials    VARCHAR(3),
      is_active   BOOLEAN     DEFAULT true,
      created_at  TIMESTAMP   DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id           SERIAL PRIMARY KEY,
      name         VARCHAR(200),
      phone_number VARCHAR(20) UNIQUE NOT NULL,
      notes        TEXT,
      created_at   TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id               SERIAL PRIMARY KEY,
      contact_id       INTEGER   REFERENCES contacts(id),
      last_message_at  TIMESTAMP DEFAULT NOW(),
      last_agent_id    INTEGER   REFERENCES agents(id),
      is_resolved      BOOLEAN   DEFAULT false,
      created_at       TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              SERIAL PRIMARY KEY,
      conversation_id INTEGER   REFERENCES conversations(id),
      agent_id        INTEGER   REFERENCES agents(id),
      direction       VARCHAR(10) NOT NULL,
      body            TEXT        NOT NULL,
      from_number     VARCHAR(20),
      to_number       VARCHAR(20),
      twilio_sid      VARCHAR(50),
      status          VARCHAR(20) DEFAULT 'sent',
      sent_at         TIMESTAMP   DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS calls (
      id              SERIAL PRIMARY KEY,
      conversation_id INTEGER   REFERENCES conversations(id),
      agent_id        INTEGER   REFERENCES agents(id),
      direction       VARCHAR(10) DEFAULT 'outbound',
      duration        INTEGER,
      status          VARCHAR(20) DEFAULT 'completed',
      twilio_call_sid VARCHAR(50),
      started_at      TIMESTAMP DEFAULT NOW(),
      ended_at        TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversation_agents (
      conversation_id INTEGER REFERENCES conversations(id),
      agent_id        INTEGER REFERENCES agents(id),
      PRIMARY KEY (conversation_id, agent_id)
    );
  `);

  // Zoho CRM sync columns (added after initial migration — safe to run repeatedly)
  await pool.query(`
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS zoho_contact_id VARCHAR(50);
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS zoho_synced_at  TIMESTAMPTZ;
  `);

  // IVR / phone tree tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ivr_settings (
      id               INTEGER PRIMARY KEY DEFAULT 1,
      enabled          BOOLEAN DEFAULT false,
      greeting         TEXT    DEFAULT 'Thank you for calling. Please listen carefully to the following options.',
      timeout          INTEGER DEFAULT 10,
      default_agent_id INTEGER REFERENCES agents(id),
      updated_at       TIMESTAMP DEFAULT NOW(),
      CONSTRAINT single_row CHECK (id = 1)
    );

    CREATE TABLE IF NOT EXISTS ivr_menus (
      id                SERIAL PRIMARY KEY,
      digit             VARCHAR(1)   NOT NULL,
      label             VARCHAR(100) NOT NULL,
      destination_type  VARCHAR(20)  NOT NULL DEFAULT 'all_agents',
      destination_value VARCHAR(100),
      sort_order        INTEGER      DEFAULT 0,
      is_active         BOOLEAN      DEFAULT true,
      created_at        TIMESTAMP    DEFAULT NOW()
    );
  `);

  // Safe additive migrations
  await pool.query(`
    ALTER TABLE ivr_settings ADD COLUMN IF NOT EXISTS default_agent_id INTEGER REFERENCES agents(id);
    ALTER TABLE ivr_settings ADD COLUMN IF NOT EXISTS voice VARCHAR(60) DEFAULT 'Polly.Joanna-Neural';
    ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_url   TEXT;
    ALTER TABLE calls ADD COLUMN IF NOT EXISTS voicemail_text  TEXT;
    ALTER TABLE calls ADD COLUMN IF NOT EXISTS played          BOOLEAN DEFAULT false;
    ALTER TABLE calls ADD COLUMN IF NOT EXISTS transcription   TEXT;
    ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_summary      TEXT;
    ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_sid   VARCHAR(50);
  `);

  console.log('[db] Migrations complete.');
}

module.exports = { pool, migrate };
