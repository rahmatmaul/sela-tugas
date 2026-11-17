import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAnalytics } from '../analytics.mjs';

test('analytics retains failed batches and retries with stable event IDs', async () => {
  const db = new DatabaseSync(':memory:');
  const calls = [];
  const responses = [503, 200];
  const analytics = createAnalytics(db, { host: 'https://example.invalid', token: 'test-token', projectId: 1 }, async (url, options) => {
    calls.push({ url, data: JSON.parse(options.body) });
    return { ok: responses.shift() === 200, status: 503 };
  });
  try {
    analytics.capture('task_created', { demo: true, attachments: 1 });
    await analytics.flush();
    assert.equal(analytics.status().queued, 1);
    await analytics.flush();
    assert.equal(analytics.status().queued, 0);
    assert.equal(analytics.status().sent, 1);
    assert.equal(calls[0].data.batch[0].uuid, calls[1].data.batch[0].uuid);
    assert.equal(calls[0].data.batch[0].properties.source, 'sela-tugas-local');
    assert.equal(calls[0].url, 'https://example.invalid/batch/');
  } finally { db.close(); }
});

test('a concurrent flush waits for the active batch to finish', async () => {
  const db = new DatabaseSync(':memory:');
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const analytics = createAnalytics(db, { host: 'https://example.invalid', token: 'test', projectId: 1 }, () => response);
  try {
    analytics.capture('task_created', { demo: true });
    const first = analytics.flush();
    let secondFinished = false;
    const second = analytics.flush().then(() => { secondFinished = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(secondFinished, false);
    finish({ ok: true });
    await Promise.all([first, second]);
    assert.equal(analytics.status().queued, 0);
  } finally { finish({ ok: true }); await new Promise(resolve => setImmediate(resolve)); db.close(); }
});
