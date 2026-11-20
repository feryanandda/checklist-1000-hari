/**
 * Konfigurasi endpoint — SATU tempat untuk URL & token.
 * Nilai disimpan di localStorage HP (bukan di kode publik),
 * diisi lewat menu Pengaturan di aplikasi.
 */
const CONFIG_KEY = 'c1000.config.v1';

export function getConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      return { apiUrl: c.apiUrl || '', apiToken: c.apiToken || '' };
    }
  } catch (e) { /* abaikan */ }
  return { apiUrl: '', apiToken: '' };
}

export function setConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({
    apiUrl: (cfg.apiUrl || '').trim(),
    apiToken: (cfg.apiToken || '').trim()
  }));
}

export function isConfigured() {
  return getConfig().apiUrl.length > 10;
}

/**
 * Terima konfigurasi dari link pribadi: #api=<url>&token=<token>
 * Dipakai sekali saat aplikasi pertama dibuka dari link yang dibagikan
 * ke pemilik; nilai disimpan ke localStorage lalu hash dibersihkan
 * dari address bar. Perlakukan link seperti itu sebagai rahasia.
 */
export function configFromUrl() {
  try {
    if (!location.hash || location.hash.length < 5) return false;
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const api = h.get('api');
    if (!api) return false;
    setConfig({ apiUrl: api, apiToken: h.get('token') || '' });
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  } catch (e) { return false; }
}
