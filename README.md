# Checklist 1000 Hari — Aplikasi Web (PWA)

Aplikasi untuk mengisi checklist harian tantangan 1000 hari kebiasaan:
1–2 ketukan per kebiasaan, langsung tersimpan, tetap bisa dipakai tanpa sinyal.
**Google Sheets adalah sumber kebenaran tunggal** — skor, status, dan ringkasan
dihitung oleh rumus di spreadsheet; aplikasi hanya menulis input mentah
(kolom C, D, E–V, W, X) dan membaca hasilnya.

```
HP (PWA) ──► Google Apps Script Web App ──► Google Sheets (milikmu)
   ▲                (Code.gs)                     │
   └──── antrean offline di HP, sinkron otomatis saat online
```

---

## Tahap 1 — Rencana & daftar asumsi

**Rencana:** (1) backend Apps Script sesuai kontrak API, (2) frontend satu layar
"Hari ini" dulu, (3) antrean offline + sinkronisasi, (4) Riwayat/Ringkasan/Sisa
waktu, (5) PWA + mode gelap, (6) fitur opsional, (7) uji otomatis backend dengan
spreadsheet palsu, (8) panduan deploy ini.

**Asumsi yang diambil (opsi paling sederhana, sesuai instruksimu):**

1. **File spreadsheet tidak terlampir di chat ini**, jadi struktur dibaca 100%
   dari teks spesifikasimu (nama sheet, kolom, dan rentang persis seperti yang
   kamu tulis). Konsekuensinya: label di sheet *Ringkasan* dan *Sisa waktu*
   tidak ditebak — aplikasi menampilkannya apa adanya dari sheet.
2. **Frontend memakai HTML/JS biasa (vanilla), bukan React + Vite.** Lebih
   sederhana untuk pemula: tanpa proses build, tanpa `node_modules`, total
   ukuran folder `web/` hanya ±92 KB, dan bisa di-host di mana saja.
3. **Antrean offline memakai localStorage, bukan IndexedDB.** Data yang
   diantrekan sangat kecil (maksimal beberapa hari × beberapa field), jadi
   localStorage cukup dan jauh lebih sederhana dirawat.
4. **Deploy Web App memakai akses "Anyone" + token rahasia panjang.**
   Alasannya teknis: akses "Only myself" membuat browser HP (dari domain
   GitHub Pages/Netlify) gagal memanggil Web App karena Google mengalihkan ke
   halaman login dan memblokir CORS. Sesuai aturan cadangamu, perlindungannya
   diganti token: token disimpan di *Script Properties* (bukan di kode) dan
   hanya tersimpan di HP-mu. Tanpa token yang benar, server membalas
   `unauthorized`.
5. **Zona waktu spreadsheet harus Asia/Jakarta** (File → Settings →
   Time zone), agar rumus tanggal di kolom A dan hitungan "hari ke-N" di
   backend selaras.
6. **Pratinjau skor** (saat belum tersinkron) dihitung sebagai
   `selesai / target` memakai target per jenis hari dari `Pengaturan!B26:D26`.
   Ini hanya pratinjau dan selalu diberi label "Perkiraan". Setelah sinkron,
   yang ditampilkan adalah hasil rumus spreadsheet (kolom Y–AB) apa adanya.
7. **Mengosongkan screen time / menit bahasa:** input kosong tidak disimpan;
   isi `0` untuk mengosongkan (server memang hanya menulis angka).
8. Endpoint `range` dibatasi maksimal 367 hari per permintaan; frontend
   otomatis memecah permintaan besar menjadi beberapa potongan.
9. Balasan `bootstrap` membawa satu field tambahan `targets` (target per jenis
   hari) di luar kontrak — sifatnya tambahan, tidak mengubah field lain.
10. **Pengingat lokal hanya berbunyi saat aplikasi terbuka/baru dipakai.**
    PWA gratis tanpa server push memang dibatasi HP; tidak ada cara gratis
    yang andal untuk notifikasi terjadwal saat aplikasi tertutup total.
11. **Catatan per hari (kolom AD) TIDAK dibuat** — itu mengubah struktur
    spreadsheet, dan spesifikasimu sendiri mewajibkan persetujuanmu dulu.
    Minta saja kalau mau ditambahkan.

---

## Struktur proyek

```
apps-script/
  Code.gs            backend (doGet/doPost, semua action sesuai kontrak)
  appsscript.json    manifest (zona waktu Asia/Jakarta, runtime V8)
web/
  index.html         4 layar: Hari ini, Riwayat, Ringkasan, Sisa waktu
  manifest.webmanifest
  sw.js              service worker (cache file aplikasi saja, bukan data)
  css/styles.css     mobile-first, mode terang/gelap, target sentuh ≥48px
  js/config.js       SATU tempat konfigurasi URL endpoint + token
  js/api.js          lapisan API (satu-satunya yang bicara ke Apps Script)
  js/store.js        lapisan offline: antrean, cache, preferensi
  js/sync.js         mesin sinkronisasi antrean (idempotent per clientId)
  js/app.js          logika layar
  icons/             ikon PWA 192/512/maskable
tests/
  apps-script.test.js  uji otomatis backend dengan spreadsheet palsu
```

