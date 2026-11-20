/**
 * Uji otomatis backend Apps Script (Code.gs) dengan spreadsheet palsu.
 * Menjalankan: node tests/apps-script.test.js
 *
 * Spreadsheet palsu meniru rumus sheet asli secara sederhana:
 * setelah ada tulisan di baris Checklist, kolom Y-AC "dihitung ulang"
 * (Y = jumlah ✓ yang berlaku, Z = target per jenis, AA = Y/Z,
 *  AB = Lolos/Gagal vs batas 0,8, AC = peringatan 2 hari gagal).
 * Yang diuji di sini adalah perilaku Code.gs: kolom yang ditulis,
 * validasi, idempotensi, token, dan bentuk balasan JSON.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ---------- Util waktu (Asia/Jakarta = UTC+7, tanpa DST) ----------
function jakartaParts(date) {
  const j = new Date(date.getTime() + 7 * 3600 * 1000);
  return {
    y: j.getUTCFullYear(), m: j.getUTCMonth() + 1, d: j.getUTCDate(),
    hh: j.getUTCHours(), mm: j.getUTCMinutes()
  };
}
function formatDateMock(date, tz, fmt) {
  const p = jakartaParts(date);
  const pad = (n) => String(n).padStart(2, '0');
  if (fmt === 'yyyy-MM-dd') return p.y + '-' + pad(p.m) + '-' + pad(p.d);
  if (fmt === 'HH:mm') return pad(p.hh) + ':' + pad(p.mm);
  throw new Error('format tidak dikenal: ' + fmt);
}
function jakartaMidnight(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d) - 7 * 3600 * 1000);
}

// ---------- Spreadsheet palsu ----------
function colLettersToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n; // 1-based
}
class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet; this.row = row; this.col = col;
    this.numRows = numRows; this.numCols = numCols;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = [];
      for (let c = 0; c < this.numCols; c++) {
        row.push(this.sheet.getCell(this.row + r, this.col + c));
      }
      out.push(row);
    }
    return out;
  }
  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        this.sheet.setCell(this.row + r, this.col + c, values[r][c]);
      }
    }
    this.sheet.afterWrite();
  }
}
class FakeSheet {
  constructor(name, ss) {
    this.name = name; this.ss = ss; this.cells = new Map();
  }
  key(r, c) { return r + ',' + c; }
  getCell(r, c) {
    const v = this.cells.get(this.key(r, c));
    return v === undefined ? '' : v;
  }
  setCell(r, c, v) { this.cells.set(this.key(r, c), v); }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (!m) throw new Error('A1 tidak didukung: ' + a);
      const col1 = colLettersToIndex(m[1]), row1 = Number(m[2]);
      const col2 = colLettersToIndex(m[3]), row2 = Number(m[4]);
      return new FakeRange(this, row1, col1, row2 - row1 + 1, col2 - col1 + 1);
    }
    return new FakeRange(this, a, b, c, d);
  }
  afterWrite() {
    if (this.name === 'Checklist') this.ss.recomputeFormulas();
  }
}
class FakeSpreadsheet {
  constructor() {
    this.sheets = {};
    for (const name of ['Checklist', 'Pengaturan', 'Ringkasan', 'Sisa waktu']) {
      this.sheets[name] = new FakeSheet(name, this);
    }
  }
  getSheetByName(name) { return this.sheets[name] || null; }
  // Tiruan rumus Y-AC untuk baris yang punya jenis hari
  recomputeFormulas() {
    const chk = this.sheets['Checklist'];
    const set = this.sheets['Pengaturan'];
    const targets = { Normal: set.getCell(26, 2), Lembur: set.getCell(26, 3), Libur: set.getCell(26, 4) };
    const threshold = Number(set.getCell(4, 2)) || 0.8;
    let prevStatus = '';
    for (let row = 2; row <= 1001; row++) {
      const jenis = chk.getCell(row, 3);
      if (!jenis) { prevStatus = ''; continue; }
      const colIdx = { Normal: 2, Lembur: 3, Libur: 4 }[jenis];
      let selesai = 0;
      for (let i = 0; i < 18; i++) {
        const berlaku = Number(set.getCell(8 + i, colIdx)) === 1;
        if (berlaku && chk.getCell(row, 5 + i) === '✓') selesai++;
      }
      const target = Number(targets[jenis]) || 0;
      const skor = target > 0 ? selesai / target : 0;
      const status = skor >= threshold ? 'Lolos' : 'Gagal';
      chk.setCell(row, 25, selesai);
      chk.setCell(row, 26, target);
      chk.setCell(row, 27, skor);
      chk.setCell(row, 28, status);
      chk.setCell(row, 29, (status === 'Gagal' && prevStatus === 'Gagal') ? '2 hari gagal berturut' : '');
      prevStatus = status;
    }
  }
}

// ---------- Bangun dunia palsu ----------
const ss = new FakeSpreadsheet();
const props = new Map();

// Tanggal mulai = 19 hari sebelum hari ini (WIB) -> hari ini = hari ke-20
const nowP = jakartaParts(new Date());
const startMs = Date.UTC(nowP.y, nowP.m - 1, nowP.d) - 19 * 86400000;
const sp = jakartaParts(new Date(startMs + 7 * 3600 * 1000));
const startDate = jakartaMidnight(sp.y, sp.m, sp.d);

const set = ss.sheets['Pengaturan'];
set.setCell(3, 2, startDate);       // B3 tanggal mulai
set.setCell(4, 2, 0.8);             // B4 batas lolos
set.setCell(5, 2, 4);               // B5 batas screen time
const habitNames = ['Tidur cukup', 'Protein sebelum berangkat', 'Minum air', 'Tanpa gula pagi', 'Skincare', 'Journaling', 'No PMO', 'No short', 'Screen time sesuai batas', 'Peregangan', 'Olahraga', 'Meditasi/napas perut', 'Baca', 'Menulis', 'Matematika', 'Belajar bahasa baru', 'Bersihin kamar', 'Catat 1 hal baru dari mesin'];
habitNames.forEach((n, i) => {
  set.setCell(8 + i, 1, n);                       // A nama
  set.setCell(8 + i, 2, i === 17 ? 0 : 1);        // B Normal: idx17 tidak berlaku
  set.setCell(8 + i, 3, i < 9 ? 1 : 0);           // C Lembur: hanya 9 inti
  set.setCell(8 + i, 4, 1);                       // D Libur: semua
});
set.setCell(26, 2, 15); set.setCell(26, 3, 9); set.setCell(26, 4, 18); // target

const chk = ss.sheets['Checklist'];
for (let day = 1; day <= 1000; day++) {
  const row = day + 1;
  const dparts = jakartaParts(new Date(startDate.getTime() + (day - 1) * 86400000));
  chk.setCell(row, 1, jakartaMidnight(dparts.y, dparts.m, dparts.d)); // A tanggal (rumus)
  chk.setCell(row, 2, day);                                           // B hari ke (rumus)
}
const sum = ss.sheets['Ringkasan'];
sum.setCell(3, 1, 'Hari tercatat'); sum.setCell(3, 2, 12);
sum.setCell(4, 1, 'Hari lolos'); sum.setCell(4, 2, 9);
sum.setCell(16, 1, 'Jenis hari'); sum.setCell(16, 2, 'Hari'); sum.setCell(16, 3, 'Lolos'); sum.setCell(16, 4, 'Gagal'); sum.setCell(16, 5, 'Rata-rata skor');
sum.setCell(17, 1, 'Normal'); sum.setCell(17, 2, 6); sum.setCell(17, 3, 5); sum.setCell(17, 4, 1); sum.setCell(17, 5, 0.9);
const tb = ss.sheets['Sisa waktu'];
tb.setCell(3, 1, 'Komponen'); tb.setCell(3, 2, 'Normal'); tb.setCell(3, 3, 'Lembur'); tb.setCell(3, 4, 'Libur'); tb.setCell(3, 5, 'Catatan');
tb.setCell(4, 1, 'Jam kerja'); tb.setCell(4, 2, 8); tb.setCell(4, 3, 12); tb.setCell(4, 4, 0);

// ---------- Sandbox Apps Script ----------
const sandbox = {
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
  ContentService: {
    MimeType: { JSON: 'JSON' },
    createTextOutput: (s) => ({ content: s, setMimeType() { return this; } })
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => props.set(k, String(v))
    })
  },
  Utilities: { formatDate: formatDateMock }
};
vm.createContext(sandbox);
const code = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
vm.runInContext(code, sandbox);

const get = (params) => JSON.parse(sandbox.doGet({ parameter: params }).content);
const post = (body) => JSON.parse(sandbox.doPost({
  parameter: {}, postData: { contents: JSON.stringify(body) }
}).content);

// ---------- Rangkaian uji ----------
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ GAGAL: ' + name); }
}

console.log('== bootstrap ==');
const boot = get({ action: 'bootstrap' });
check('ok=true', boot.ok === true);
check('18 nama kebiasaan', boot.habitNames.length === 18 && boot.habitNames[0] === 'Tidur cukup');
check('Normal: kebiasaan ke-18 tidak berlaku', boot.applicable.Normal[17] === false && boot.applicable.Normal[0] === true);
check('Lembur: hanya 9 inti', boot.applicable.Lembur[8] === true && boot.applicable.Lembur[9] === false);
check('target Normal=15', boot.targets.Normal === 15);
check('hari ini = hari ke-20', boot.today.dayNumber === 20);
check('pengaturan terbaca', boot.settings.passThreshold === 0.8 && boot.settings.screenLimit === 4);

console.log('== validasi hari ==');
check('hari 0 ditolak', get({ action: 'day', day: 0 }).code === 'invalid_day');
check('hari 1001 ditolak', get({ action: 'day', day: 1001 }).code === 'invalid_day');
check('hari 1 bisa dibuka', get({ action: 'day', day: 1 }).dayNumber === 1);
check('hari 1000 bisa dibuka', get({ action: 'day', day: 1000 }).dayNumber === 1000);

console.log('== saveDay menulis kolom yang benar ==');
const row6 = 5 + 1; // hari ke-5 -> baris 6
const beforeA = chk.getCell(row6, 1), beforeB = chk.getCell(row6, 2);
const save = post({
  action: 'saveDay', dayNumber: 5, jenisHari: 'Normal', shift: 'Pagi',
  habits: { 0: true, 4: true }, screenTime: 3.5, languageMinutes: 30,
  clientId: 'test-client-0001', clientTimestamp: new Date().toISOString()
});
check('save ok', save.ok === true && save.duplicate === false);
check('E6 = ✓ (Tidur cukup)', chk.getCell(row6, 5) === '✓');
check('I6 = ✓ (Skincare)', chk.getCell(row6, 9) === '✓');
check('F6 tetap kosong', chk.getCell(row6, 6) === '');
check('C6 = Normal, D6 = Pagi', chk.getCell(row6, 3) === 'Normal' && chk.getCell(row6, 4) === 'Pagi');
check('W6 = 3.5, X6 = 30', chk.getCell(row6, 23) === 3.5 && chk.getCell(row6, 24) === 30);
check('skor hasil rumus terbaca (2/15)', Math.abs(save.skor - 2 / 15) < 1e-9 && save.selesai === 2 && save.target === 15);
check('status Gagal (di bawah 0,8)', save.status === 'Gagal');
check('kolom A & B tidak berubah', chk.getCell(row6, 1) === beforeA && chk.getCell(row6, 2) === beforeB);

console.log('== simpan sebagian: hanya sel yang dikirim ==');
const save2 = post({
  action: 'saveDay', dayNumber: 5, habits: { 0: false },
  clientId: 'test-client-0002', clientTimestamp: new Date().toISOString()
});
check('E6 dikosongkan', chk.getCell(row6, 5) === '');
check('I6 tidak ikut berubah', chk.getCell(row6, 9) === '✓');
check('jenis/shift tidak tertimpa', chk.getCell(row6, 3) === 'Normal' && chk.getCell(row6, 4) === 'Pagi');
check('selesai jadi 1', save2.selesai === 1);

console.log('== idempotensi ==');
const dup = post({
  action: 'saveDay', dayNumber: 5, habits: { 1: true },
  clientId: 'test-client-0002', clientTimestamp: new Date().toISOString()
});
check('clientId sama -> duplicate=true', dup.duplicate === true);
check('F6 tetap kosong (tidak diterapkan dua kali)', chk.getCell(row6, 6) === '');

console.log('== validasi & anti formula-injection ==');
const base = { action: 'saveDay', dayNumber: 5, clientId: 'test-client-xxxx', clientTimestamp: new Date().toISOString() };
check('jenis ngawur ditolak', post({ ...base, clientId: 'v-00000001', jenisHari: 'Ngawur' }).code === 'invalid_jenis_hari');
check('rumus sebagai jenis ditolak', post({ ...base, clientId: 'v-00000002', jenisHari: '=SUM(A1:A2)' }).code === 'invalid_jenis_hari');
check('shift ngawur ditolak', post({ ...base, clientId: 'v-00000003', shift: 'Subuh' }).code === 'invalid_shift');
check('screen time 25 ditolak', post({ ...base, clientId: 'v-00000004', screenTime: 25 }).code === 'invalid_screen_time');
check('menit bahasa 12.5 ditolak', post({ ...base, clientId: 'v-00000005', languageMinutes: 12.5 }).code === 'invalid_language_minutes');
check('indeks kebiasaan 99 ditolak', post({ ...base, clientId: 'v-00000006', habits: { 99: true } }).code === 'invalid_habits');
check('nilai kebiasaan string ditolak', post({ ...base, clientId: 'v-00000007', habits: { 0: '✓' } }).code === 'invalid_habits');
check('hari 1001 ditolak', post({ ...base, clientId: 'v-00000008', dayNumber: 1001 }).code === 'invalid_day');
check('tanpa clientId ditolak', post({ action: 'saveDay', dayNumber: 5 }).code === 'invalid_client_id');

console.log('== range, summary, timebudget ==');
const range = get({ action: 'range', from: 1, to: 10 });
check('range 1-10 berisi 10 hari', range.ok === true && range.days.length === 10);
check('range hari ke-5 terisi', range.days[4].hasData === true && range.days[4].status === 'Gagal');
check('range terlalu besar ditolak', get({ action: 'range', from: 1, to: 500 }).code === 'range_too_large');
const summary = get({ action: 'summary' });
check('summary pairs terbaca', summary.pairs.length >= 2 && summary.pairs[0].label === 'Hari tercatat');
check('summary tabel per jenis terbaca', summary.byType.rows[0][0] === 'Normal');
const timebudget = get({ action: 'timebudget' });
check('timebudget terbaca', timebudget.headers[1] === 'Normal' && timebudget.rows[0][0] === 'Jam kerja');

console.log('== token ==');
props.set('SECRET_TOKEN', 'token-rahasia-sangat-panjang');
check('tanpa token ditolak', get({ action: 'bootstrap' }).code === 'unauthorized');
check('token salah ditolak', get({ action: 'bootstrap', token: 'salah' }).code === 'unauthorized');
check('token benar diterima', get({ action: 'bootstrap', token: 'token-rahasia-sangat-panjang' }).ok === true);
check('POST tanpa token ditolak', post({ action: 'saveDay', dayNumber: 5, clientId: 't-00000001' }).code === 'unauthorized');
props.delete('SECRET_TOKEN');

console.log('\nHasil: ' + pass + ' lolos, ' + fail + ' gagal');
process.exit(fail ? 1 : 0);
