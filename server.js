// server.js — سيرفر التراخيص كامل بملف واحد (نسخة مبسطة للنشر السريع)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');

// ===================== قاعدة البيانات =====================
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT UNIQUE NOT NULL,
  customer_name TEXT,
  customer_contact TEXT,
  product TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  plan TEXT NOT NULL DEFAULT 'monthly',
  max_devices INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(license_id) REFERENCES licenses(id),
  UNIQUE(license_id, device_id)
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS verify_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT,
  product TEXT,
  device_id TEXT,
  ip TEXT,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ===================== منطق التراخيص =====================
function getLicenseByKey(key) {
  return db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(key);
}

function isExpired(license) {
  return new Date(license.expires_at) < new Date();
}

function verifyLicense({ key, product, deviceId, ip }) {
  const license = getLicenseByKey(key);

  const log = (result) => {
    db.prepare(
      `INSERT INTO verify_log (license_key, product, device_id, ip, result) VALUES (?, ?, ?, ?, ?)`
    ).run(key || null, product || null, deviceId || null, ip || null, result);
  };

  if (!license) {
    log('not_found');
    return { valid: false, reason: 'invalid_key' };
  }

  if (license.status === 'suspended') {
    log('suspended');
    return { valid: false, reason: 'suspended' };
  }

  if (isExpired(license)) {
    db.prepare(`UPDATE licenses SET status = 'expired' WHERE id = ?`).run(license.id);
    log('expired');
    return { valid: false, reason: 'expired', expiresAt: license.expires_at };
  }

  if (license.product !== 'all' && license.product !== product) {
    log('wrong_product');
    return { valid: false, reason: 'wrong_product' };
  }

  if (deviceId) {
    const existing = db
      .prepare('SELECT * FROM activations WHERE license_id = ? AND device_id = ?')
      .get(license.id, deviceId);

    if (existing) {
      db.prepare("UPDATE activations SET last_seen = datetime('now') WHERE id = ?").run(existing.id);
    } else {
      const count = db
        .prepare('SELECT COUNT(*) AS c FROM activations WHERE license_id = ?')
        .get(license.id).c;

      if (count >= license.max_devices) {
        log('device_limit_exceeded');
        return { valid: false, reason: 'device_limit_exceeded' };
      }

      db.prepare('INSERT INTO activations (license_id, device_id) VALUES (?, ?)').run(
        license.id,
        deviceId
      );
    }
  }

  log('ok');
  return {
    valid: true,
    plan: license.plan,
    expiresAt: license.expires_at,
    customerName: license.customer_name,
  };
}

// ===================== حماية مسارات الإدارة =====================
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!process.env.ADMIN_TOKEN) {
    return res.status(500).json({ error: 'ADMIN_TOKEN غير معرّف بالسيرفر' });
  }
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  next();
}

function generateKey(prefix) {
  const part = () => nanoid(5).toUpperCase();
  return `${prefix}-${part()}-${part()}`;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// ===================== السيرفر =====================
const app = express();
app.use(express.json());
app.use(cors());
app.use('/admin', express.static(path.join(__dirname, 'admin')));

const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// نقطة التحقق العامة (يستدعيها الموقع والسكربتات)
app.post('/api/verify', verifyLimiter, (req, res) => {
  const { key, product, deviceId } = req.body || {};
  if (!key || !product) {
    return res.status(400).json({ valid: false, reason: 'missing_params' });
  }
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const result = verifyLicense({ key, product, deviceId, ip });
  res.json(result);
});

// ---------- مسارات الإدارة (محمية بـ ADMIN_TOKEN) ----------
const adminRouter = express.Router();
adminRouter.use(adminAuth);

adminRouter.post('/licenses', (req, res) => {
  const {
    customerName = '',
    customerContact = '',
    product,
    plan = 'monthly',
    maxDevices = 1,
  } = req.body;

  if (!product) {
    return res.status(400).json({ error: 'الحقل product مطلوب (personal/tasheel/modon/all)' });
  }

  const prefixMap = { tasheel: 'TSH', personal: 'PRS', modon: 'MDN', all: 'ALL' };
  const key = generateKey(prefixMap[product] || 'LIC');
  const expiresAt = plan === 'yearly' ? addMonths(new Date(), 12) : addMonths(new Date(), 1);

  const info = db
    .prepare(
      `INSERT INTO licenses (license_key, customer_name, customer_contact, product, plan, max_devices, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(key, customerName, customerContact, product, plan, maxDevices, expiresAt.toISOString());

  const license = db.prepare('SELECT * FROM licenses WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(license);
});

adminRouter.get('/licenses', (req, res) => {
  const { q } = req.query;
  let rows;
  if (q) {
    rows = db
      .prepare(`SELECT * FROM licenses WHERE license_key LIKE ? OR customer_name LIKE ? ORDER BY id DESC`)
      .all(`%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare('SELECT * FROM licenses ORDER BY id DESC').all();
  }
  res.json(rows);
});

adminRouter.patch('/licenses/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM licenses WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'الترخيص غير موجود' });

  const fields = [];
  const values = [];

  if (req.body.status) { fields.push('status = ?'); values.push(req.body.status); }
  if (req.body.expiresAt) { fields.push('expires_at = ?'); values.push(new Date(req.body.expiresAt).toISOString()); }
  if (req.body.maxDevices) { fields.push('max_devices = ?'); values.push(req.body.maxDevices); }
  if (req.body.plan) { fields.push('plan = ?'); values.push(req.body.plan); }
  if (req.body.notes !== undefined) { fields.push('notes = ?'); values.push(req.body.notes); }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'ما فيه حقول للتعديل' });
  }

  values.push(id);
  db.prepare(`UPDATE licenses SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json(db.prepare('SELECT * FROM licenses WHERE id = ?').get(id));
});

adminRouter.post('/licenses/:id/renew', (req, res) => {
  const { id } = req.params;
  const { plan } = req.body;
  const existing = db.prepare('SELECT * FROM licenses WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'الترخيص غير موجود' });

  const base = new Date(existing.expires_at) > new Date() ? new Date(existing.expires_at) : new Date();
  const months = plan === 'yearly' ? 12 : 1;
  const newExpiry = addMonths(base, months);

  db.prepare(`UPDATE licenses SET expires_at = ?, status = 'active', plan = ? WHERE id = ?`).run(
    newExpiry.toISOString(),
    plan || existing.plan,
    id
  );
  res.json(db.prepare('SELECT * FROM licenses WHERE id = ?').get(id));
});

adminRouter.delete('/licenses/:id/activations', (req, res) => {
  db.prepare('DELETE FROM activations WHERE license_id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.use('/api/admin', adminRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 license-server يعمل على المنفذ ${PORT}`);
});
