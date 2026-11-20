/**
 * Aplikasi utama Checklist 1000 Hari.
 * Menghubungkan layar -> lapisan API (api.js) -> antrean offline (store.js)
 * -> mesin sinkronisasi (sync.js).
 */
import { api, fetchRangeChunked } from './api.js';
import { getConfig, setConfig, isConfigured, configFromUrl } from './config.js';
import {
  enqueueSave, applyQueueToDay, hasPendingFor, pendingCount,
  getCache, setCache, getPrefs, setPrefs, onStoreChange
} from './store.js';
import { flushQueue, setSyncHandlers } from './sync.js';

// ==================== Util tanggal (WIB) ====================
const dtfYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });
const dtfHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hourCycle: 'h23' });
const dtfHM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function todayYmd() { return dtfYmd.format(new Date()); }
function nowHourWIB() { return Number(dtfHour.format(new Date())); }
function nowHMWIB() { return dtfHM.format(new Date()); }

function parseYmd(ymd) {
  const p = String(ymd).split('-').map(Number);
  return { y: p[0], m: p[1], d: p[2] };
}
function ymdFromMs(ms) {
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return d.getUTCFullYear() + '-' + mm + '-' + dd;
}
function addDays(ymd, n) {
  const p = parseYmd(ymd);
  return ymdFromMs(Date.UTC(p.y, p.m - 1, p.d) + n * 86400000);
}
function diffDays(aYmd, bYmd) {
  const a = parseYmd(aYmd), b = parseYmd(bYmd);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}
function fmtDateLong(ymd) {
  if (!ymd) return '—';
  const p = parseYmd(ymd);
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d, 12));
  return new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}
function normalizeSkor(v) {
  if (v === null || v === undefined || v === '') return null;
  let n = typeof v === 'number' ? v : parseFloat(String(v).replace('%', '').replace(',', '.'));
  if (!isFinite(n)) return null;
  if (n > 1.5) n = n / 100; // tersimpan sebagai persen 0-100
  return Math.max(0, Math.min(1, n));
}
function fmtVal(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return String(v);
}

// ==================== State ====================
const S = {
  boot: null,
  todayNumber: null,
  dayNumber: null,
  serverDay: null,
  jenis: 'Normal',
  shift: 'Pagi',
  rangeAll: null,
  rangeAllAt: 0,
  historyLoaded: false,
  summaryLoaded: false,
  timeLoaded: false
};

const $ = (id) => document.getElementById(id);
let toastTimer = null;
function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms || 4000);
}

function startDate() { return S.boot && S.boot.settings ? S.boot.settings.startDate : null; }
function dayNumberFromDate(ymd) {
  if (!startDate()) return null;
  return diffDays(startDate(), ymd) + 1;
}
function dateFromDayNumber(n) {
  if (!startDate()) return '';
  return addDays(startDate(), n - 1);
}
function effectiveDay() {
  const base = S.serverDay || {
    dayNumber: S.dayNumber, date: dateFromDayNumber(S.dayNumber || 1),
    jenisHari: '', shift: '', habits: Array(18).fill(false),
    screenTime: null, languageMinutes: null,
    selesai: '', target: '', skor: '', status: '', warning: ''
  };
  return applyQueueToDay(base, S.dayNumber);
}
function preview() {
  const day = effectiveDay();
  const apps = (S.boot && S.boot.applicable && S.boot.applicable[S.jenis]) || Array(18).fill(true);
  let selesai = 0;
  for (let i = 0; i < 18; i++) if (apps[i] && day.habits[i]) selesai++;
  const target = (S.boot && S.boot.targets && S.boot.targets[S.jenis]) || Number(day.target) || 0;
  const dirty = hasPendingFor(S.dayNumber);
  let skor = normalizeSkor(day.skor);
  let status = day.status || '';
  if (dirty || !status) {
    if (target > 0) {
      skor = selesai / target;
      const threshold = (S.boot && S.boot.settings.passThreshold) || 0.8;
      status = skor >= threshold ? 'Lolos' : 'Belum lolos';
    }
  }
  return { day, apps, selesai, target, skor, status, dirty };
}

