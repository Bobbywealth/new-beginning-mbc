/**
 * New Beginning Missionary Baptist Church — API
 * ---------------------------------------------------------------------------
 * Express + Postgres backend. Tables mirror the dashboard's localStorage
 * shapes so when v2 migrates from localStorage to API, the contracts match.
 *
 * Schema is bootstrapped on boot (CREATE TABLE IF NOT EXISTS).
 * Render auto-injects DATABASE_URL via render.yaml `fromDatabase`.
 */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const PORT = parseInt(process.env.PORT || '10000', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';

// ---------------------------------------------------------------------------
// Schema bootstrap
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  birthday DATE,
  membership_status TEXT,
  ministry_group TEXT,
  sms_opt_in BOOLEAN DEFAULT false,
  tags JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  last_contacted TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sms_signups (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  email TEXT,
  opt_in_status TEXT,
  opt_in_date TIMESTAMPTZ,
  opt_in_source TEXT,
  consent_text TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  member_status TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT,
  date DATE,
  start_time TEXT,
  end_time TEXT,
  location TEXT,
  description TEXT,
  image_url TEXT,
  ministry TEXT,
  is_public BOOLEAN DEFAULT false,
  rsvp_required BOOLEAN DEFAULT false,
  featured_on_homepage BOOLEAN DEFAULT false,
  text_reminder_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sermons (
  id TEXT PRIMARY KEY,
  title TEXT,
  speaker TEXT,
  date DATE,
  scripture TEXT,
  youtube_link TEXT,
  audio_link TEXT,
  thumbnail_url TEXT,
  description TEXT,
  series_name TEXT,
  featured BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prayer_requests (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  email TEXT,
  request_text TEXT,
  privacy_level TEXT,
  urgency_level TEXT,
  assigned_to TEXT,
  status TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  title TEXT,
  category TEXT,
  message_body TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_history (
  id TEXT PRIMARY KEY,
  message_body TEXT,
  recipient_type TEXT,
  recipient_count INTEGER,
  sent_at TIMESTAMPTZ,
  sent_by TEXT,
  status TEXT,
  full_body TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Defensive ALTERs: the message_history table was originally shipped
-- without updated_at + full_body, but the generic CRUD factory always
-- writes updated_at and the dashboard always sends full_body. Adding the
-- columns here is idempotent so a redeploy on the old schema heals it.
ALTER TABLE message_history ADD COLUMN IF NOT EXISTS full_body TEXT;
ALTER TABLE message_history ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  requested_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'pending',
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  phone TEXT,
  role TEXT,
  perms JSONB DEFAULT '[]'::jsonb,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE,
  value TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
`;

async function initSchema() {
  await pool.query(SCHEMA_SQL);
  console.log('[schema] all 9 tables ensured');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function nowIso() {
  return new Date().toISOString();
}

// Generic CRUD factory. Tables whose primary key is a TEXT id supplied by
// the client (mirrors the dashboard's localStorage id style).
// `jsonbCols` lists columns that hold JSONB — pg sends JS arrays as Postgres
// array literals by default, which jsonb columns reject, so we JSON.stringify
// those values before binding.
function makeCrud(table, jsonbCols = []) {
  const router = express.Router();
  const isJsonb = (col, v) =>
    jsonbCols.includes(col) && v !== null && typeof v === 'object';

  // List
  router.get('/', async (_req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM ${table} ORDER BY created_at DESC NULLS LAST`);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Get one
  router.get('/:id', async (req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Create
  router.post('/', async (req, res) => {
    try {
      const body = req.body || {};
      const id = body.id || genId();
      const cols = Object.keys(body).filter(k => k !== 'id' && body[k] !== undefined);
      if (!cols.length) return res.status(400).json({ error: 'no fields provided' });

      const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
      const params = [id, ...cols.map(k => isJsonb(k, body[k]) ? JSON.stringify(body[k]) : body[k])];

      const sql = `
        INSERT INTO ${table} (id, ${cols.join(', ')}, updated_at)
        VALUES ($1, ${placeholders}, now())
        RETURNING *
      `;
      const r = await pool.query(sql, params);
      res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Update
  router.put('/:id', async (req, res) => {
    try {
      const body = req.body || {};
      const cols = Object.keys(body).filter(k => k !== 'id' && k !== 'created_at' && body[k] !== undefined);
      if (!cols.length) return res.status(400).json({ error: 'no updatable fields' });

      const setClause = cols.map((k, i) => `${k} = $${i + 2}`).join(', ');
      const params = [
        req.params.id,
        ...cols.map(k => isJsonb(k, body[k]) ? JSON.stringify(body[k]) : body[k]),
      ];

      const sql = `UPDATE ${table} SET ${setClause}, updated_at = now() WHERE id = $1 RETURNING *`;
      const r = await pool.query(sql, params);
      if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Delete
  router.delete('/:id', async (req, res) => {
    try {
      const r = await pool.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
      res.json({ deleted: req.params.id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Health & readiness
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'new-beginning-mbc-api',
    env: NODE_ENV,
    time: nowIso(),
  });
});

app.get('/api/health/db', async (_req, res) => {
  try {
    const r = await pool.query('SELECT now() AS db_time, current_database() AS db, version() AS pg_version');
    const t = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    res.json({
      ok: true,
      db_time: r.rows[0].db_time,
      database: r.rows[0].db,
      pg_version: r.rows[0].pg_version,
      tables: t.rows.map(x => x.table_name),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Public write endpoints (no auth). These are the form-submission endpoints
// the public site hits directly. They're mounted BEFORE the auth gate so
// visitors can submit without holding the admin token. Input is tightly
// constrained — only the fields the public form should ever set.
// ---------------------------------------------------------------------------

// Validate + insert an SMS opt-in from the public website form
app.post('/api/public/sms-signup', async (req, res) => {
  try {
    const { first_name = '', last_name = '', phone = '', email = '', consent = '' } = req.body || {};
    if (!phone || !consent) return res.status(400).json({ error: 'phone and consent are required' });
    if (!/^[+()\d\-\s]{7,}$/.test(phone)) return res.status(400).json({ error: 'invalid phone' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'invalid email' });
    }
    const id = genId();
    const r = await pool.query(
      `INSERT INTO sms_signups
         (id, first_name, last_name, phone, email, opt_in_status, opt_in_date,
          opt_in_source, consent_text, tags, member_status, notes, updated_at)
       VALUES ($1,$2,$3,$4,$5,'Opted In', now(),
          'Website Form', $6, '[]'::jsonb, 'Guest', 'Submitted via public website form.', now())
       RETURNING id, first_name, last_name, phone, email, opt_in_status, opt_in_date`,
      [id, first_name.trim().slice(0, 100), last_name.trim().slice(0, 100), phone.trim(), email.trim(), String(consent).slice(0, 1000)]
    );
    res.status(201).json({ ok: true, signup: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Validate + insert a password-reset request from the public login page
app.post('/api/public/password-reset-request', async (req, res) => {
  try {
    const { email = '' } = req.body || {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'invalid email' });
    }
    const id = genId();
    await pool.query(
      `INSERT INTO password_resets (id, email, requested_at, status, updated_at)
       VALUES ($1, $2, now(), 'pending', now())`,
      [id, email.toLowerCase().trim()]
    );
    // Always return 200 — don't leak whether the email exists.
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// Auth: shared-secret admin token. Reads are open so the public site can
// render events/sermons/settings; writes (POST/PUT/DELETE) require the token.
// Token is sent as `X-Admin-Token` from the dashboard. If ADMIN_TOKEN env
// is not set, the API stays open (dev mode) — no behavior change.
// ---------------------------------------------------------------------------
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return next(); // dev: open
  const got = req.headers['x-admin-token'];
  if (got !== expected) return res.status(401).json({ error: 'unauthorized' });
  next();
}
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  return requireAdmin(req, res, next);
});

// ---------------------------------------------------------------------------
// CRUD routes (mirror dashboard localStorage keys)
// ---------------------------------------------------------------------------

app.use('/api/members',          makeCrud('members',          ['tags']));
app.use('/api/sms-signups',      makeCrud('sms_signups',      ['tags']));
app.use('/api/events',           makeCrud('events',           []));
app.use('/api/sermons',          makeCrud('sermons',          []));
app.use('/api/prayer-requests',  makeCrud('prayer_requests',  []));
app.use('/api/templates',        makeCrud('templates',        []));
app.use('/api/message-history',  makeCrud('message_history',  []));
app.use('/api/staff',            makeCrud('staff',            ['perms']));
app.use('/api/password-resets',  makeCrud('password_resets',  []));

// Settings is a key/value store (different shape)
app.get('/api/settings', async (_req, res) => {
  try {
    const r = await pool.query('SELECT * FROM settings ORDER BY key');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/settings/:key', async (req, res) => {
  try {
    const { value, updated_by } = req.body || {};
    const r = await pool.query(
      `INSERT INTO settings (id, key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()
       RETURNING *`,
      [genId(), req.params.key, value ?? '', updated_by ?? 'system']
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/settings/:key', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM settings WHERE key = $1', [req.params.key]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not found', key: req.params.key });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Aggregate stats for the dashboard overview
app.get('/api/stats/overview', async (_req, res) => {
  try {
    const [members, sms, events, sermons, prayer] = await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM members'),
      pool.query("SELECT count(*)::int AS opted FROM sms_signups WHERE opt_in_status = 'Opted In'"),
      pool.query("SELECT count(*)::int AS upcoming FROM events WHERE date >= CURRENT_DATE AND is_public = true"),
      pool.query('SELECT count(*)::int AS total FROM sermons'),
      pool.query("SELECT count(*)::int AS open_prayer FROM prayer_requests WHERE status NOT IN ('Resolved', 'Archived')"),
    ]);
    res.json({
      total_members: members.rows[0].n,
      sms_subscribers: sms.rows[0].opted,
      upcoming_events: events.rows[0].upcoming,
      total_sermons: sermons.rows[0].total,
      open_prayer_requests: prayer.rows[0].open_prayer,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// 404 + error handlers
// ---------------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({ error: 'not found', path: req.path });
});

app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid JSON body' });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: err.message || 'internal error' });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async () => {
  try {
    if (!process.env.DATABASE_URL) {
      console.error('[boot] DATABASE_URL is not set. Aborting.');
      process.exit(1);
    }
    await initSchema();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[api] new-beginning-mbc-api listening on :${PORT} (env=${NODE_ENV})`);
    });
  } catch (e) {
    console.error('[boot] failed:', e);
    process.exit(1);
  }
})();