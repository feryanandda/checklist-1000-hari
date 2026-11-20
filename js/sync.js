/**
 * Mesin sinkronisasi — mengirim antrean ke server satu per satu.
 * - Error jaringan: berhenti, antrean tetap disimpan (coba lagi saat online).
 * - Error validasi dari server: entri dibuang + pengguna diberi tahu
 *   (data itu memang tidak akan pernah diterima server).
 */
import { api } from './api.js';
import { getQueue, removeFromQueue, setCache } from './store.js';

let syncing = false;
let handlers = { onDay: null, onError: null, onChange: null };

export function setSyncHandlers(h) { handlers = Object.assign(handlers, h); }
export function isSyncing() { return syncing; }

export async function flushQueue() {
  if (syncing) return;
  if (!navigator.onLine) { if (handlers.onChange) handlers.onChange(); return; }
  if (getQueue().length === 0) { if (handlers.onChange) handlers.onChange(); return; }
  syncing = true;
  if (handlers.onChange) handlers.onChange();
  try {
    let entry = getQueue()[0];
    while (entry) {
      const payload = {
        dayNumber: entry.dayNumber,
        clientId: entry.clientId,
        clientTimestamp: entry.clientTimestamp
      };
      if (entry.jenisHari !== undefined) payload.jenisHari = entry.jenisHari;
      if (entry.shift !== undefined) payload.shift = entry.shift;
      if (entry.habits !== undefined) payload.habits = entry.habits;
      if (entry.screenTime !== undefined) payload.screenTime = entry.screenTime;
      if (entry.languageMinutes !== undefined) payload.languageMinutes = entry.languageMinutes;
      try {
        const day = await api.saveDay(payload);
        removeFromQueue(entry.clientId);
        setCache('day-' + day.dayNumber, day);
        if (handlers.onDay) handlers.onDay(day);
      } catch (err) {
        if (err && typeof err.code === 'string' && err.code.indexOf('invalid') === 0) {
          removeFromQueue(entry.clientId);
          if (handlers.onError) {
            handlers.onError('Satu perubahan ditolak server (' + err.message + ') dan dibuang dari antrean.');
          }
        } else {
          // jaringan / server sibuk: berhenti dulu, antrean aman
          break;
        }
      }
      entry = getQueue()[0];
    }
  } finally {
    syncing = false;
    if (handlers.onChange) handlers.onChange();
  }
}

window.addEventListener('online', () => { flushQueue(); });
