/**
 * Lapisan API — satu-satunya tempat yang bicara ke Apps Script Web App.
 * POST dikirim sebagai text/plain agar tidak memicu CORS preflight
 * (Apps Script tidak menjawab preflight); body tetap JSON.
 */
import { getConfig } from './config.js';

const TIMEOUT_MS = 20000;

function fetchWithTimeout(url, options) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(url, Object.assign({}, options, { signal: ctrl.signal }))
    .finally(() => clearTimeout(t));
}

async function parseResponse(res) {
  let data = null;
  try { data = await res.json(); } catch (e) { /* bukan JSON */ }
  if (!data) {
    const err = new Error('Server tidak menjawab dengan benar. Periksa URL Web App di Pengaturan.');
    err.code = 'bad_response';
    throw err;
  }
  if (data.ok === false) {
    const err = new Error(data.message || 'Permintaan ditolak server.');
    err.code = data.code || 'server_error';
    throw err;
  }
  return data;
}

async function get(action, params) {
  const cfg = getConfig();
  if (!cfg.apiUrl) {
    const err = new Error('URL Web App belum diisi. Buka Pengaturan (ikon gerigi) dan tempel URL dari hasil deploy Apps Script.');
    err.code = 'not_configured';
    throw err;
  }
  const url = new URL(cfg.apiUrl);
  url.searchParams.set('action', action);
  if (params) {
    Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
  }
  if (cfg.apiToken) url.searchParams.set('token', cfg.apiToken);
  const res = await fetchWithTimeout(url.toString(), { method: 'GET' });
  return parseResponse(res);
}

async function post(action, payload) {
  const cfg = getConfig();
  if (!cfg.apiUrl) {
    const err = new Error('URL Web App belum diisi. Buka Pengaturan (ikon gerigi) dan tempel URL dari hasil deploy Apps Script.');
    err.code = 'not_configured';
    throw err;
  }
  const body = Object.assign({}, payload, { action });
  if (cfg.apiToken) body.token = cfg.apiToken;
  const res = await fetchWithTimeout(cfg.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });
  return parseResponse(res);
}

export const api = {
  ping: () => get('ping'),
  bootstrap: () => get('bootstrap'),
  day: (dayNumber) => get('day', { day: dayNumber }),
  summary: () => get('summary'),
  timebudget: () => get('timebudget'),
  range: (from, to) => get('range', { from, to }),
  saveDay: (payload) => post('saveDay', payload)
};

/** Ambil rentang besar dengan memecah per 300 hari (batas server 367). */
export async function fetchRangeChunked(from, to) {
  const all = [];
  let start = from;
  while (start <= to) {
    const end = Math.min(start + 299, to);
    const res = await api.range(start, end);
    if (res.days) all.push(...res.days);
    start = end + 1;
  }
  return all;
}