// ==================== Sinkronisasi ====================
function updateSyncBadge() {
  const n = pendingCount();
  const dot = $('syncDot'), text = $('syncText');
  if (n > 0) {
    text.textContent = 'Belum tersinkron (' + n + ')';
    dot.className = 'sync-dot warn';
  } else if (!navigator.onLine) {
    text.textContent = 'Offline';
    dot.className = 'sync-dot off';
  } else {
    text.textContent = 'Tersinkron';
    dot.className = 'sync-dot ok';
  }
}
setSyncHandlers({
  onDay(day) {
    if (day.dayNumber === S.dayNumber) {
      S.serverDay = day;
      renderToday();
    }
    updateSyncBadge();
  },
  onError(msg) { toast(msg, 6000); },
  onChange() { updateSyncBadge(); }
});
onStoreChange(updateSyncBadge);
window.addEventListener('offline', updateSyncBadge);
window.addEventListener('online', updateSyncBadge);

// ==================== Layar Hari Ini ====================
function payloadWithDefaults(partial) {
  const p = Object.assign({}, partial);
  const eff = effectiveDay();
  if (p.jenisHari === undefined && !eff.jenisHari) p.jenisHari = S.jenis;
  if (p.shift === undefined && !eff.shift) p.shift = S.shift;
  return p;
}

function renderToday() {
  if (!S.dayNumber) return;
  const { day, apps, selesai, target, skor, status, dirty } = preview();

  $('dayTitle').textContent = 'Hari ke-' + S.dayNumber;
  $('dayDate').textContent = fmtDateLong(day.date || dateFromDayNumber(S.dayNumber));
  $('prevDayBtn').disabled = S.dayNumber <= 1;
  $('nextDayBtn').disabled = S.dayNumber >= 1000;
  $('datePick').value = day.date || dateFromDayNumber(S.dayNumber);

  const warn = $('warningBanner');
  if (day.warning) { warn.textContent = '⚠️ ' + day.warning; warn.hidden = false; }
  else warn.hidden = true;

  $('progressText').textContent = selesai + '/' + (target || '–') + ' selesai';
  $('progressFill').style.width = (target > 0 ? Math.min(100, (selesai / target) * 100) : 0) + '%';
  $('progressBar').setAttribute('aria-valuenow', target > 0 ? Math.round((selesai / target) * 100) : 0);
  $('scoreText').textContent = skor !== null ? 'Skor ' + Math.round(skor * 100) + '%' : '';
  const chip = $('statusChip');
  chip.textContent = status || 'Belum ada status';
  chip.className = 'status-chip ' + (status === 'Lolos' ? 'lolos' : (status === 'Gagal' ? 'gagal' : 'netral'));
  $('estimateNote').textContent = dirty
    ? 'Perkiraan — menunggu sinkron ke spreadsheet'
    : (!navigator.onLine ? 'Data tersimpan terakhir' : '');

  document.querySelectorAll('#jenisSeg button').forEach(b =>
    b.classList.toggle('active', b.dataset.jenis === S.jenis));
  document.querySelectorAll('#shiftSeg button').forEach(b =>
    b.classList.toggle('active', b.dataset.shift === S.shift));

  const names = (S.boot && S.boot.habitNames) || [];
  const buildGroup = (containerId, countId, from, to) => {
    const box = $(containerId);
    box.innerHTML = '';
    let total = 0, done = 0;
    for (let i = from; i < to; i++) {
      if (!apps[i]) continue;
      total++;
      if (day.habits[i]) done++;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'habit' + (day.habits[i] ? ' checked' : '');
      btn.setAttribute('role', 'checkbox');
      btn.setAttribute('aria-checked', day.habits[i] ? 'true' : 'false');
      btn.setAttribute('aria-label', names[i] || ('Kebiasaan ' + (i + 1)));
      btn.innerHTML = '<span class="box">' + (day.habits[i] ? '✓' : '') + '</span><span class="habit-name"></span>';
      btn.querySelector('.habit-name').textContent = names[i] || ('Kebiasaan ' + (i + 1));
      btn.addEventListener('click', () => toggleHabit(i));
      box.appendChild(btn);
    }
    $(countId).textContent = total ? '(' + done + '/' + total + ')' : '';
    return total;
  };
  const t1 = buildGroup('groupInti', 'intiCount', 0, 9);
  const t2 = buildGroup('groupTambahan', 'tambahanCount', 9, 18);
  $('noHabitMsg').hidden = (t1 + t2) > 0;

  if (document.activeElement !== $('screenTimeInput')) {
    $('screenTimeInput').value = day.screenTime === null || day.screenTime === undefined ? '' : day.screenTime;
  }
  if (document.activeElement !== $('langInput')) {
    $('langInput').value = day.languageMinutes === null || day.languageMinutes === undefined ? '' : day.languageMinutes;
  }
  const limit = S.boot ? S.boot.settings.screenLimit : 0;
  const over = day.screenTime !== null && day.screenTime !== undefined && limit > 0 && Number(day.screenTime) > limit;
  $('screenWarn').hidden = !over;
  if (over) $('screenWarn').textContent = 'Melebihi batas screen time ' + fmtVal(limit) + ' jam.';
  $('screenTimeInput').classList.toggle('over', !!over);

  $('todayLoading').hidden = true;
  $('todayContent').hidden = false;
}