---

## Langkah setup (berurutan, lakukan persis seperti ini)

### A. Siapkan spreadsheet

1. Buka spreadsheet Checklist 1000 Hari milikmu.
2. Pastikan nama sheet persis: `Checklist`, `Pengaturan`, `Ringkasan`,
   `Sisa waktu` (peka huruf besar/kecil dan spasi).
3. Klik **File → Settings → Time zone → (GMT+07:00) Jakarta → Save**.
4. Jangan mengubah susunan kolom/baris — backend mengandalkan struktur ini.

### B. Pasang backend (Apps Script)

1. Di spreadsheet: klik **Extensions → Apps Script**. Tab editor terbuka.
2. Hapus isi file `Code.gs` bawaan, lalu tempel **seluruh isi**
   `apps-script/Code.gs` dari proyek ini.
3. Klik ikon gerigi **Project Settings** (kiri) → centang
   **"Show appsscript.json manifest file in editor"**.
4. Kembali ke **Editor**, buka file `appsscript.json`, ganti isinya dengan
   file `apps-script/appsscript.json` dari proyek ini.
5. Masih di **Project Settings** → bagian **Script Properties** →
   **Add script property**:
   - Property: `SECRET_TOKEN`
   - Value: token acak panjang (minimal 32 karakter). Buat dengan pengelola
     kata sandi HP-mu, atau gabungan kata acak + angka yang panjang.
     **Simpan token ini** — nanti diisi sekali di aplikasi HP.
6. Klik **Save project** (ikon disket).

### C. Deploy Web App

1. Klik **Deploy → New deployment**.
2. Klik ikon gerigi di samping "Select type" → pilih **Web app**.
3. Isi:
   - Description: `Checklist 1000 Hari v1`
   - **Execute as: Me**
   - **Who has access: Anyone**  ← wajib untuk PWA (lihat asumsi 4; token
     yang melindunginya)
4. Klik **Deploy** → bila diminta, klik **Authorize access**, pilih akun
   Google-mu, dan izinkan (ini aplikasimu sendiri).
5. Salin **Web app URL** yang berakhiran `/exec`. Ini URL endpoint-mu.

> Setiap kali nanti mengubah `Code.gs`, deploy ulang sebagai versi baru:
> **Deploy → Manage deployments → ikon pensil → Version: New version →
> Deploy.** URL tetap sama.

### D. Uji backend dengan curl (opsional, dari komputer)

Ganti `URL` dan `TOKEN` dengan milikmu:

```bash
# tes koneksi
curl "URL?action=ping&token=TOKEN"
# -> {"ok":true,"pong":true}

# bootstrap (pengaturan + hari ini)
curl "URL?action=bootstrap&token=TOKEN"

# satu hari
curl "URL?action=day&day=5&token=TOKEN"

# simpan satu hari (contoh: centang kebiasaan ke-1 di hari ke-5)
curl -X POST "URL" -H "Content-Type: text/plain;charset=utf-8" -d '{
  "action":"saveDay","token":"TOKEN","dayNumber":5,
  "jenisHari":"Normal","shift":"Pagi",
  "habits":{"0":true},"screenTime":3.5,"languageMinutes":30,
  "clientId":"uji-curl-0001","clientTimestamp":"2026-11-20T09:00:00.000Z"
}'
```

Balasan `saveDay` harus memuat `selesai`, `target`, `skor`, `status` hasil
rumus spreadsheet. Cek juga di sheet: sel **E6** terisi `✓`
(hari ke-5 = baris 6, kebiasaan ke-1 = kolom E).

### E. Hosting frontend (pilih satu, keduanya gratis)

**GitHub Pages:**
1. Buat repo baru di GitHub (mis. `checklist-1000`).
2. Upload **isi folder `web/`** ke repo (file `index.html` harus di root repo).
3. Repo → **Settings → Pages** → Source: **Deploy from a branch** →
   Branch: `main`, folder `/ (root)` → **Save**.
4. Tunggu ±1 menit; URL-mu tampil di halaman yang sama
   (`https://<username>.github.io/checklist-1000/`).

**Netlify (lebih gampang):**
1. Buka netlify.com → login → **Sites → Add new site → Deploy manually**.
2. Seret folder `web/` ke area upload. Selesai — URL langsung jadi.

### F. Atur aplikasi di HP (sekali saja)

1. Buka URL frontend di Chrome HP.
2. Ketuk ikon **⚙️ Pengaturan** → tempel **Web app URL** (`/exec`) dan
   **token** yang sama dengan Script Properties → **Tes koneksi** (harus
   "Berhasil terhubung ✓") → **Simpan**.
