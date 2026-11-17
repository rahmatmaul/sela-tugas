import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { todayWib, daysUntil, validDate, addDays, eligible, stages, alarmWav } from './reminders.mjs';
import { createAnalytics } from './analytics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp4']);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

async function bodyOf(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 34 * 1024 * 1024) throw fail('Ukuran permintaan terlalu besar.', 413);
    chunks.push(chunk);
  }
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Data JSON harus berupa objek.');
    return input;
  }
  catch { throw fail('Data JSON tidak valid.'); }
}

export function createApp({ dataDir = join(here, 'data'), notifications = true, clock = () => new Date(), alarmNotifier } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'sela.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, course TEXT NOT NULL, description TEXT NOT NULL,
      due TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, updated TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      name TEXT NOT NULL, type TEXT NOT NULL, content BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries (key TEXT PRIMARY KEY, task_id TEXT NOT NULL, stage INTEGER NOT NULL, at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'delivered');
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, event TEXT NOT NULL, at TEXT NOT NULL, properties TEXT NOT NULL);
  `);
  if (!db.prepare('PRAGMA table_info(deliveries)').all().some(column => column.name === 'status')) {
    db.exec("ALTER TABLE deliveries ADD COLUMN status TEXT NOT NULL DEFAULT 'delivered'");
  }
  db.prepare("INSERT OR IGNORE INTO settings VALUES ('enabled','false')").run();
  const analyticsConfig = process.env.POSTHOG_TOKEN && process.env.POSTHOG_HOST ? {
    token: process.env.POSTHOG_TOKEN,
    host: process.env.POSTHOG_HOST,
    projectId: Number(process.env.POSTHOG_PROJECT_ID)
  } : null;
  const analytics = createAnalytics(db, analyticsConfig);
  const log = (event, properties = {}) => {
    db.prepare('INSERT INTO events(event,at,properties) VALUES (?,?,?)').run(event, new Date().toISOString(), JSON.stringify(properties));
    analytics.capture(event, properties);
  };
  const enabled = () => db.prepare("SELECT value FROM settings WHERE key='enabled'").get().value === 'true';
  const filesFor = id => db.prepare('SELECT id,name,type FROM files WHERE task_id=?').all(id).map(f => ({ ...f, url: '/api/files/' + f.id }));
  const shape = row => ({ ...row, done: !!row.done, demo: !!row.demo, files: filesFor(row.id) });
  const tasks = () => db.prepare('SELECT * FROM tasks ORDER BY done,due,created').all().map(shape);
  const find = id => {
    const row = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (!row) throw fail('Tugas tidak ditemukan.', 404);
    return shape(row);
  };
  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function saveWithinTransaction(input, id, demo = false) {
    const current = id ? find(id) : { done: false, demo, course: '', description: '', version: 0 };
    if (id && input.version !== current.version) throw fail('Tugas berubah di tab lain. Buka ulang tugas sebelum menyimpan.', 409);
    const task = { ...current, ...input, id: id || randomUUID() };
    if (typeof task.title !== 'string' || !task.title.trim() || task.title.length > 140) throw fail('Nama tugas wajib diisi, maksimal 140 karakter.');
    if (!validDate(task.due)) throw fail('Tanggal pengumpulan tidak valid.');
    if (typeof task.course !== 'string' || task.course.length > 100 || typeof task.description !== 'string' || task.description.length > 5000) throw fail('Deskripsi atau mata kuliah terlalu panjang.');
    if (typeof task.done !== 'boolean') throw fail('Status tugas tidak valid.');
    const removals = input.removeFiles ?? [];
    const incoming = input.files ?? [];
    if (!Array.isArray(removals) || !removals.every(x => typeof x === 'string') || !Array.isArray(incoming)) throw fail('Lampiran tidak valid.');
    const remaining = (current.files || []).filter(f => !removals.includes(f.id));
    if (remaining.length + incoming.length > 4) throw fail('Maksimal empat lampiran per tugas.');
    const validated = incoming.map(file => {
      if (!file || !allowedTypes.has(file.type) || typeof file.name !== 'string' || file.name.length > 180 || typeof file.data !== 'string' ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) throw fail('Format lampiran harus foto atau audio.');
      const content = Buffer.from(file.data, 'base64');
      if (!content.length || content.length > 6 * 1024 * 1024) throw fail('Setiap lampiran maksimal 6 MB.');
      return { ...file, content };
    });
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,course=excluded.course,description=excluded.description,due=excluded.due,done=excluded.done,version=excluded.version,updated=excluded.updated`)
      .run(task.id, task.title.trim(), task.course.trim(), task.description.trim(), task.due, Number(task.done), Number(current.demo), current.version + 1, current.created || now, now);
    for (const fileId of removals) db.prepare('DELETE FROM files WHERE id=? AND task_id=?').run(fileId, task.id);
    for (const file of validated) db.prepare('INSERT INTO files VALUES (?,?,?,?,?)').run(randomUUID(), task.id, file.name, file.type, file.content);
    log(id ? 'task_updated' : 'task_created', { demo: current.demo, attachments: remaining.length + incoming.length, days_until_due: daysUntil(task.due, todayWib()) });
    if (task.done && !current.done) log('task_completed', { demo: current.demo });
    return find(task.id);
  }
  const save = (input, id) => transaction(() => saveWithinTransaction(input, id));
  for (const stage of [1, 2, 3]) writeFileSync(join(dataDir, 'alarm-' + stage + '.wav'), alarmWav(stage));
  let alarmBusy = false;
  let lastError = null;
  let activeReminder = null;
  async function notify(stage, title, preview = false) {
    if (process.platform !== 'win32') throw fail('Alarm desktop tersedia pada Windows.', 503);
    const notice = { heading: (preview ? 'Demo ' : '') + stages[stage].title.replace(' · ', ' - '), body: title + '\n' + stages[stage].detail,
      color: { 1: '#B33D29', 2: '#926016', 3: '#236A61' }[stage] };
    const payload = Buffer.from(JSON.stringify(notice)).toString('base64');
    await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', join(here, 'alarm-windows.ps1'), '-Payload', payload, '-Sound', join(dataDir, 'alarm-' + stage + '.wav')], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let detail = '';
      child.stderr.on('data', chunk => { detail = (detail + chunk).slice(-1500); });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(detail || 'Alarm desktop gagal dimulai.')));
    });
  }
  const sendAlarm = alarmNotifier ?? notify;
  function startScan() {
    if (alarmBusy) return activeReminder;
    activeReminder = scan().finally(() => { activeReminder = null; });
    return activeReminder;
  }
  async function scan() {
    if (!notifications || !enabled() || alarmBusy) return;
    alarmBusy = true;
    let claimedKey = null;
    try {
      const delivered = new Set(db.prepare("SELECT key FROM deliveries WHERE status <> 'failed'").all().map(x => x.key));
      const next = eligible(tasks(), clock(), delivered)[0];
      if (next) {
        const claim = db.prepare(`INSERT INTO deliveries VALUES (?,?,?,?, 'claimed')
          ON CONFLICT(key) DO UPDATE SET status='claimed', at=excluded.at WHERE deliveries.status='failed'`)
          .run(next.key, next.task.id, next.stage, clock().toISOString());
        if (!claim.changes) return;
        claimedKey = next.key;
        await sendAlarm(next.stage, next.task.title);
        db.prepare("UPDATE deliveries SET status='delivered' WHERE key=?").run(next.key);
        log('reminder_fired', { stage: next.stage, mode: 'automatic' });
      }
      lastError = null;
    } catch (error) {
      if (claimedKey) db.prepare("UPDATE deliveries SET status='failed' WHERE key=?").run(claimedKey);
      lastError = error.message;
      log('reminder_failed', { component: 'desktop-alarm' });
    }
    finally { alarmBusy = false; }
  }
  const server = createServer(async (req, res) => {
    const send = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) throw fail('Gunakan alamat lokal 127.0.0.1.', 403);
      const origin = req.headers.origin;
      if (origin && origin !== 'http://' + req.headers.host) throw fail('Permintaan dari luar aplikasi ditolak.', 403);
      const url = new URL(req.url, 'http://' + req.headers.host);
      const path = url.pathname;
      const method = req.method;
      if (method === 'GET' && path === '/api/tasks') return send(tasks());
      if (method === 'POST' && path === '/api/tasks') return send(save(await bodyOf(req)), 201);
      const match = path.match(/^\/api\/tasks\/([\w-]+)$/);
      if (match && method === 'PATCH') return send(save(await bodyOf(req), match[1]));
      if (match && method === 'DELETE') {
        find(match[1]); db.prepare('DELETE FROM tasks WHERE id=?').run(match[1]); log('task_deleted'); return send({ ok: true });
      }
      const fileMatch = path.match(/^\/api\/files\/([\w-]+)$/);
      if (fileMatch && method === 'GET') {
        const file = db.prepare('SELECT * FROM files WHERE id=?').get(fileMatch[1]);
        if (!file) throw fail('Lampiran tidak ditemukan.', 404);
        res.writeHead(200, { 'content-type': file.type, 'content-length': file.content.length, 'content-security-policy': "default-src 'none'; media-src 'self'; img-src 'self'" });
        return res.end(Buffer.from(file.content));
      }
      if (path === '/api/settings' && method === 'GET') return send({ enabled: enabled(), hour: '09.00 WIB', platform: process.platform, alarmBusy, lastError, today: todayWib(), notifications, analytics: analytics.status() });
      if (path === '/api/settings' && method === 'PATCH') {
        const input = await bodyOf(req);
        if (typeof input.enabled !== 'boolean') throw fail('Pengaturan alarm tidak valid.');
        db.prepare("UPDATE settings SET value=? WHERE key='enabled'").run(String(input.enabled));
        log('reminder_setting_changed', { enabled: input.enabled }); send({ enabled: enabled() }); void startScan(); return;
      }
      if (path === '/api/alarms/preview' && method === 'POST') {
        const input = await bodyOf(req);
        if (![1, 2, 3].includes(input.stage)) throw fail('Tahap alarm tidak valid.');
        if (!notifications) throw fail('Alarm dinonaktifkan pada proses uji.', 503);
        if (alarmBusy) throw fail('Tunggu alarm sebelumnya selesai.', 409);
        alarmBusy = true;
        send({ ok: true, stage: input.stage }, 202);
        activeReminder = sendAlarm(input.stage, 'Contoh pengingat tugas', true).then(() => {
          lastError = null; log('reminder_previewed', { stage: input.stage });
        }).catch(error => { lastError = error.message; log('reminder_failed', { component: 'desktop-alarm' }); }).finally(() => { alarmBusy = false; activeReminder = null; });
        return;
      }
      if (path === '/api/demo' && method === 'POST') {
        transaction(() => {
          if (db.prepare('SELECT id FROM tasks WHERE demo=1').get()) return;
          for (const [title, course, description, days] of [
            ['Presentasi integrasi AI', 'Integrasi Sistem', 'Siapkan demo aplikasi dan bukti penggunaan MCP.', 1],
            ['Ringkasan materi basis data', 'Basis Data', 'Rangkum normalisasi dan contoh relasi tabel.', 2],
            ['Latihan rancangan antarmuka', 'Interaksi Manusia & Komputer', 'Susun alur pencatatan tugas yang mudah dipakai.', 3]
          ]) {
            saveWithinTransaction({ title, course, description, due: addDays(todayWib(), days) }, undefined, true);
          }
        });
        return send(tasks(), 201);
      }
      if (path === '/api/demo' && method === 'DELETE') { db.prepare('DELETE FROM tasks WHERE demo=1').run(); return send({ ok: true }); }
      if (path === '/api/events' && method === 'GET') return send(db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 100').all().map(x => ({ ...x, properties: JSON.parse(x.properties) })));
      if (path === '/api/deliveries' && method === 'GET') return send(db.prepare('SELECT * FROM deliveries ORDER BY at DESC LIMIT 30').all());
      const publicFiles = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/tokens.css': 'tokens.css' };
      if (method === 'GET' && publicFiles[path]) {
        const file = publicFiles[path];
        const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)];
        res.writeHead(200, { 'content-type': type + '; charset=utf-8' });
        return res.end(readFileSync(join(here, 'public', file)));
      }
      throw fail('Halaman tidak ditemukan.', 404);
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.headersSent) send({ error: error.status ? error.message : 'Terjadi kesalahan penyimpanan. Coba lagi.' }, error.status || 500);
      else res.end();
    }
  });
  let timer;
  let analyticsTimer;
  return {
    server, db,
    listen: (port = 4317) => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        timer = setInterval(() => void startScan(), 30000);
        timer.unref();
        analyticsTimer = setInterval(() => void analytics.flush(), 5000);
        analyticsTimer.unref();
        void startScan();
        resolve();
      });
    }),
    close: async () => { clearInterval(timer); clearInterval(analyticsTimer); await new Promise(resolve => server.close(resolve)); await activeReminder; await analytics.flush(); db.close(); }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const app = createApp({ dataDir: process.env.SELA_DATA_DIR || undefined, notifications: process.env.SELA_NO_NOTIFICATIONS !== '1' });
  try {
    await app.listen(Number(process.env.SELA_PORT || 4317));
    const stop = async () => { await app.close(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    console.log('Sela Tugas siap di http://127.0.0.1:4317\nBiarkan proses ini aktif agar alarm harian berjalan. Ctrl+C untuk berhenti.');
    if (process.argv.includes('--open')) spawn('cmd.exe', ['/c', 'start', '', 'http://127.0.0.1:4317'], { windowsHide: true, stdio: 'ignore' });
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.log('Port 4317 sudah digunakan. Buka http://127.0.0.1:4317 untuk sesi yang aktif.');
      if (process.argv.includes('--open')) spawn('cmd.exe', ['/c', 'start', '', 'http://127.0.0.1:4317'], { windowsHide: true, stdio: 'ignore' });
      app.db.close();
    } else { console.error(error.message); process.exitCode = 1; }
  }
}
