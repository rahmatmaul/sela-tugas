const day = 86_400_000;
const jakarta = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hourCycle: 'h23' });

export const todayWib = (date = new Date()) => jakarta.format(date);
export const daysUntil = (due, today) => (Date.parse(due) - Date.parse(today)) / day;
export const addDays = (today, days) => new Date(Date.parse(today) + days * day).toISOString().slice(0, 10);
export const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export const stages = {
  3: { title: 'H-3 · Mulai cicil', detail: 'Tenggat tiga hari lagi.' },
  2: { title: 'H-2 · Segera kerjakan', detail: 'Tenggat dua hari lagi.' },
  1: { title: 'H-1 · URGENT', detail: 'Tenggat besok.' }
};

export function eligible(tasks, now, delivered = new Set()) {
  if (Number(clock.format(now)) < 9) return [];
  const today = todayWib(now);
  return tasks.flatMap(task => {
    if (task.done || task.demo) return [];
    const stage = daysUntil(task.due, today);
    const key = `${task.id}/${task.due}/${stage}`;
    return stages[stage] && !delivered.has(key) ? [{ task, key, stage }] : [];
  }).sort((a, b) => a.stage - b.stage);
}

export function alarmWav(stage) {
  const notes = { 3: [[523, .24], [659, .42]], 2: [[440, .2], [587, .2], [784, .35]], 1: [[880, .16], [659, .16], [880, .16], [1046, .34]] }[stage];
  const rate = 22050;
  const samples = notes.reduce((sum, [, seconds]) => sum + Math.round(rate * (seconds + .07)), 0);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF');
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  let offset = 44;
  for (const [freq, seconds] of notes) {
    const length = Math.round(rate * seconds);
    for (let i = 0; i < length; i++) {
      const envelope = Math.min(i / 210, 1) * (1 - i / length) ** 1.5;
      buf.writeInt16LE(Math.round(10000 * envelope * Math.sin(2 * Math.PI * freq * i / rate)), offset);
      offset += 2;
    }
    offset += (Math.round(rate * (seconds + .07)) - length) * 2;
  }
  return buf;
}