3. Pasang ke layar utama: menu Chrome **⋮ → "Tambahkan ke Layar utama"**
   (atau "Install app"). Setelah itu aplikasi terbuka seperti aplikasi biasa,
   termasuk saat offline.

---

## Cara kerja offline & konflik

- Setiap ketukan langsung tersimpan di HP (optimistic) dan masuk antrean.
- Antrean **digabung per hari**: banyak perubahan pada hari yang sama menjadi
  satu kiriman, jadi tidak boros kuota dan tidak ada duplikasi.
- Saat online, antrean dikirim satu per satu. Indikator di atas menampilkan
  **"Belum tersinkron (n)"** selama masih ada antrean; ketuk indikator itu
  untuk memaksa sinkron.
- Setiap kiriman punya `clientId` tetap; bila pengiriman terputus dan diulang,
  server mengenali `clientId` yang sama dan **tidak menerapkannya dua kali**.
- Konflik (hari yang sama diubah dari perangkat lain): begitu sinkron selesai,
  tampilan diganti dengan data terbaru dari server (sumber kebenaran), dan
  perubahan yang ditolak server (mis. nilai tidak valid) diberi tahu lewat
  pesan di layar.

## Keamanan & privasi

- Token hanya ada di Script Properties dan di HP-mu; **tidak ada token/URL di
  repo publik**.
- Semua input divalidasi ketat di server (enum jenis/shift, angka dalam
  rentang, boolean untuk kebiasaan) sehingga input tidak bisa menjadi rumus
  (anti *formula injection*).
- Server hanya pernah menulis kolom **C, D, E–V, W, X** dalam satu blok;
  kolom A, B, Y–AC dan sheet lain tidak tersentuh (terbukti di uji otomatis).
- `LockService` mencegah dua permintaan menulis bersamaan.
- Tidak ada analytics/tracker; data hanya pergi ke Web App milikmu sendiri.
- Log server tidak mencatat isi data kebiasaan.

---

## Checklist pengujian (kriteria penerimaan)

Jalankan uji otomatis backend (dari komputer, butuh Node.js):

```bash
node tests/apps-script.test.js
# Hasil saat proyek ini diserahkan: 45 lolos, 0 gagal
```

Uji manual di HP + spreadsheet setelah deploy:

- [ ] Centang "Tidur cukup" di aplikasi → sel E pada baris (hari ke + 1)
      terisi `✓` dan skor di spreadsheet berubah.
- [ ] Kolom A, B, Y–AC dan sheet lain tidak berubah oleh aplikasi.
- [ ] Ganti Jenis hari ke "Lembur" → kebiasaan Tambahan hilang dari daftar
      dan target/skor menyesuaikan.
- [ ] Isi screen time di atas batas `Pengaturan!B5` → muncul peringatan merah.
- [ ] Matikan data/WiFi → centang beberapa kebiasaan → indikator menunjukkan
      "Belum tersinkron (n)" → nyalakan lagi → otomatis tersinkron, tanpa
      centang ganda.
- [ ] Buka hari ke-1 dan hari ke-1000 dari kalender/pemilih tanggal →
      keduanya bisa; tanggal di luar rentang ditolak aplikasi.
- [ ] Di bawah jam 06.00 pagi → muncul tawaran "Lanjutkan hari kemarin".
- [ ] Install ke layar utama → buka dari ikon → aplikasi tampil penuh dan
      cepat (file aplikasi hanya ±92 KB, ter-cache di HP).

## Masalah umum

| Gejala | Penyebab & obat |
|---|---|
| `unauthorized` | Token di aplikasi ≠ `SECRET_TOKEN` di Script Properties. Samakan persis. |
| "Server tidak menjawab dengan benar" | URL salah (harus berakhiran `/exec`, bukan `/dev`), atau deployment belum jadi. |
| Perubahan kode backend tidak terasa | Kamu mengedit `Code.gs` tapi belum deploy versi baru (lihat catatan di langkah C). |
| Hari ke-N meleset satu hari | Zona waktu spreadsheet belum Asia/Jakarta (langkah A.3), atau `Pengaturan!B3` bukan tanggal mulai yang benar. |
| Aplikasi tidak bisa di-install | Harus dibuka lewat HTTPS (GitHub Pages/Netlify sudah HTTPS) dan dibuka sekali saat online agar service worker terpasang. |
| Data lama tampil terus | Itu cache offline; buka saat online dan ketuk indikator sinkron untuk memuat ulang. |

## Yang belum dikerjakan (sengaja)

- **Catatan per hari (kolom AD)** — menunggu persetujuanmu karena mengubah
  struktur spreadsheet (lihat asumsi 11).
- Uji end-to-end terhadap spreadsheet aslimu hanya bisa dilakukan setelah
  kamu deploy (langkah B–C) — backend sudah dibuktikan dengan spreadsheet
  palsu yang meniru rumus sheet (45 uji lolos).
