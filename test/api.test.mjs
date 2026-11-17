import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';

test('task lifecycle persists safely with photos, edits and completion', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sela-test-'));
  const instance = createApp({ dataDir: folder, notifications: false });
  await instance.listen(0);
  const root = `http://127.0.0.1:${instance.server.address().port}`;
  const api = async (path, method = 'GET', data) => {
    const response = await fetch(root + path, { method, headers: { 'content-type': 'application/json' }, body: data && JSON.stringify(data) });
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.deepEqual((await api('/api/tasks')).data, []);
    assert.equal((await api('/api/tasks', 'POST', { title: '', due: '2026-11-20' })).status, 400);
    assert.equal((await api('/api/tasks', 'POST', { title: 'Tanggal salah', due: '2026-02-30' })).status, 400);
    assert.equal((await api('/api/tasks', 'POST', { title: 'File salah', due: '2026-11-20', files: [{ name: 'x.svg', type: 'image/svg+xml', data: 'eA==' }] })).status, 400);
    const result = await api('/api/tasks', 'POST', { title: '  Makalah  ', course: 'Integrasi', description: 'Baca modul', due: '2026-11-20',
      files: [{ name: 'foto.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1kAAAAASUVORK5CYII=' }] });
    assert.equal(result.status, 201);
    const task = result.data;
    assert.equal(task.title, 'Makalah');
    assert.equal(task.files.length, 1);
    assert.equal((await fetch(root + task.files[0].url)).headers.get('content-type'), 'image/png');
    const update = await api('/api/tasks/' + task.id, 'PATCH', { version: task.version, title: 'Revisi makalah', done: true });
    assert.equal(update.status, 200);
    assert.equal(update.data.done, true);
    assert.equal(update.data.files.length, 1);
    assert.equal((await api('/api/tasks/' + task.id, 'PATCH', { version: task.version, title: 'Basi' })).status, 409);
    assert.equal((await api('/api/tasks/' + task.id, 'PATCH', { version: update.data.version, removeFiles: [task.files[0].id] })).data.files.length, 0);
    assert.equal((await api('/api/tasks')).data.length, 1);
    const db = await instance.db.prepare('select count(*) as n from tasks').get();
    assert.equal(db.n, 1);
    await api('/api/tasks/' + task.id, 'DELETE');
    assert.deepEqual((await api('/api/tasks')).data, []);
    assert.equal((await api('/api/tasks/missing', 'PATCH', {})).status, 404);
    assert.equal((await api('/api/alarms/preview', 'POST', { stage: 99 })).status, 400);
    const rejected = await fetch(root + '/api/tasks', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(rejected.status, 403);
  } finally {
    await instance.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test('tasks survive restart and example data stays separate from real alarms', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sela-restart-'));
  let instance = createApp({ dataDir: folder, notifications: false });
  try {
    await instance.listen(0);
    let root = `http://127.0.0.1:${instance.server.address().port}`;
    assert.equal((await fetch(root + '/api/demo', { method: 'POST' })).status, 201);
    assert.equal((await (await fetch(root + '/api/tasks')).json()).length, 3);
    await instance.close();
    instance = createApp({ dataDir: folder, notifications: false });
    await instance.listen(0);
    root = `http://127.0.0.1:${instance.server.address().port}`;
    const tasks = await (await fetch(root + '/api/tasks')).json();
    assert.equal(tasks.length, 3);
    assert.ok(tasks.every(t => t.demo));
    assert.equal((await (await fetch(root + '/api/settings')).json()).enabled, false);
    await fetch(root + '/api/demo', { method: 'DELETE' });
    assert.equal((await (await fetch(root + '/api/tasks')).json()).length, 0);
  } finally {
    await instance.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test('four attachments of the advertised six MiB limit can be saved', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sela-large-'));
  const instance = createApp({ dataDir: folder, notifications: false });
  await instance.listen(0);
  try {
    const content = Buffer.alloc(6 * 1024 * 1024).toString('base64');
    const response = await fetch(`http://127.0.0.1:${instance.server.address().port}/api/tasks`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Lampiran besar', due: '2026-11-21', files: [1,2,3,4].map(n => ({ name: 'file-' + n + '.wav', type: 'audio/wav', data: content })) })
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).files.length, 4);
  } finally { await instance.close(); await rm(folder, { recursive: true, force: true }); }
});
