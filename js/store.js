/**
 * Lapisan penyimpanan offline (localStorage).
 * - Antrean perubahan (queue) yang belum terkirim ke server.
 * - Cache data terakhir dari server (bootstrap, hari, ringkasan, dll)
 *   supaya aplikasi tetap bisa dibuka tanpa sinyal.
 * - Preferensi lokal (jenis hari/shift terakhir, tema, pengingat).
 *
 * Antrean digabung per hari: perubahan baru untuk hari yang sama melebur
 * ke entri yang belum terkirim, jadi tidak ada duplikasi. Setiap entri
 * punya clientId tetap -> server menolak penerapan ganda (idempotent).
 */
const QUEUE_KEY = 'c1000.queue.v1';
const CACHE_PREFIX = 'c1000.cache.';
const PREFS_KEY = 'c1000.prefs.v1';

const listeners = new Set();
export function onStoreChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }

// ---------- Antrean ----------
export function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; }
  catch (e) { return []; }
}
function setQueue(q) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  notify();
}
export function pendingCount() { return getQueue().length; }

function newClientId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

/**
 * Masukkan perubahan sebagian untuk satu hari.
 * partial: { jenisHari?, shift?, habits?: {index:boolean}, screenTime?, languageMinutes? }
 */
export function enqueueSave(dayNumber, partial) {
  const q = getQueue();
  const now = new Date().toISOString();
  const existing = q.find(e => e.dayNumber === dayNumber);
  if (existing) {
    if (partial.jenisHari !== undefined) existing.jenisHari = partial.jenisHari;
    if (partial.shift !== undefined) existing.shift = partial.shift;
    if (partial.screenTime !== undefined) existing.screenTime = partial.screenTime;
    if (partial.languageMinutes !== undefined) existing.languageMinutes = partial.languageMinutes;
    if (partial.habits) {
      existing.habits = existing.habits || {};
      Object.keys(partial.habits).forEach(k => { existing.habits[k] = partial.habits[k]; });
    }
    existing.clientTimestamp = now;
  } else {
    q.push(Object.assign(
      { clientId: newClientId(), dayNumber, clientTimestamp: now },
      JSON.parse(JSON.stringify(partial))
    ));
  }
  setQueue(q);
}

export function removeFromQueue(clientId) {
  setQueue(getQueue().filter(e => e.clientId !== clientId));
}

/** Terapkan antrean untuk satu hari ke atas data hari (untuk tampilan optimistis). */
export function applyQueueToDay(day, dayNumber) {
  if (!day) return day;
  const merged = JSON.parse(JSON.stringify(day));
  getQueue()
    .filter(e => e.dayNumber === dayNumber)
    .sort((a, b) => (a.clientTimestamp < b.clientTimestamp ? -1 : 1))
    .forEach(e => {
      if (e.jenisHari !== undefined) merged.jenisHari = e.jenisHari;
      if (e.shift !== undefined) merged.shift = e.shift;
      if (e.screenTime !== undefined) merged.screenTime = e.screenTime;
      if (e.languageMinutes !== undefined) merged.languageMinutes = e.languageMinutes;
      if (e.habits) {
        Object.keys(e.habits).forEach(k => { merged.habits[Number(k)] = e.habits[k]; });
      }
    });
  return merged;
}

export function hasPendingFor(dayNumber) {
  return getQueue().some(e => e.dayNumber === dayNumber);
}

// ---------- Cache data server ----------
export function setCache(key, value) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), value }));
  } catch (e) { /* penyimpanan penuh: abaikan */ }
}
export function getCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw).value;
  } catch (e) { return null; }
}

// ---------- Preferensi ----------
export function getPrefs() {
  const defaults = {
    lastJenis: 'Normal',
    lastShift: 'Pagi',
    theme: 'auto', // auto | dark | light
    reminderEnabled: false,
    reminderTime: '21:00',
    reminderLastFired: ''
  };
  try {
    return Object.assign(defaults, JSON.parse(localStorage.getItem(PREFS_KEY)) || {});
  } catch (e) { return defaults; }
}
export function setPrefs(patch) {
  const next = Object.assign(getPrefs(), patch);
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  notify();
  return next;
}
