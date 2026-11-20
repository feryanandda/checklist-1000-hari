/**
 * Checklist 1000 Hari — Backend Google Apps Script
 * --------------------------------------------------
 * Web App terikat (bound) ke spreadsheet Checklist 1000 Hari.
 * Spreadsheet adalah sumber kebenaran tunggal: skor/status dihitung rumus
 * di sheet, backend ini hanya membaca hasilnya dan menulis input mentah.
 *
 * Kolom yang BOLEH ditulis: C, D, E-V, W, X pada sheet "Checklist".
 * Kolom A, B, Y-AC dan semua sheet lain TIDAK PERNAH ditulis.
 *
 * Keamanan:
 * - Jika Script Property SECRET_TOKEN diisi, semua permintaan wajib
 *   membawa token yang sama (GET: &token=..., POST: field "token").
 * - Semua input divalidasi ketat (enum / angka / boolean), sehingga tidak
 *   ada input pengguna yang bisa menjadi rumus (formula injection).
 */

// ===================== KONFIGURASI =====================
var TZ = 'Asia/Jakarta';
var SHEET_CHECKLIST = 'Checklist';
var SHEET_SETTINGS = 'Pengaturan';
var SHEET_SUMMARY = 'Ringkasan';
var SHEET_TIMEBUDGET = 'Sisa waktu';

var HABIT_COUNT = 18;
var CHECK_MARK = '✓';
var DAY_MIN = 1;
var DAY_MAX = 1000;

var VALID_JENIS = ['Normal', 'Lembur', 'Libur'];
var VALID_SHIFT = ['Pagi', 'Siang', 'Malam'];

// Urutan kolom pada matriks Pengaturan B8:D26 (Normal, Lembur, Libur)
var JENIS_COLUMNS = { 'Normal': 0, 'Lembur': 1, 'Libur': 2 };

// ===================== UTIL DASAR =====================
function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function err_(code, message) {
  return jsonOut_({ ok: false, code: code, message: message });
}

function getSs_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** Format nilai sel menjadi nilai JSON yang aman. */
function fmtCell_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    // Sel jam saja (tahun 1899) -> "HH:mm", selain itu tanggal "yyyy-MM-dd"
    if (value.getFullYear() < 1900) {
      return Utilities.formatDate(value, TZ, 'HH:mm');
    }
    return Utilities.formatDate(value, TZ, 'yyyy-MM-dd');
  }
  return value;
}

function toYmd_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, TZ, 'yyyy-MM-dd');
  }
  return String(value).substring(0, 10);
}