function toggleHabit(idx) {
  const day = effectiveDay();
  const next = !day.habits[idx];
  enqueueSave(S.dayNumber, payloadWithDefaults({ habits: { [idx]: next } }));
  renderToday();
  flushQueue();
}

async function openDay(n) {
  if (!S.boot) return;
  n = Math.max(1, Math.min(1000, Math.floor(n)));
  S.dayNumber = n;
  $('todayError').hidden = true;
  const cached = getCache('day-' + n);
  if (cached) {
    S.serverDay = cached;
    const eff = effectiveDay();
    S.jenis = eff.jenisHari || getPrefs().lastJenis;
    S.shift = eff.shift || getPrefs().lastShift;
    renderToday();
  } else {
    $('todayLoading').hidden = false;
    $('todayContent').hidden = true;
  }
  try {
    const day = await api.day(n);
    S.serverDay = day;
    setCache('day-' + n, day);
    const eff = effectiveDay();
    S.jenis = eff.jenisHari || getPrefs().lastJenis;
    S.shift = eff.shift || getPrefs().lastShift;
    renderToday();
  } catch (err) {
    if (!cached) {
      $('todayLoading').hidden = true;
      $('todayErrorText').textContent = 'Gagal memuat hari ini: ' + err.message + ' Periksa sinyal, lalu coba lagi. Centangan yang sudah tersimpan di HP tidak hilang.';
      $('todayError').hidden = false;
    } else {
      toast('Offline — menampilkan data tersimpan terakhir.');
    }
  }
}

// ==================== Navigasi layar ====================
function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
  window.scrollTo(0, 0);
  if (name === 'history' && !S.historyLoaded) { S.historyLoaded = true; renderHistory(); }
  if (name === 'summary' && !S.summaryLoaded) { S.summaryLoaded = true; renderSummary(); }
  if (name === 'time' && !S.timeLoaded) { S.timeLoaded = true; renderTime(); }
}

// ==================== Riwayat ====================
async function loadRangeAll(force) {
  if (!force && S.rangeAll && (Date.now() - S.rangeAllAt) < 6 * 3600 * 1000) return S.rangeAll;
  const cached = getCache('rangeAll');
  if (!force && cached && cached.days && (Date.now() - cached.at) < 6 * 3600 * 1000) {
    S.rangeAll = cached.days; S.rangeAllAt = cached.at; return S.rangeAll;
  }
  const to = S.todayNumber || 1;
  const days = await fetchRangeChunked(1, to);
  S.rangeAll = days; S.rangeAllAt = Date.now();
  setCache('rangeAll', { at: S.rangeAllAt, days });
  return days;
}

function computeStreak(days) {
  const map = new Map(days.map(d => [d.dayNumber, d.status]));
  const today = S.todayNumber || 0;
  let start = map.get(today) === 'Lolos' ? today : today - 1;
  let now = 0;
  while (start >= 1 && map.get(start) === 'Lolos') { now++; start--; }
  let best = 0, run = 0;
  const sorted = [...map.keys()].sort((a, b) => a - b);
  for (const n of sorted) {
    if (map.get(n) === 'Lolos') { run++; best = Math.max(best, run); } else run = 0;
  }
  return { now, best };
}

