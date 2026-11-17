import { randomUUID } from 'node:crypto';

export function createAnalytics(db, config, transport = fetch) {
  db.exec(`CREATE TABLE IF NOT EXISTS analytics_outbox (
    uuid TEXT PRIMARY KEY, event TEXT NOT NULL, at TEXT NOT NULL,
    properties TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS analytics_identity (id TEXT PRIMARY KEY);
  `);
  if (!db.prepare('SELECT id FROM analytics_identity').get()) db.prepare('INSERT INTO analytics_identity VALUES (?)').run(randomUUID());
  const distinctId = db.prepare('SELECT id FROM analytics_identity').get().id;
  let pendingFlush = null;
  let lastError = null;
  return {
    capture(event, properties) {
      if (!config) return;
      db.prepare('INSERT INTO analytics_outbox(uuid,event,at,properties) VALUES (?,?,?,?)')
        .run(randomUUID(), event, new Date().toISOString(), JSON.stringify({ ...properties, source: 'sela-tugas-local' }));
    },
    flush() {
      if (pendingFlush) return pendingFlush;
      if (!config) return Promise.resolve();
      const rows = db.prepare('SELECT * FROM analytics_outbox WHERE sent=0 ORDER BY at LIMIT 40').all();
      if (!rows.length) return Promise.resolve();
      pendingFlush = (async () => {
        try {
          const response = await transport(new URL('/batch/', config.host).href, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal: AbortSignal.timeout(8000),
            body: JSON.stringify({ api_key: config.token, batch: rows.map(row => ({
              uuid: row.uuid, event: row.event, timestamp: row.at, distinct_id: distinctId,
              properties: { ...JSON.parse(row.properties), $geoip_disable: true }
            })) })
          });
          if (!response.ok) throw new Error('PostHog HTTP ' + response.status);
          for (const row of rows) db.prepare('UPDATE analytics_outbox SET sent=1 WHERE uuid=?').run(row.uuid);
          lastError = null;
        } catch (error) { lastError = error.message; }
      })().finally(() => { pendingFlush = null; });
      return pendingFlush;
    },
    status() {
      return { configured: !!config, projectId: config?.projectId || null, lastError,
        queued: db.prepare('SELECT count(*) as n FROM analytics_outbox WHERE sent=0').get().n,
        sent: db.prepare('SELECT count(*) as n FROM analytics_outbox WHERE sent=1').get().n };
    }
  };
}