/** Selisih hari kalender antara dua string yyyy-MM-dd (b - a). */
function dayDiff_(aYmd, bYmd) {
  var pa = aYmd.split('-');
  var pb = bYmd.split('-');
  var a = Date.UTC(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
  var b = Date.UTC(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
  return Math.round((b - a) / 86400000);
}

function todayYmd_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function checkToken_(provided) {
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN');
  if (!secret) return true; // token belum diatur -> akses mengikuti pengaturan deploy
  return provided === secret;
}

// ===================== BACA PENGATURAN =====================
function readSettings_() {
  var sh = getSs_().getSheetByName(SHEET_SETTINGS);
  if (!sh) throw new Error('Sheet "Pengaturan" tidak ditemukan');

  var head = sh.getRange('B3:B5').getValues(); // B3 mulai, B4 batas lolos, B5 batas screen time
  var names = sh.getRange('A8:A25').getValues(); // 18 nama kebiasaan
  var matrix = sh.getRange('B8:D26').getValues(); // baris 0-17 kebiasaan, baris 18 target

  var habitNames = [];
  for (var i = 0; i < HABIT_COUNT; i++) habitNames.push(String(names[i][0] || ''));

  var applicable = {};
  var targets = {};
  for (var j = 0; j < VALID_JENIS.length; j++) {
    var jenis = VALID_JENIS[j];
    var col = JENIS_COLUMNS[jenis];
    var list = [];
    for (var r = 0; r < HABIT_COUNT; r++) list.push(Number(matrix[r][col]) === 1);
    applicable[jenis] = list;
    targets[jenis] = Number(matrix[HABIT_COUNT][col]) || 0;
  }

  return {
    startDate: toYmd_(head[0][0]),
    passThreshold: Number(head[1][0]) || 0,
    screenLimit: Number(head[2][0]) || 0,
    habitNames: habitNames,
    applicable: applicable,
    targets: targets
  };
}

function computeTodayDayNumber_(startDateYmd) {
  if (!startDateYmd) return null;
  return dayDiff_(startDateYmd, todayYmd_()) + 1;
}

// ===================== BACA SATU HARI =====================
function rowToDay_(rowValues, dayNumber) {
  var habits = [];
  for (var i = 0; i < HABIT_COUNT; i++) {
    habits.push(rowValues[4 + i] === CHECK_MARK); // kolom E..V = indeks 4..21
  }
  var screen = rowValues[22]; // W
  var lang = rowValues[23];   // X
  return {
    dayNumber: dayNumber,
    date: toYmd_(rowValues[0]),
    jenisHari: String(rowValues[2] || ''),
    shift: String(rowValues[3] || ''),
    habits: habits,
    screenTime: (screen === '' || screen === null) ? null : Number(screen),
    languageMinutes: (lang === '' || lang === null) ? null : Number(lang),
    selesai: fmtCell_(rowValues[24]),  // Y
    target: fmtCell_(rowValues[25]),   // Z
    skor: fmtCell_(rowValues[26]),     // AA
    status: String(rowValues[27] || ''), // AB
    warning: String(rowValues[28] || '') // AC
  };
}

function readDay_(dayNumber) {
  var sh = getSs_().getSheetByName(SHEET_CHECKLIST);
  if (!sh) throw new Error('Sheet "Checklist" tidak ditemukan');
  var values = sh.getRange(dayNumber + 1, 1, 1, 29).getValues()[0];
  return rowToDay_(values, dayNumber);
}

function isValidDayNumber_(n) {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= DAY_MIN && n <= DAY_MAX;
}

// ===================== AKSI GET =====================
function actionBootstrap_() {
  var s = readSettings_();
  var dayNumber = computeTodayDayNumber_(s.startDate);
  var todayRow = null;
  if (dayNumber !== null && isValidDayNumber_(dayNumber)) {
    todayRow = readDay_(dayNumber);
  }
  return jsonOut_({
    ok: true,
    settings: {
      startDate: s.startDate,
      passThreshold: s.passThreshold,
      screenLimit: s.screenLimit
    },
    applicable: s.applicable,
    targets: s.targets,
    habitNames: s.habitNames,
    today: { dayNumber: dayNumber, row: todayRow }
  });
}

function actionDay_(e) {
  var n = Number(e.parameter.day);
  if (!isValidDayNumber_(n)) return err_('invalid_day', 'Nomor hari harus bilangan bulat 1 sampai 1000.');
  var day = readDay_(n);
  day.ok = true;
  return jsonOut_(day);
}

function actionSummary_() {
  var sh = getSs_().getSheetByName(SHEET_SUMMARY);
  if (!sh) return err_('sheet_missing', 'Sheet "Ringkasan" tidak ditemukan.');
  var pairsRaw = sh.getRange('A3:B12').getValues();
  var pairs = [];
  for (var i = 0; i < pairsRaw.length; i++) {
    var label = String(pairsRaw[i][0] || '').trim();
    if (label) pairs.push({ label: label, value: fmtCell_(pairsRaw[i][1]) });
  }
  var tableRaw = sh.getRange('A16:E19').getValues();
  var headers = [];
  for (var c = 0; c < tableRaw[0].length; c++) headers.push(fmtCell_(tableRaw[0][c]));
  var rows = [];
  for (var r = 1; r < tableRaw.length; r++) {
    var row = [];
    for (var k = 0; k < tableRaw[r].length; k++) row.push(fmtCell_(tableRaw[r][k]));
    rows.push(row);
  }
  return jsonOut_({ ok: true, pairs: pairs, byType: { headers: headers, rows: rows } });
}

function actionTimebudget_() {
  var sh = getSs_().getSheetByName(SHEET_TIMEBUDGET);
  if (!sh) return err_('sheet_missing', 'Sheet "Sisa waktu" tidak ditemukan.');
  var raw = sh.getRange('A3:E13').getValues();
  var headers = [];
  for (var c = 0; c < raw[0].length; c++) headers.push(fmtCell_(raw[0][c]));
  var rows = [];
  for (var r = 1; r < raw.length; r++) {
    var row = [];
    for (var k = 0; k < raw[r].length; k++) row.push(fmtCell_(raw[r][k]));
    rows.push(row);
  }
  return jsonOut_({ ok: true, headers: headers, rows: rows });
}

function actionRange_(e) {
  var from = Number(e.parameter.from);
  var to = Number(e.parameter.to);
  if (!isValidDayNumber_(from) || !isValidDayNumber_(to) || from > to) {
    return err_('invalid_range', 'Rentang hari tidak valid (1..1000, from <= to).');
  }
  if (to - from > 366) return err_('range_too_large', 'Rentang maksimal 367 hari per permintaan.');
  var sh = getSs_().getSheetByName(SHEET_CHECKLIST);
  if (!sh) return err_('sheet_missing', 'Sheet "Checklist" tidak ditemukan.');
  var values = sh.getRange(from + 1, 1, to - from + 1, 29).getValues();
  var days = [];
  for (var i = 0; i < values.length; i++) {
    var d = rowToDay_(values[i], from + i);
    var hasData = d.jenisHari !== '' || d.status !== '' ||
      d.habits.some(function (h) { return h; }) ||
      d.screenTime !== null || d.languageMinutes !== null;
    days.push({
      dayNumber: d.dayNumber,
      date: d.date,
      jenisHari: d.jenisHari,
      shift: d.shift,
      selesai: d.selesai,
      target: d.target,
      skor: d.skor,
      status: d.status,
      warning: d.warning,
      screenTime: d.screenTime,
      languageMinutes: d.languageMinutes,
      hasData: hasData
    });
  }
  return jsonOut_({ ok: true, days: days });
}

// ===================== AKSI POST: SAVE DAY =====================
function processedIds_() {
  var raw = PropertiesService.getScriptProperties().getProperty('PROCESSED_CLIENT_IDS');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

function rememberClientId_(id) {
  var ids = processedIds_();
  ids.push(id);
  if (ids.length > 300) ids = ids.slice(ids.length - 300);
  PropertiesService.getScriptProperties().setProperty('PROCESSED_CLIENT_IDS', JSON.stringify(ids));
}

function actionSaveDay_(body) {
  // --- Validasi dasar ---
  if (!body || typeof body !== 'object') return err_('invalid_body', 'Body permintaan harus JSON.');
  var clientId = body.clientId;
  if (typeof clientId !== 'string' || clientId.length < 8 || clientId.length > 128) {
    return err_('invalid_client_id', 'clientId wajib diisi (8-128 karakter).');
  }
  var dayNumber = body.dayNumber;
  if (!isValidDayNumber_(dayNumber)) {
    return err_('invalid_day', 'Nomor hari harus bilangan bulat 1 sampai 1000.');
  }
  if (body.jenisHari !== undefined && VALID_JENIS.indexOf(body.jenisHari) === -1) {
    return err_('invalid_jenis_hari', 'Jenis hari harus Normal, Lembur, atau Libur.');
  }
  if (body.shift !== undefined && VALID_SHIFT.indexOf(body.shift) === -1) {
    return err_('invalid_shift', 'Shift harus Pagi, Siang, atau Malam.');
  }
  var habitUpdates = {}; // indeks -> boolean
  if (body.habits !== undefined) {
    if (typeof body.habits !== 'object' || body.habits === null) {
      return err_('invalid_habits', 'habits harus objek {index: boolean}.');
    }
    var keys = Object.keys(body.habits);
    for (var i = 0; i < keys.length; i++) {
      var idx = Number(keys[i]);
      if (!isFinite(idx) || Math.floor(idx) !== idx || idx < 0 || idx >= HABIT_COUNT) {
        return err_('invalid_habits', 'Indeks kebiasaan harus 0 sampai 17.');
      }
      if (typeof body.habits[keys[i]] !== 'boolean') {
        return err_('invalid_habits', 'Nilai kebiasaan harus true/false.');
      }
      habitUpdates[idx] = body.habits[keys[i]];
    }
  }
  if (body.screenTime !== undefined) {
    if (typeof body.screenTime !== 'number' || !isFinite(body.screenTime) ||
        body.screenTime < 0 || body.screenTime > 24) {
      return err_('invalid_screen_time', 'Screen time harus angka 0 sampai 24 jam.');
    }
  }
  if (body.languageMinutes !== undefined) {
    if (typeof body.languageMinutes !== 'number' || !isFinite(body.languageMinutes) ||
        Math.floor(body.languageMinutes) !== body.languageMinutes ||
        body.languageMinutes < 0 || body.languageMinutes > 1440) {
      return err_('invalid_language_minutes', 'Menit belajar bahasa harus bilangan bulat 0 sampai 1440.');
    }
  }

  // --- Tulis dengan kunci agar tidak bertabrakan ---
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return err_('lock_timeout', 'Server sibuk, coba lagi sebentar.');
  }
  try {
    // Idempotent: clientId yang sama tidak diterapkan dua kali.
    if (processedIds_().indexOf(clientId) !== -1) {
      var dup = readDay_(dayNumber);
      dup.ok = true;
      dup.duplicate = true;
      return jsonOut_(dup);
    }

    var sh = getSs_().getSheetByName(SHEET_CHECKLIST);
    if (!sh) return err_('sheet_missing', 'Sheet "Checklist" tidak ditemukan.');

    var row = dayNumber + 1;
    // Baca satu blok C..X (22 kolom) lalu tulis kembali satu blok.
    var block = sh.getRange(row, 3, 1, 22).getValues()[0];
    if (body.jenisHari !== undefined) block[0] = body.jenisHari;      // C
    if (body.shift !== undefined) block[1] = body.shift;              // D
    var hKeys = Object.keys(habitUpdates);
    for (var k = 0; k < hKeys.length; k++) {
      block[2 + Number(hKeys[k])] = habitUpdates[hKeys[k]] ? CHECK_MARK : ''; // E..V
    }
    if (body.screenTime !== undefined) block[20] = body.screenTime;   // W
    if (body.languageMinutes !== undefined) block[21] = body.languageMinutes; // X
    sh.getRange(row, 3, 1, 22).setValues([block]);

    SpreadsheetApp.flush(); // pastikan rumus Y-AC selesai dihitung
    rememberClientId_(clientId);

    var result = readDay_(dayNumber);
    result.ok = true;
    result.duplicate = false;
    return jsonOut_(result);
  } finally {
    lock.releaseLock();
  }
}

// ===================== ENTRY POINT =====================
function doGet(e) {
  try {
    e = e || { parameter: {} };
    if (!checkToken_(e.parameter.token)) return err_('unauthorized', 'Token tidak valid.');
    var action = String(e.parameter.action || '');
    if (action === 'ping') return jsonOut_({ ok: true, pong: true });
    if (action === 'bootstrap') return actionBootstrap_();
    if (action === 'day') return actionDay_(e);
    if (action === 'summary') return actionSummary_();
    if (action === 'timebudget') return actionTimebudget_();
    if (action === 'range') return actionRange_(e);
    return err_('unknown_action', 'Action tidak dikenal: ' + action);
  } catch (ex) {
    return err_('server_error', 'Terjadi kesalahan di server.');
  }
}

function doPost(e) {
  try {
    e = e || {};
    var body = {};
    if (e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); }
      catch (ex) { return err_('invalid_json', 'Body bukan JSON yang valid.'); }
    }
    var token = body.token || (e.parameter && e.parameter.token);
    if (!checkToken_(token)) return err_('unauthorized', 'Token tidak valid.');
    var action = String(body.action || (e.parameter && e.parameter.action) || '');
    if (action === 'saveDay') return actionSaveDay_(body);
    return err_('unknown_action', 'Action tidak dikenal: ' + action);
  } catch (ex) {
    return err_('server_error', 'Terjadi kesalahan di server.');
  }
}