async function renderHistory() {
  if (!S.boot) { $('historyMsg').textContent = 'Belum terhubung ke spreadsheet.'; return; }
  const monthVal = $('monthInput').value || todayYmd().slice(0, 7);
  const [yy, mm] = monthVal.split('-').map(Number);
  const firstYmd = yy + '-' + String(mm).padStart(2, '0') + '-01';
  const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const lastYmd = yy + '-' + String(mm).padStart(2, '0') + '-' + String(daysInMonth).padStart(2, '0');
  const from = Math.max(1, dayNumberFromDate(firstYmd));
  const to = Math.min(1000, dayNumberFromDate(lastYmd));
  const cal = $('calendar');
  cal.innerHTML = '';
  if (to < 1 || from > 1000 || from > to) {
    $('historyMsg').textContent = 'Bulan ini di luar rentang 1000 hari tantangan.';
  } else {
    $('historyMsg').textContent = 'Memuat…';
    let days = getCache('range-' + from + '-' + to);
    try {
      const res = await api.range(from, to);
      days = res.days; setCache('range-' + from + '-' + to, days);
    } catch (e) { /* pakai cache */ }
    if (!days) { $('historyMsg').textContent = 'Gagal memuat dan tidak ada data tersimpan. Periksa sinyal lalu buka lagi layar ini.'; }
    else {
      $('historyMsg').textContent = '';
      const map = new Map(days.map(d => [d.dayNumber, d]));
      const firstWeekday = (new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay() + 6) % 7; // Senin = 0
      for (let i = 0; i < firstWeekday; i++) {
        const blank = document.createElement('div');
        blank.className = 'cal-cell blank';
        cal.appendChild(blank);
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const ymd = yy + '-' + String(mm).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const n = dayNumberFromDate(ymd);
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cal-cell';
        if (n < 1 || n > 1000) {
          cell.disabled = true;
          cell.innerHTML = '<span class="cal-d">' + d + '</span>';
        } else {
          const info = map.get(n);
          let cls = 'kosong';
          if (info && info.status === 'Lolos') cls = 'lolos';
          else if (info && info.status === 'Gagal') cls = 'gagal';
          else if (info && info.hasData) cls = 'sebagian';
          cell.classList.add(cls);
          if (n > (S.todayNumber || 0)) cell.classList.add('future');
          cell.innerHTML = '<span class="cal-d">' + d + '</span><span class="cal-n">H' + n + '</span>';
          cell.setAttribute('aria-label', 'Hari ke-' + n + (info && info.status ? ', ' + info.status : ''));
          cell.addEventListener('click', () => { switchScreen('today'); openDay(n); });
        }
        cal.appendChild(cell);
      }
    }
  }
  // Streak
  try {
    const all = await loadRangeAll(false);
    const st = computeStreak(all);
    $('streakNow').textContent = st.now;
    $('streakBest').textContent = st.best;
  } catch (e) {
    $('streakNow').textContent = '–';
    $('streakBest').textContent = '–';
  }
}

