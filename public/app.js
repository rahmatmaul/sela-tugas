const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const dayMs = 86400000;
const dateText = value => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
const state = { tasks: [], settings: {}, edit: null, uploads: [], removed: [], busy: false, filter: 'active', search: '', captureSession: 0, recordingPhase: 'idle', pendingFiles: 0 };
const url = new URL(location.href);
state.filter = ['active', 'done', 'all'].includes(url.searchParams.get('filter')) ? url.searchParams.get('filter') : 'active';
state.search = url.searchParams.get('q') || '';
$('#search').value = state.search;

async function api(path, method = 'GET', data) {
  const response = await fetch('/api/' + path, { method, headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Permintaan gagal. Coba lagi.');
  return result;
}
function showError(target, message = '') {
  const element = $(target);
  element.textContent = message;
  element.hidden = !message;
}
function announce(message) { $('#status').textContent = message; }
function days(task) { return Math.round((Date.parse(task.due) - Date.parse(state.settings.today)) / dayMs); }
function priority(task) {
  if (task.done) return { text: 'Selesai', tone: 'plain' };
  const left = days(task);
  if (left < 0) return { text: 'Terlewat ' + Math.abs(left) + ' hari', tone: 'red' };
  if (left === 0) return { text: 'Hari ini', tone: 'red' };
  if (left === 1) return { text: 'H-1 Urgent', tone: 'red' };
  if (left === 2) return { text: 'H-2 Segera', tone: 'amber' };
  if (left === 3) return { text: 'H-3 Mulai cicil', tone: 'neutral' };
  return { text: left + ' hari lagi', tone: 'plain' };
}
const badge = task => { const p = priority(task); return '<span class="tag ' + p.tone + '">' + p.text + '</span>'; };

function render() {
  const active = state.tasks.filter(task => !task.done);
  const focus = active[0];
  if (focus) {
    const left = days(focus);
    const deadline = left === 1 ? 'Besok' : left === 0 ? 'Hari ini' : left < 0 ? 'Terlewat' : left + ' hari lagi';
    $('#focus').innerHTML = `<div class="focus-top"><span>Fokus terdekat</span>${badge(focus)}</div>
      <h2>${escapeHtml(focus.title)}</h2><p>${escapeHtml(focus.course || 'Tugas pribadi')}${focus.demo ? ' / Contoh demo' : ''}</p>
      <div class="focus-bottom"><div class="due-day">${deadline}<small>${dateText(focus.due)}</small></div>
      <button class="secondary" data-open="${focus.id}">Buka tugas</button></div>`;
  } else {
    $('#focus').innerHTML = '<div class="focus-top"><span>Fokus terdekat</span></div><h2>Kasih ruang buat hal berikutnya.</h2><p>Tugas aktif lo akan muncul di sini, dari tenggat paling dekat.</p><div class="focus-bottom"><button class="secondary" data-new>Catat tugas pertama</button></div>';
  }
  const rows = state.tasks.filter(task => {
    const matchesTab = state.filter === 'all' || (state.filter === 'done' ? task.done : !task.done);
    const text = (task.title + ' ' + task.course).toLocaleLowerCase('id');
    return matchesTab && text.includes(state.search.toLocaleLowerCase('id'));
  });
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter)));
  $('#task-count').textContent = active.length + ' aktif';
  $('#empty').hidden = rows.length !== 0;
  $('#tasks-table').hidden = rows.length === 0;
  $('#empty-text').textContent = state.search ? 'Belum ada hasil. Coba kata kunci lain.' : state.filter === 'done' ? 'Tugas yang ditandai selesai akan muncul di sini.' : 'Catat tugas pertama, atau jelajahi contoh untuk demo.';
  $('#load-demo').hidden = state.tasks.length > 0 || !!state.search || state.filter === 'done';
  $('#tasks').innerHTML = rows.map(task => `<tr class="${task.done ? 'completed' : ''}">
    <td class="check-cell"><label class="task-check"><input type="checkbox" data-complete="${task.id}" ${task.done ? 'checked' : ''} aria-label="${escapeHtml((task.done ? 'Aktifkan kembali ' : 'Selesaikan ') + task.title)}"></label></td>
    <td><span class="task-name">${escapeHtml(task.title)}</span><span class="task-meta">${escapeHtml(task.course || 'Tugas pribadi')}${task.files.length ? ' / ' + task.files.length + ' lampiran' : ''}${task.demo ? ' / Contoh demo' : ''}</span></td>
    <td><time datetime="${task.due}">${dateText(task.due)}</time></td><td>${badge(task)}</td><td><button class="quiet" data-open="${task.id}" aria-label="Buka ${escapeHtml(task.title)}">Detail</button></td></tr>`).join('');
  $('#demo-toggle').textContent = state.tasks.some(t => t.demo) ? 'Bersihkan contoh demo' : 'Isi contoh demo';
  $('#overview').hidden = false;
  $('#loading').hidden = true;
}
function renderSettings() {
  const settings = state.settings;
  $('#alarm-toggle').setAttribute('aria-checked', String(!!settings.enabled));
  $('#alarm-toggle').setAttribute('aria-label', settings.enabled ? 'Nonaktifkan alarm otomatis' : 'Aktifkan alarm otomatis');
  $('#alarm-status').textContent = settings.enabled ? 'Aktif setiap hari pukul 09.00 WIB' : 'Aktifkan untuk pengingat otomatis';
  document.querySelectorAll('[data-preview]').forEach(button => { button.disabled = settings.alarmBusy || !settings.notifications; });
  $('#alarm-message').textContent = settings.lastError ? 'Alarm gagal. ' + settings.lastError : settings.alarmBusy ? 'Alarm desktop sedang tampil.' : '';
  $('#date').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date());
}
async function refresh() {
  const [tasks, settings] = await Promise.all([api('tasks'), api('settings')]);
  state.tasks = tasks;
  state.settings = settings;
  render();
  renderSettings();
  showError('#global-error');
}

