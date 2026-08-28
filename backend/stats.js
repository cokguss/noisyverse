/**
 * stats.js — Statistik pengunjung realtime (Supabase).
 *
 * Sumber utama: tabel `site_stats` (satu baris agregat) + `visitor_hits`
 * (hash IP, bukan IP asli). Penghitungan dilakukan di dalam Postgres lewat RPC
 * `track_visit` / `refresh_stats` sehingga atomik — aman dari race condition
 * antar invocation serverless (berbeda dari model baca-ubah-tulis blob).
 *
 * Browser TIDAK memanggil modul ini; browser berlangganan perubahan baris
 * `site_stats` langsung ke Supabase Realtime memakai publishable key.
 *
 * Bila skema statistik belum dijalankan (tabel/RPC belum ada), semua fungsi
 * di sini otomatis jatuh ke penyimpanan lama di kv_store key `visitors`
 * supaya fitur tetap hidup dan tidak ada yang rusak.
 */
const { supabase, loadStore, saveStore, configured } = require("./store");

const LIVE_WINDOW_MS = 5 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Cache status ketersediaan skema realtime, supaya tidak menebak tiap request.
 * Bila Supabase belum terkonfigurasi, langsung tandai tidak tersedia agar tidak
 * ada satu pun panggilan jaringan yang dicoba (dulu ini menggantung ~7 detik).
 */
let realtimeReady = configured ? null : false;

function markUnavailable(err) {
  const msg = (err && (err.message || err.code)) || "";
  // 42P01 = tabel tidak ada, 42883 = fungsi tidak ada, PGRST202/205 = tidak di schema cache.
  if (/42P01|42883|PGRST202|PGRST205|does not exist|schema cache/i.test(String(msg))) {
    if (realtimeReady !== false) {
      console.warn(
        "[stats] Tabel/RPC statistik realtime belum ada — memakai fallback kv_store. " +
          "Jalankan ulang backend/supabase-schema.sql untuk mengaktifkan realtime."
      );
    }
    realtimeReady = false;
    return true;
  }
  return false;
}

function shape(row) {
  if (!row) return null;
  return {
    total: Number(row.total_visits) || 0,
    unique: Number(row.unique_visitors) || 0,
    live: Number(row.live_now) || 0,
    reverses: Number(row.reverses) || 0,
    prd: Number(row.prd) || 0,
    members: Number(row.members) || 0,
    updatedAt: row.updated_at || null
  };
}

/* ---------------- Fallback kv_store (skema lama) ---------------- */

async function fallbackTrack(hash) {
  const data = await loadStore("visitors", { total: 0, visitors: {} });
  const now = Date.now();
  data.total = (data.total || 0) + 1;
  const existing = data.visitors[hash];
  data.visitors[hash] = { lastSeen: now, count: existing ? (existing.count || 0) + 1 : 1 };
  for (const [h, v] of Object.entries(data.visitors)) {
    if (now - v.lastSeen > RETENTION_MS) delete data.visitors[h];
  }
  // Tanpa kredensial Supabase tidak ada tempat menyimpan; kembalikan angka
  // in-memory saja supaya endpoint tetap membalas cepat, bukan melempar error.
  if (configured) await saveStore("visitors", data);
  return fallbackShape(data);
}

function fallbackShape(data) {
  const now = Date.now();
  const entries = Object.values(data.visitors || {});
  return {
    total: data.total || 0,
    unique: entries.length,
    live: entries.filter((v) => now - v.lastSeen < LIVE_WINDOW_MS).length,
    reverses: 0,
    prd: 0,
    members: 0,
    updatedAt: null
  };
}

async function fallbackRead() {
  return fallbackShape(await loadStore("visitors", { total: 0, visitors: {} }));
}

/* ---------------- API publik modul ---------------- */

/**
 * Catat satu kunjungan (hash IP) sekaligus sinkronkan counter aplikasi.
 * Satu RPC = satu write = satu event realtime.
 */
async function trackVisit(hash, counters) {
  const c = counters || {};
  if (realtimeReady !== false) {
    const { data, error } = await supabase.rpc("track_visit", {
      p_hash: hash,
      p_reverses: c.reverses === undefined ? null : c.reverses,
      p_prd: c.prd === undefined ? null : c.prd,
      p_members: c.members === undefined ? null : c.members
    });
    if (!error) {
      realtimeReady = true;
      return shape(Array.isArray(data) ? data[0] : data);
    }
    if (!markUnavailable(error)) {
      console.error("[stats] track_visit gagal:", error.message);
      return null;
    }
  }
  const base = await fallbackTrack(hash);
  return {
    ...base,
    reverses: c.reverses || 0,
    prd: c.prd || 0,
    members: c.members || 0
  };
}

/**
 * Segarkan angka turunan (live_now yang luruh) dan sinkronkan counter aplikasi.
 * Menulis ke site_stats -> memicu event realtime ke semua browser yang terbuka.
 */
async function refreshStats(counters) {
  const c = counters || {};
  if (realtimeReady !== false) {
    const { data, error } = await supabase.rpc("refresh_stats", {
      p_reverses: c.reverses === undefined ? null : c.reverses,
      p_prd: c.prd === undefined ? null : c.prd,
      p_members: c.members === undefined ? null : c.members
    });
    if (!error) {
      realtimeReady = true;
      return shape(Array.isArray(data) ? data[0] : data);
    }
    if (!markUnavailable(error)) {
      console.error("[stats] refresh_stats gagal:", error.message);
      return null;
    }
  }
  const base = await fallbackRead();
  return {
    ...base,
    reverses: c.reverses || 0,
    prd: c.prd || 0,
    members: c.members || 0
  };
}

/** Baca snapshot tanpa menulis apa pun. */
async function readStats() {
  if (realtimeReady !== false) {
    const { data, error } = await supabase
      .from("site_stats")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (!error) {
      realtimeReady = true;
      if (data) return shape(data);
    } else if (!markUnavailable(error)) {
      console.error("[stats] readStats gagal:", error.message);
    }
  }
  return fallbackRead();
}

/**
 * Heartbeat: segarkan last_seen tanpa menambah total kunjungan.
 * Membuat angka "sedang online" turun otomatis saat pengunjung menutup tab.
 */
async function touchVisit(hash) {
  if (realtimeReady !== false) {
    const { data, error } = await supabase.rpc("touch_visit", { p_hash: hash });
    if (!error) {
      realtimeReady = true;
      return shape(Array.isArray(data) ? data[0] : data);
    }
    if (!markUnavailable(error)) {
      console.error("[stats] touch_visit gagal:", error.message);
      return null;
    }
  }
  // Fallback: perbarui lastSeen di blob lama tanpa menaikkan total.
  const data = await loadStore("visitors", { total: 0, visitors: {} });
  const now = Date.now();
  const existing = data.visitors[hash];
  data.visitors[hash] = { lastSeen: now, count: existing ? existing.count || 1 : 1 };
  if (configured) await saveStore("visitors", data);
  return fallbackShape(data);
}

module.exports = { trackVisit, touchVisit, refreshStats, readStats, LIVE_WINDOW_MS };