// ==================== Ringkasan ====================
function buildTable(tableEl, headers, rows) {
  tableEl.innerHTML = '';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h === '' ? '—' : h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  tableEl.appendChild(thead);
  const tbody = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    r.forEach(c => {
      const td = document.createElement('td');
      td.textContent = fmtVal(c);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tableEl.appendChild(tbody);
}

async function renderSummary() {
  let data = getCache('summary');
  try {
    data = await api.summary();
    setCache('summary', data);
  } catch (e) { /* pakai cache */ }
  const wrap = $('summaryCards');
  wrap.innerHTML = '';
  if (!data) {
    $('summaryMsg').textContent = 'Gagal memuat ringkasan dan tidak ada data tersimpan. Periksa sinyal lalu buka lagi layar ini.';
    return;
  }
  $('summaryMsg').textContent = '';
  (data.pairs || []).forEach(p => {
    const div = document.createElement('div');
    div.className = 'stat';
    div.innerHTML = '<div class="stat-value"></div><div class="stat-label"></div>';
    div.querySelector('.stat-value').textContent = fmtVal(p.value);
    div.querySelector('.stat-label').textContent = p.label;
    wrap.appendChild(div);
  });
  if (data.byType) buildTable($('summaryTable'), data.byType.headers, data.byType.rows);
  renderChart();
}

async function renderChart() {
  const box = $('chart30');
  let days;
  try { days = await loadRangeAll(false); }
  catch (e) { box.innerHTML = '<p class="muted">Grafik belum bisa dimuat (offline dan belum ada data tersimpan).</p>'; return; }
  const today = S.todayNumber || 0;
  const last = days.filter(d => d.dayNumber > today - 30 && d.dayNumber <= today)
    .sort((a, b) => a.dayNumber - b.dayNumber);
  if (!last.length) { box.innerHTML = '<p class="muted">Belum ada data 30 hari terakhir.</p>'; return; }
  const W = 300, H = 110, base = 88, top = 8;
  let bars = '', points = [];
  const step = W / 30;
  last.forEach((d, i) => {
    const x = i * step + 1;
    const skor = normalizeSkor(d.skor);
    if (skor !== null) {
      const h = Math.max(2, skor * (base - top));
      const color = d.status === 'Gagal' ? '#c0392b' : '#1b7a43';
      bars += '<rect x="' + x.toFixed(1) + '" y="' + (base - h).toFixed(1) + '" width="' + (step - 2).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" fill="' + color + '"><title>Hari ' + d.dayNumber + ': ' + Math.round(skor * 100) + '%</title></rect>';
    }
    if (d.screenTime !== null && d.screenTime !== undefined) {
      const y = base - Math.min(1, Number(d.screenTime) / 12) * (base - top);
      points.push((x + step / 2).toFixed(1) + ',' + y.toFixed(1));
    }
  });
  const line = points.length > 1
    ? '<polyline points="' + points.join(' ') + '" fill="none" stroke="#b7791f" stroke-width="2"/>'
    : '';
  box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Grafik skor dan screen time 30 hari terakhir">' +
    '<line x1="0" y1="' + base + '" x2="' + W + '" y2="' + base + '" stroke="currentColor" opacity="0.25"/>' +
    bars + line + '</svg>';
}

// ==================== Sisa Waktu ====================
async function renderTime() {
  let data = getCache('timebudget');
  try {
    data = await api.timebudget();
    setCache('timebudget', data);
  } catch (e) { /* pakai cache */ }
  if (!data) {
    $('timeMsg').textContent = 'Gagal memuat dan tidak ada data tersimpan. Periksa sinyal lalu buka lagi layar ini.';
    return;
  }
  $('timeMsg').textContent = '';
  buildTable($('timeTable'), data.headers, data.rows);
  // Sorot kolom jenis hari yang sedang dibuka
  const jenisAktif = (S.dayNumber === S.todayNumber ? S.jenis : null) ||
    (S.boot && S.boot.today && S.boot.today.row && S.boot.today.row.jenisHari) ||
    getPrefs().lastJenis;
  const colIdx = data.headers.findIndex(h => String(h).trim() === jenisAktif);
  if (colIdx >= 0) {
    $('timeTable').querySelectorAll('tr').forEach(tr => {
      const cell = tr.children[colIdx];
      if (cell) cell.classList.add('hl');
    });
  }
}

// ==================== Tema ====================
function applyTheme() {
  const mode = getPrefs().theme;
  const resolved = mode === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  document.documentElement.dataset.theme = resolved;
  $('themeBtn').textContent = mode === 'dark' ? '🌙' : (mode === 'light' ? '☀️' : '🌗');
  $('themeBtn').setAttribute('aria-label', 'Tema: ' + (mode === 'auto' ? 'otomatis' : mode) + '. Ketuk untuk ganti.');
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (getPrefs().theme === 'auto') applyTheme();
});

// ==================== Pengingat lokal ====================
function checkReminder() {
  const prefs = getPrefs();
  if (!prefs.reminderEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (nowHMWIB() === prefs.reminderTime && prefs.reminderLastFired !== todayYmd()) {
    setPrefs({ reminderLastFired: todayYmd() });
    try {
      new Notification('Checklist 1000 Hari', { body: 'Sudah isi checklist hari ini? Cukup 1-2 ketukan per kebiasaan.', icon: 'icons/icon-192.png' });
    } catch (e) { /* abaikan */ }
  }
}
setInterval(checkReminder, 30000);

// ==================== Inisialisasi data ====================
async function initData() {
  updateSyncBadge();
  if (!isConfigured()) {
    $('setupCard').hidden = false;
    $('todayLoading').hidden = true;
    return;
  }
  $('setupCard').hidden = true;
  $('todayLoading').hidden = false;

  let boot = getCache('bootstrap');
  try {
    boot = await api.bootstrap();
    setCache('bootstrap', boot);
  } catch (err) {
    if (!boot) {
      $('todayLoading').hidden = true;
      $('todayErrorText').textContent = 'Gagal terhubung ke spreadsheet: ' + err.message + ' Periksa URL/token di Pengaturan atau sinyalmu, lalu coba lagi.';
      $('todayError').hidden = false;
      return;
    }
    toast('Offline — memakai data tersimpan terakhir.');
  }
  S.boot = boot;
  S.todayNumber = (boot.today && typeof boot.today.dayNumber === 'number')
    ? boot.today.dayNumber
    : dayNumberFromDate(todayYmd());
  if (boot.today && boot.today.row) setCache('day-' + S.todayNumber, boot.today.row);

  if (nowHourWIB() < 6 && S.todayNumber > 1) {
    $('nightBanner').hidden = false;
  }
  $('monthInput').value = todayYmd().slice(0, 7);
  await openDay(S.todayNumber);
  flushQueue();
}

// ==================== Ikatan UI ====================
function bindUI() {
  document.querySelectorAll('.bottom-nav button').forEach(b =>
    b.addEventListener('click', () => switchScreen(b.dataset.screen)));

  $('syncBadge').addEventListener('click', () => {
    if (pendingCount() === 0) { toast('Semua perubahan sudah tersinkron.'); return; }
    flushQueue();
  });
  $('themeBtn').addEventListener('click', () => {
    const order = ['auto', 'dark', 'light'];
    const next = order[(order.indexOf(getPrefs().theme) + 1) % order.length];
    setPrefs({ theme: next });
    applyTheme();
    toast('Tema: ' + (next === 'auto' ? 'otomatis (ikuti HP)' : next === 'dark' ? 'gelap' : 'terang'));
  });

  $('prevDayBtn').addEventListener('click', () => openDay(S.dayNumber - 1));
  $('nextDayBtn').addEventListener('click', () => openDay(S.dayNumber + 1));
  $('quickToday').addEventListener('click', () => openDay(S.todayNumber));
  $('quickYesterday').addEventListener('click', () => openDay((S.todayNumber || 1) - 1));
  $('nightBtn').addEventListener('click', () => {
    $('nightBanner').hidden = true;
    openDay((S.todayNumber || 1) - 1);
  });
  $('datePick').addEventListener('change', (e) => {
    if (!e.target.value) return;
    const n = dayNumberFromDate(e.target.value);
    if (n === null || n < 1 || n > 1000) { toast('Tanggal itu di luar rentang 1000 hari tantangan.'); return; }
    openDay(n);
  });
  $('todayRetry').addEventListener('click', () => {
    $('todayError').hidden = true;
    if (S.dayNumber) openDay(S.dayNumber); else initData();
  });

  document.querySelectorAll('#jenisSeg button').forEach(b =>
    b.addEventListener('click', () => {
      if (S.jenis === b.dataset.jenis) return;
      S.jenis = b.dataset.jenis;
      setPrefs({ lastJenis: S.jenis });
      enqueueSave(S.dayNumber, payloadWithDefaults({ jenisHari: S.jenis }));
      renderToday();
      flushQueue();
    }));
  document.querySelectorAll('#shiftSeg button').forEach(b =>
    b.addEventListener('click', () => {
      if (S.shift === b.dataset.shift) return;
      S.shift = b.dataset.shift;
      setPrefs({ lastShift: S.shift });
      enqueueSave(S.dayNumber, payloadWithDefaults({ shift: S.shift }));
      renderToday();
      flushQueue();
    }));

  $('screenTimeInput').addEventListener('change', (e) => {
    const raw = e.target.value;
    if (raw === '') { toast('Kosong tidak disimpan. Isi 0 jika memang tidak ada screen time.'); renderToday(); return; }
    let v = parseFloat(raw);
    if (!isFinite(v)) { renderToday(); return; }
    if (v < 0 || v > 24) { toast('Screen time harus antara 0 dan 24 jam.'); v = Math.max(0, Math.min(24, v)); }
    enqueueSave(S.dayNumber, payloadWithDefaults({ screenTime: v }));
    renderToday();
    flushQueue();
  });
  $('langInput').addEventListener('change', (e) => {
    const raw = e.target.value;
    if (raw === '') { toast('Kosong tidak disimpan. Isi 0 untuk mengosongkan.'); renderToday(); return; }
    let v = parseInt(raw, 10);
    if (!isFinite(v)) { renderToday(); return; }
    if (v < 0 || v > 1440) { toast('Menit belajar harus antara 0 dan 1440.'); v = Math.max(0, Math.min(1440, v)); }
    enqueueSave(S.dayNumber, payloadWithDefaults({ languageMinutes: v }));
    renderToday();
    flushQueue();
  });
  document.querySelectorAll('[data-add-lang]').forEach(b =>
    b.addEventListener('click', () => {
      const add = Number(b.dataset.addLang);
      const day = effectiveDay();
      const cur = Number(day.languageMinutes) || 0;
      const v = Math.min(1440, cur + add);
      enqueueSave(S.dayNumber, payloadWithDefaults({ languageMinutes: v }));
      renderToday();
      flushQueue();
    }));

  $('monthInput').addEventListener('change', () => renderHistory());
  $('exportCsvBtn').addEventListener('click', async () => {
    try {
      const days = await loadRangeAll(true);
      const head = 'hari_ke,tanggal,jenis_hari,shift,selesai,target,skor,status,screen_time_jam,menit_bahasa\n';
      const lines = days.map(d => [
        d.dayNumber, d.date, d.jenisHari, d.shift, d.selesai, d.target,
        d.skor === '' ? '' : d.skor, d.status,
        d.screenTime === null ? '' : d.screenTime,
        d.languageMinutes === null ? '' : d.languageMinutes
      ].join(','));
      const blob = new Blob([head + lines.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'checklist-1000-hari.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('CSV diunduh.');
    } catch (e) {
      toast('Ekspor gagal: butuh sinyal untuk mengambil data terbaru.');
    }
  });

  // Pengaturan
  const dlg = $('settingsDialog');
  const openSettings = () => {
    const cfg = getConfig();
    const prefs = getPrefs();
    $('apiUrlInput').value = cfg.apiUrl;
    $('apiTokenInput').value = cfg.apiToken;
    $('reminderEnabled').checked = !!prefs.reminderEnabled;
    $('reminderTime').value = prefs.reminderTime || '21:00';
    $('testConnMsg').textContent = '';
    dlg.showModal();
  };
  $('settingsBtn').addEventListener('click', openSettings);
  $('setupOpenBtn').addEventListener('click', openSettings);
  $('settingsCancel').addEventListener('click', () => dlg.close());
  $('testConnBtn').addEventListener('click', async () => {
    setConfig({ apiUrl: $('apiUrlInput').value, apiToken: $('apiTokenInput').value });
    $('testConnMsg').textContent = 'Menghubungi…';
    try {
      await api.ping();
      $('testConnMsg').textContent = 'Berhasil terhubung ✓';
    } catch (e) {
      $('testConnMsg').textContent = 'Gagal: ' + e.message;
    }
  });
  $('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    setConfig({ apiUrl: $('apiUrlInput').value, apiToken: $('apiTokenInput').value });
    const reminderOn = $('reminderEnabled').checked;
    setPrefs({ reminderEnabled: reminderOn, reminderTime: $('reminderTime').value || '21:00' });
    if (reminderOn && 'Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (err) { /* abaikan */ }
    }
    dlg.close();
    toast('Pengaturan disimpan.');
    S.historyLoaded = S.summaryLoaded = S.timeLoaded = false;
    initData();
  });
}

// ==================== Mulai ====================
configFromUrl();
applyTheme();
bindUI();
updateSyncBadge();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* abaikan */ });
}
initData();
