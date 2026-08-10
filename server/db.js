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

  // SMS opt-out tracking (A2P 10DLC compliance — v1.5.0)
  await pool.query(`
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opted_out    BOOLEAN DEFAULT false;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ;
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

  // Unread badge tracking
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversation_reads (
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
      agent_id        INTEGER REFERENCES agents(id) ON DELETE CASCADE,
      read_at         TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (conversation_id, agent_id)
    );
  `);

  // Missed call auto-text columns on ivr_settings
  await pool.query(`
    ALTER TABLE ivr_settings ADD COLUMN IF NOT EXISTS auto_text_enabled BOOLEAN DEFAULT false;
    ALTER TABLE ivr_settings ADD COLUMN IF NOT EXISTS auto_text_message  TEXT    DEFAULT 'Hi! We missed your call. We''ll get back to you as soon as possible.';
  `);

  // After-hours SMS auto-responder (v1.5.x)
  await pool.query(`
    ALTER TABLE ivr_settings ADD COLUMN IF NOT EXISTS after_hours_sms_enabled BOOLEAN DEFAULT false;
    ALTER TABLE ivr_settings ADD COLUMN IF NOT EXISTS after_hours_sms_message TEXT    DEFAULT 'Talkingvet: Thanks for your message! Our team is away right now, but we''ll reply as soon as we''re back during business hours.';
    ALTER TABLE ivr_settings ADD COLUMN IF NOT EXISTS business_hours_start VARCHAR(5)  DEFAULT '09:00';
    ALTER TABLE ivr_settings ADD COLUMN IF NOT EXISTS business_hours_end   VARCHAR(5)  DEFAULT '17:00';
    ALTER TABLE ivr_settings ADD COLUMN IF NOT EXISTS business_days        VARCHAR(20) DEFAULT '1,2,3,4,5';
    ALTER TABLE ivr_settings ADD COLUMN IF NOT EXISTS business_timezone    VARCHAR(50) DEFAULT 'America/New_York';
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_auto_reply_at TIMESTAMPTZ;
  `);

  // Scheduled SMS (send later)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id              SERIAL PRIMARY KEY,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
      agent_id        INTEGER REFERENCES agents(id),
      body            TEXT NOT NULL,
      from_number     VARCHAR(20) NOT NULL,
      to_number       VARCHAR(20) NOT NULL,
      send_at         TIMESTAMPTZ NOT NULL,
      status          VARCHAR(20) DEFAULT 'pending',
      error           TEXT,
      twilio_sid      VARCHAR(50),
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      sent_at         TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_sched_pending ON scheduled_messages (status, send_at);
  `);

  // MMS media attachments
  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_media (
      id           SERIAL PRIMARY KEY,
      message_id   INTEGER REFERENCES messages(id) ON DELETE CASCADE,
      content_type VARCHAR(100) NOT NULL,
      twilio_url   TEXT,
      data         BYTEA,
      public_token VARCHAR(64) UNIQUE,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_media_message ON message_media (message_id);
  `);

  // Phase 2: Internal notes, canned responses, quick dial
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversation_notes (
      id              SERIAL PRIMARY KEY,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
      agent_id        INTEGER REFERENCES agents(id),
      body            TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS canned_responses (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL,
      body       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS quick_dial (
      id           SERIAL PRIMARY KEY,
      name         VARCHAR(100) NOT NULL,
      phone_number VARCHAR(20)  NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Phase 3: Agent status + conversation assignment
  await pool.query(`
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'online';
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_agent_id INTEGER REFERENCES agents(id);
  `);

  // Phase 4: Notifications
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         SERIAL PRIMARY KEY,
      type       VARCHAR(30) NOT NULL,
      title      TEXT        NOT NULL,
      body       TEXT,
      color      VARCHAR(20) DEFAULT '#3b82f6',
      read       BOOLEAN     DEFAULT false,
      meta       JSONB       DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // User activity tracking (admin-only, not visible in app)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_activity_logs (
      id         SERIAL PRIMARY KEY,
      agent_id   INTEGER REFERENCES agents(id),
      agent_name VARCHAR(100),
      event      VARCHAR(50)  NOT NULL,
      detail     VARCHAR(200),
      ip         VARCHAR(50),
      city       VARCHAR(100),
      country    VARCHAR(10),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // v1.4.0: Post-call wrap-up screen.
  // - needs_wrap_up: drives the "Needs wrap-up" badge in CallsTab. Set TRUE
  //   when a connected call ends with duration >= 15s. Cleared FALSE only
  //   when the agent actually completes the wrap-up form.
  // - chosen_zoho_contact_id: the Zoho contact the agent picked in the
  //   dropdown (overrides the auto-matched one for shared-phone scenarios).
  // - disposition: outcome code (e.g. 'demo_scheduled', 'callback_requested').
  // - wrap_up_note: agent's freeform note (gets posted as a Zoho Note).
  // - wrap_up_completed_at: timestamp the agent submitted the form.
  // - zoho_logged_at: when /api/zoho/log-call successfully synced this call
  //   to Zoho. NULL = not yet synced. Used by the 60s sweep job and to
  //   prevent double-sync.
  // - zoho_call_id: the id Zoho returned for the Call record. Stored so we
  //   can update / re-attach the record later if the agent picks a different
  //   contact after the auto-timeout sweep already synced it.
  await pool.query(`
    ALTER TABLE calls ADD COLUMN IF NOT EXISTS needs_wrap_up          BOOLEAN     DEFAULT FALSE;
    ALTER TABLE calls ADD COLUMN IF NOT EXISTS chosen_zoho_contact_id VARCHAR(50);
    ALTER TABLE calls ADD COLUMN IF NOT EXISTS disposition            VARCHAR(50);
    ALTER TABLE calls ADD COLUMN IF NOT EXISTS wrap_up_note           TEXT;
    ALTER TABLE calls ADD COLUMN IF NOT EXISTS wrap_up_completed_at   TIMESTAMPTZ;
    ALTER TABLE calls ADD COLUMN IF NOT EXISTS zoho_logged_at         TIMESTAMPTZ;
    ALTER TABLE calls ADD COLUMN IF NOT EXISTS zoho_call_id           VARCHAR(50);
    -- v1.4.1: Lead support — module is 'Contacts' or 'Leads' (null = pre-v1.4.1 = treat as Contacts)
    ALTER TABLE calls ADD COLUMN IF NOT EXISTS chosen_zoho_module     VARCHAR(20);
  `);

  console.log('[db] Migrations complete.');
}

module.exports = { pool, migrate };