let mediaRecorder;
let mediaStream;
let recordingTimer;
let recognition;
function stopCapture() {
  state.captureSession++;
  clearTimeout(recordingTimer);
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  mediaStream?.getTracks().forEach(track => track.stop());
  recognition?.stop();
  mediaRecorder = null;
  mediaStream = null;
  recognition = null;
  state.recordingPhase = 'idle';
  $('#record').disabled = false;
  $('#record').textContent = 'Rekam VN';
  $('#dictate').textContent = 'Dikte catatan';
}
function openEditor(id) {
  if (state.busy) return;
  stopCapture();
  state.uploads = [];
  state.removed = [];
  state.edit = id ? state.tasks.find(task => task.id === id) : null;
  const task = state.edit;
  const form = $('#task-form');
  form.reset();
  for (const name of ['title', 'course', 'description', 'due']) form.elements.namedItem(name).value = task?.[name] || '';
  $('#editor-title').textContent = task ? 'Detail tugas' : 'Catat tugas baru';
  $('#delete-task').hidden = !task;
  $('#editor').hidden = false;
  showError('#form-error');
  $('#capture-status').textContent = 'Maksimal empat lampiran, masing-masing 6 MB. Dikte mengisi teks dari suara langsung.';
  renderAttachments();
  $('#editor').scrollIntoView({ block: 'start' });
  $('#task-title').focus({ preventScroll: true });
}
function closeEditor() {
  if (state.busy) return;
  stopCapture();
  $('#editor').hidden = true;
  state.edit = null;
  state.uploads = [];
  state.removed = [];
  $('#new-task').focus({ preventScroll: true });
}
function renderAttachments() {
  const existing = (state.edit?.files || []).filter(file => !state.removed.includes(file.id));
  const all = [...existing.map(file => ({ ...file, saved: true })), ...state.uploads];
  $('#attachments').innerHTML = all.map(file => {
    const source = file.saved ? file.url : 'data:' + file.type + ';base64,' + file.data;
    return `<div class="attachment">${file.type.startsWith('image/') ? `<a href="${source}" target="_blank" rel="noreferrer"><img src="${source}" alt="${escapeHtml(file.name)}"></a>` : `<audio src="${source}" controls preload="metadata"></audio>`}
      <span>${escapeHtml(file.name)}</span><button class="quiet" type="button" data-remove="${file.id}" data-saved="${file.saved ? 'yes' : 'no'}" aria-label="Lepas ${escapeHtml(file.name)}">Lepas lampiran</button></div>`;
  }).join('');
}
function asBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('File gagal dibaca. Pilih ulang file.'));
    reader.readAsDataURL(blob);
  });
}
async function addFiles(files) {
  const session = state.captureSession;
  state.pendingFiles++;
  try {
    const savedCount = (state.edit?.files || []).filter(f => !state.removed.includes(f.id)).length;
    if (savedCount + state.uploads.length + files.length > 4) throw new Error('Maksimal empat lampiran per tugas.');
    const prepared = [];
    for (const file of files) {
      if (file.size > 6 * 1024 * 1024) throw new Error('Setiap lampiran maksimal 6 MB.');
      const type = file.type.split(';')[0];
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp4'].includes(type)) throw new Error('Pilih foto JPG, PNG, WebP, GIF atau audio WebM, OGG, WAV, MP3, M4A.');
      prepared.push({ id: crypto.randomUUID(), name: file.name, type, data: await asBase64(file) });
    }
    if (session !== state.captureSession) return;
    const latestSaved = (state.edit?.files || []).filter(f => !state.removed.includes(f.id)).length;
    if (latestSaved + state.uploads.length + prepared.length > 4) throw new Error('Maksimal empat lampiran per tugas.');
    state.uploads.push(...prepared);
    renderAttachments();
  } catch (error) {
    if (session === state.captureSession) throw error;
  } finally { state.pendingFiles--; }
}
$('#new-task').addEventListener('click', () => openEditor());
$('#cancel').addEventListener('click', closeEditor);
$('#cancel-top').addEventListener('click', closeEditor);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeEditor(); });
document.addEventListener('click', event => {
  const open = event.target.closest('[data-open]');
  if (open) openEditor(open.dataset.open);
  if (event.target.closest('[data-new]')) openEditor();
});
document.addEventListener('change', async event => {
  const id = event.target.dataset.complete;
  if (!id) return;
  const task = state.tasks.find(t => t.id === id);
  event.target.disabled = true;
  try {
    await api('tasks/' + id, 'PATCH', { version: task.version, done: event.target.checked });
    await refresh();
    announce(event.target.checked ? 'Tugas selesai.' : 'Tugas aktif kembali.');
  } catch (error) { showError('#global-error', error.message); await refresh().catch(() => {}); }
});
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  updateUrl();
  render();
}));
function updateUrl() {
  const next = new URL(location.href);
  next.searchParams.set('filter', state.filter);
  if (state.search) next.searchParams.set('q', state.search);
  else next.searchParams.delete('q');
  history.replaceState({}, '', next);
}
$('#search').addEventListener('input', event => { state.search = event.target.value; updateUrl(); render(); });
$('#task-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy) return;
  if (state.pendingFiles || state.recordingPhase === 'starting' || state.recordingPhase === 'finishing') return showError('#form-error', 'Tunggu sampai lampiran atau rekaman selesai diproses.');
  if (mediaRecorder?.state === 'recording' || recognition) return showError('#form-error', 'Hentikan rekaman atau dikte sebelum menyimpan.');
  state.busy = true;
  $('#save').disabled = true;
  $('#save').textContent = 'Menyimpan…';
  $('#task-form').inert = true;
  showError('#form-error');
  const fields = Object.fromEntries(new FormData(event.target));
  const payload = { title: fields.title, course: fields.course, description: fields.description, due: fields.due, files: state.uploads, removeFiles: state.removed };
  if (state.edit) payload.version = state.edit.version;
  try {
    await api(state.edit ? 'tasks/' + state.edit.id : 'tasks', state.edit ? 'PATCH' : 'POST', payload);
    state.busy = false;
    closeEditor();
    await refresh();
    announce('Tugas tersimpan.');
  } catch (error) { showError('#form-error', error.message); }
  finally {
    state.busy = false;
    $('#task-form').inert = false;
    $('#save').disabled = false;
    $('#save').textContent = 'Simpan tugas';
  }
});
$('#delete-task').addEventListener('click', async () => {
  if (!state.edit || !confirm('Hapus tugas ini beserta lampirannya?')) return;
  try { await api('tasks/' + state.edit.id, 'DELETE'); closeEditor(); await refresh(); announce('Tugas dihapus.'); }
  catch (error) { showError('#form-error', error.message); }
});
for (const selector of ['#photo-input', '#audio-input']) $(selector).addEventListener('change', async event => {
  try { await addFiles([...event.target.files]); showError('#form-error'); }
  catch (error) { showError('#form-error', error.message); }
  event.target.value = '';
});
$('#attachments').addEventListener('click', event => {
  const button = event.target.closest('[data-remove]');
  if (!button) return;
  if (button.dataset.saved === 'yes') state.removed.push(button.dataset.remove);
  else state.uploads = state.uploads.filter(file => file.id !== button.dataset.remove);
  renderAttachments();
});
$('#record').addEventListener('click', async () => {
  if (state.recordingPhase === 'starting' || state.recordingPhase === 'finishing') return;
  if (mediaRecorder?.state === 'recording') {
    state.recordingPhase = 'finishing';
    $('#record').disabled = true;
    mediaRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return showError('#form-error', 'Browser ini belum mendukung perekaman. Gunakan lampirkan audio.');
  const session = state.captureSession;
  state.recordingPhase = 'starting';
  $('#record').disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (session !== state.captureSession) { stream.getTracks().forEach(t => t.stop()); return; }
    mediaStream = stream;
    const chunks = [];
    const recorder = new MediaRecorder(stream);
    mediaRecorder = recorder;
    let localTimer;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      clearTimeout(localTimer);
      stream.getTracks().forEach(track => track.stop());
      if (session !== state.captureSession) return;
      const type = chunks[0]?.type || 'audio/webm';
      const file = new File(chunks, 'Catatan-suara-' + Date.now() + (type.includes('mp4') ? '.m4a' : '.webm'), { type });
      try {
        await addFiles([file]);
        if (session !== state.captureSession) return;
        $('#capture-status').textContent = 'VN siap dilampirkan. Klik Simpan tugas.';
      } catch (error) {
        if (session === state.captureSession) showError('#form-error', error.message);
      }
      if (session !== state.captureSession) return;
      state.recordingPhase = 'idle';
      $('#record').disabled = false;
      $('#record').textContent = 'Rekam VN';
    };
    recorder.start();
    state.recordingPhase = 'recording';
    localTimer = setTimeout(() => {
      if (recorder.state === 'recording') {
        state.recordingPhase = 'finishing';
        $('#record').disabled = true;
        recorder.stop();
      }
    }, 60000);
    recordingTimer = localTimer;
    $('#record').textContent = 'Hentikan VN';
    $('#capture-status').textContent = 'Merekam VN, maksimal 60 detik. Klik Hentikan VN setelah selesai.';
  } catch (error) {
    if (session === state.captureSession) {
      state.recordingPhase = 'idle';
      showError('#form-error', 'Mikrofon belum dapat dipakai. Izinkan mikrofon di browser, atau lampirkan file audio.');
    }
  }
  finally { if (session === state.captureSession && state.recordingPhase !== 'finishing') $('#record').disabled = false; }
});
$('#dictate').addEventListener('click', () => {
  if (recognition) { recognition.stop(); return; }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return showError('#form-error', 'Dikte belum tersedia di browser ini. Gunakan Chrome atau Edge, atau tulis catatan.');
  const session = state.captureSession;
  const speech = new SpeechRecognition();
  recognition = speech;
  speech.lang = 'id-ID';
  speech.continuous = true;
  speech.interimResults = false;
  speech.onresult = event => {
    if (session !== state.captureSession) return;
    const text = [...event.results].slice(event.resultIndex).filter(result => result.isFinal).map(result => result[0].transcript).join(' ');
    const field = $('#description');
    field.value = (field.value + ' ' + text).trim().slice(0, 5000);
  };
  speech.onerror = event => { if (session === state.captureSession) showError('#form-error', 'Dikte terhenti (' + event.error + '). Periksa izin mikrofon dan koneksi internet.'); };
  speech.onend = () => { if (recognition === speech) { recognition = null; $('#dictate').textContent = 'Dikte catatan'; } };
  try { recognition.start(); $('#dictate').textContent = 'Hentikan dikte'; $('#capture-status').textContent = 'Mendengarkan. Ucapkan instruksi tugas, lalu klik Hentikan dikte. Layanan browser dapat mengirim suara untuk pengenalan.'; }
  catch (error) { recognition = null; showError('#form-error', 'Dikte belum dapat dimulai. Coba lagi.'); }
});
$('#alarm-toggle').addEventListener('click', async () => {
  $('#alarm-toggle').disabled = true;
  try { await api('settings', 'PATCH', { enabled: !state.settings.enabled }); state.settings = await api('settings'); renderSettings(); }
  catch (error) { showError('#global-error', error.message); }
  finally { $('#alarm-toggle').disabled = false; }
});
document.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', async () => {
  document.querySelectorAll('[data-preview]').forEach(b => { b.disabled = true; });
  try { await api('alarms/preview', 'POST', { stage: Number(button.dataset.preview) }); $('#alarm-message').textContent = 'Alarm demo dibuka di desktop Windows.'; }
  catch (error) { $('#alarm-message').textContent = error.message; }
  finally { state.settings = await api('settings').catch(() => state.settings); renderSettings(); }
}));
async function toggleDemo() {
  try {
    const exists = state.tasks.some(task => task.demo);
    if (exists && !confirm('Bersihkan semua tugas bertanda Contoh demo?')) return;
    await api('demo', exists ? 'DELETE' : 'POST');
    await refresh();
  } catch (error) { showError('#global-error', error.message); }
}
$('#load-demo').addEventListener('click', toggleDemo);
$('#demo-toggle').addEventListener('click', toggleDemo);
window.addEventListener('beforeunload', () => { stopCapture(); });
await refresh().catch(error => { $('#loading').hidden = true; showError('#global-error', 'Aplikasi belum terhubung. ' + error.message + ' Jalankan ulang Sela Tugas lalu muat ulang halaman.'); });
setInterval(() => void refresh().catch(error => showError('#global-error', 'Koneksi terputus. ' + error.message)), 30000);
