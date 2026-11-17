import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, eligible, validDate, alarmWav } from '../reminders.mjs';

const base = { id: 'a', due: '2026-11-20', done: false, demo: false };

test('dates use calendar days and reject impossible deadlines', () => {
  assert.equal(daysUntil('2026-12-01', '2026-11-30'), 1);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2028-02-29'), true);
});

test('each stage becomes eligible at 09.00 WIB on its own day', () => {
  for (const [day, stage] of [[17, 3], [18, 2], [19, 1]]) {
    const date = hour => new Date(`2026-11-${day}T0${hour}:00:00+07:00`);
    assert.deepEqual(eligible([base], date(8)), []);
    assert.deepEqual(eligible([base], date(9)).map(x => x.stage), [stage]);
  }
  assert.deepEqual(eligible([base], new Date('2026-11-20T09:00:00+07:00')), []);
});

test('delivery history, completed and demo tasks suppress real alarms', () => {
  const now = new Date('2026-11-19T15:00:00+07:00');
  assert.deepEqual(eligible([base, { ...base, id: 'b', done: true }, { ...base, id: 'c', demo: true }], now, new Set(['a/2026-11-20/1'])), []);
});

test('the three alarm stages have distinct PCM waveforms', () => {
  const sounds = [3, 2, 1].map(alarmWav);
  for (const sound of sounds) assert.equal(sound.toString('ascii', 0, 4), 'RIFF');
  assert.notDeepEqual(sounds[0], sounds[1]);
  assert.notDeepEqual(sounds[1], sounds[2]);
});
