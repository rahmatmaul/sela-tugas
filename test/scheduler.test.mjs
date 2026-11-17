import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server.mjs';

test('a delivery is claimed before displaying and shutdown waits for display completion', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sela-delivery-'));
  let release;
  let calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const options = { dataDir: folder, clock: () => new Date('2000-01-01T12:00:00+07:00'), alarmNotifier: () => { calls++; return pending; } };
  const app = createApp(options);
  let second;
  let closing;
  try {
    await app.listen(0);
    const root = 'http://127.0.0.1:' + app.server.address().port;
    await fetch(root + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Uji klaim', due: '2000-01-04' }) });
    await fetch(root + '/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"enabled":true}' });
    const claim = app.db.prepare('SELECT * FROM deliveries').get();
    assert.equal(claim?.status, 'claimed');
    second = createApp(options);
    await second.listen(0);
    assert.equal(calls, 1);
    let finished = false;
    closing = app.close().then(() => { finished = true; });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(finished, false);
    release();
    await closing;
  } finally {
    release();
    if (closing) await closing;
    else await app.close();
    if (second) await second.close();
    await rm(folder, { recursive: true, force: true });
  }
});
