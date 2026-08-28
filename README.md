<div align="center">

# 🌌 Noisy Verse

**Reverse website & repo jadi prompt AI — plus generator PRD sekali klik**

`Tempel URL → Reverse → Prompt siap pakai`

![Vanilla JS](https://img.shields.io/badge/Vanilla-JS-f7df1e?logo=javascript&logoColor=black)
![CSS3](https://img.shields.io/badge/CSS-3-1572b6?logo=css3&logoColor=white)
![Node/Express](https://img.shields.io/badge/Node-Express-3c873a?logo=node.js&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e?logo=supabase&logoColor=white)
![Telegram Bot](https://img.shields.io/badge/Telegram-Bot-229ed9?logo=telegram&logoColor=white)
![License](https://img.shields.io/badge/Lisensi-Penggunaan--pribadi-a78bfa)

</div>

---

## ✨ Fitur

| Fitur | Kemampuan |
| --- | --- |
| **Reverse Website** | Ubah URL website apa pun jadi prompt lengkap untuk membangun ulang tampilan & fungsinya |
| **Reverse Repo** | Ubah repo GitHub jadi prompt/brief teknis |
| **Design System** | Ekstrak *design system* (warna, tipografi, komponen) ke `design.md` |
| **PRD AI** | Generate PRD dari brief singkat, plus klarifikasi, audit, & penyempurnaan otomatis |
| **Terjemahan** | Terjemahkan hasil reverse EN ⇄ ID tanpa merusak struktur markdown |
| **Paket & Kupon** | Harga dinamis, kuota reverse/PRD per paket, kupon diskon |
| **Statistik Realtime** | Jumlah pengunjung & "sedang online" ter-*update* seketika via Supabase Realtime |
| **Pembayaran** | Konfirmasi bukti bayar via bot Telegram → aktivasi paket otomatis |
| **Admin Panel** | Kelola user, pesanan, paket, kupon, notifikasi, broadcast, & maintenance |

**Sorotan:**

- 🖥️ Frontend statis murni (HTML/CSS/*vanilla* JS) — tanpa framework, ringan & cepat
- 🔒 Auth berbasis cookie sesi (HttpOnly), password di-*hash* `scrypt` + *salt*
- 📊 Statistik pengunjung **realtime** — IP di-*hash* SHA256, penghitungan atomik di Postgres
- 🤖 Fallback AI mandiri saat upstream reverse gagal — layanan tetap jalan
- 🚀 Siap deploy *full-serverless* di Vercel + Supabase

---
## 🚀 Menjalankan Secara Lokal

**Prasyarat:** Node.js `>=18`, akun [Supabase](https://supabase.com) (gratis), bot Telegram dari [@BotFather](https://t.me/BotFather).

```bash
# 1. Install dependency
npm run setup

# 2. Siapkan Supabase: buka SQL Editor di dashboard,
#    jalankan isi file backend/supabase-schema.sql

# 3. Salin & isi environment variables
cp .env.example backend/.env      # lalu edit backend/.env

# 4. Jalankan server dev (mode polling bot Telegram)
npm run dev
```

> ⚠️ **Wajib set env.** Tanpa `SUPABASE_URL` & `SUPABASE_SERVICE_KEY`, data tidak akan tersimpan. Tanpa `ADMIN_KEY`, semua endpoint admin ditolak. Gunakan **service_role** key Supabase (server-side saja) — jangan pernah taruh di frontend.

### Script yang tersedia

| Perintah | Fungsi |
| --- | --- |
| `npm run setup` | Install dependency di `backend/` |
| `npm run dev` | Jalankan server + bot (polling) dengan auto-reload |
| `npm start` | Jalankan server produksi lokal |
| `npm run set-webhook` | Daftarkan webhook Telegram ke `PUBLIC_BASE_URL` |

---

## 🧠 Cara Kerja

```
Browser (statis)                Serverless (Vercel)              Layanan
─────────────────               ───────────────────              ───────
index.html / prd.html  ──fetch──►  /api/*  (Express app)
       │                             ├──► reverse ───────────►  GitReverse / AI fallback
       │                             ├──► PRD ───────────────►  AI providers
       │                             ├──► auth/orders/kupon ──►  Supabase (kv_store)
       │                             ├──► track/visit ───────►  Supabase (RPC track_visit)
       │                             └──► /api/telegram/webhook ◄── Telegram Bot API
       │
       └── WebSocket ────────────────────────────────────────►  Supabase Realtime
                                                                (tabel site_stats)
```

Backend Express (`backend/server.js`) berjalan sebagai **satu serverless function** (`api/index.js`). Semua data yang dulu di file JSON kini disimpan di Supabase Postgres dengan model **KV-blob**: satu tabel `kv_store(key, data jsonb)`, satu baris per entitas (`users`, `orders`, `packages`, dst.). Bot Telegram berpindah dari *polling* ke **webhook** agar cocok dengan lingkungan *stateless*.

**Statistik pengunjung realtime.** Statistik tidak ikut model KV-blob karena butuh penghitungan atomik dan siaran instan. Dua tabel khusus dipakai: `site_stats` (satu baris agregat) dan `visitor_hits` (hash IP + `last_seen`). Server memanggil RPC Postgres (`track_visit`, `touch_visit`, `refresh_stats`) sehingga seluruh penambahan terjadi di dalam database — aman dari *race condition* antar-*invocation*. Browser lalu berlangganan perubahan baris `site_stats` lewat **Supabase Realtime** memakai *publishable key* (hanya `SELECT`; tabel `visitor_hits` ditolak total oleh RLS), jadi angka bergerak seketika tanpa *polling*. Bila `SUPABASE_ANON_KEY` tidak di-set atau WebSocket gagal, frontend otomatis kembali ke *polling* 30 detik.

---

## 📁 Struktur Proyek

```
noisyverse/
├── index.html            # Landing + reverse + harga
├── prd.html              # Generator PRD AI
├── admin.html            # Panel admin
├── design.html           # Viewer design system
├── css/ · js/ · assets/  # Aset frontend statis
├── api/
│   └── index.js          # Entrypoint serverless (export app Express)
├── backend/
│   ├── server.js         # App Express (semua route /api/*)
│   ├── bot.js            # Bot Telegram (polling + webhook)
│   ├── ai.js             # Klien AI multi-provider + fallback
│   ├── store.js          # Data layer Supabase (KV-blob)
│   ├── stats.js          # Statistik pengunjung realtime (RPC + fallback)
│   ├── set-webhook.js    # Script daftar/hapus webhook Telegram
│   └── supabase-schema.sql
└── vercel.json           # Rewrites /api/* + maxDuration 60s
```

---

## ☁️ Deploy

### Supabase

1. Buat project baru → **SQL Editor** → jalankan `backend/supabase-schema.sql`.
2. Ambil `Project URL` & `service_role` key dari **Settings → API**.

### Vercel

1. Import repo ke Vercel (framework preset: **Other**).
2. Isi Environment Variables (lihat tabel), lalu **Deploy**.
3. Set webhook Telegram sekali: `PUBLIC_BASE_URL=https://<domain> npm run set-webhook`.

**Environment variables:**

| Variabel | Wajib? | Keterangan |
| --- | --- | --- |
| `SUPABASE_URL` | ✅ | URL project Supabase |
| `SUPABASE_SERVICE_KEY` | ✅ | *service_role* / `sb_secret_…` key (server-side saja) |
| `SUPABASE_ANON_KEY` | ➖ | *publishable* / `sb_publishable_…` key — dipakai browser untuk statistik realtime. Kosong = frontend jatuh ke *polling* |
| `ADMIN_KEY` | ✅ | Kunci akses panel admin (`X-Admin-Key`) |
| `TELEGRAM_BOT_TOKEN` | ✅ | Token bot dari BotFather |
| `TELEGRAM_OWNER_ID` | ✅ | ID Telegram owner (penerima notifikasi) |
| `PUBLIC_BASE_URL` | ➖ | Domain publik untuk webhook & callback bot |
| `TELEGRAM_WEBHOOK_SECRET` | ➖ | Secret verifikasi webhook |
| `TELEGRAM_BOT_USERNAME` | ➖ | Username bot (fallback tampilan frontend) |
| `VISITOR_SALT` | ➖ | Salt hash IP pengunjung (ganti dengan string acak sendiri) |
| `AI_API_KEY` | ➖ | Key provider AI utama; tanpa ini rantai *fallback* pakai provider tanpa-key |
| `AI_API_URL` / `UNLIAI_URL` / … | ➖ | Override endpoint provider AI |

> ⚠️ Vercel **Hobby** membatasi durasi function **60 detik**. Reverse (±22s) + fallback AI masih aman; jaga `REVERSE_TIMEOUT_MS` di bawah batas.

---

## ⚠️ Catatan

- Reverse bergantung pada upstream *GitReverse*; saat *down*, sistem otomatis pakai *fallback* AI mandiri.
- Model *KV-blob* membaca-menulis blob utuh per entitas — sederhana & aman pada skala saat ini, bukan untuk *concurrency* ekstrem. Statistik pengunjung **tidak** memakai model ini (pakai RPC atomik di Postgres).
- Statistik realtime butuh tabel `site_stats`/`visitor_hits` dari `supabase-schema.sql`. Bila skema belum dijalankan, `backend/stats.js` otomatis jatuh ke `kv_store` — fitur tetap jalan, hanya tidak realtime.
- Data lama di `backend/data/*.json` **tidak** ikut di-commit (ada di `.gitignore`); migrasikan manual ke Supabase bila perlu.
- Rotasi `TELEGRAM_BOT_TOKEN` & `ADMIN_KEY` bila nilai lama pernah terekspos.

---

<div align="center">

🌌 Dibuat oleh [**cokguss**](https://github.com/cokguss) — *loud ideas, quiet code*

</div>

