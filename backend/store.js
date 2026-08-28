/**
 * store.js — Data layer Supabase (model KV-blob).
 *
 * Menggantikan file JSON di backend/data/*.json. Setiap "file" lama = satu baris
 * pada tabel `kv_store(key text primary key, data jsonb, updated_at timestamptz)`.
 *
 * API sengaja dibuat mirip loadJson/saveJson lama (kini async) supaya logika
 * handler di server.js tidak berubah — cukup ditambah `await`.
 */
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  "";
const TABLE = process.env.SUPABASE_TABLE || "kv_store";

/**
 * Apakah kredensial Supabase tersedia. Bila tidak, JANGAN pernah menembak
 * jaringan: dulu klien dibuat ke "http://localhost:54321" sebagai placeholder,
 * dan di lingkungan serverless setiap panggilan menggantung sampai timeout
 * (~7 detik per akses data) sebelum akhirnya gagal. Sekarang modul ini tahu
 * dirinya belum terkonfigurasi dan langsung mengembalikan fallback.
 */
const configured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

const MISCONFIG_MSG =
  "SUPABASE_URL / SUPABASE_SERVICE_KEY belum di-set. Isi kedua env ini " +
  "(service-role key, server-side saja) lalu redeploy — tanpa itu data tidak tersimpan.";

if (!configured) console.error("[store] " + MISCONFIG_MSG);

/** Warn sekali per proses saja supaya log tidak dibanjiri satu baris per request. */
let warnedMisconfig = false;
function warnMisconfig(op) {
  if (warnedMisconfig) return;
  warnedMisconfig = true;
  console.error("[store] " + op + " dilewati — " + MISCONFIG_MSG);
}

const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

/** Baca satu blob. Mengembalikan `fallback` (di-clone) bila baris belum ada / error. */
async function loadStore(key, fallback) {
  if (!configured) {
    warnMisconfig("loadStore(" + key + ")");
    return clone(fallback);
  }
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("data")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.data == null) return clone(fallback);
    return data.data;
  } catch (e) {
    console.error("[store] loadStore(" + key + ") gagal:", e.message);
    return clone(fallback);
  }
}

/** Tulis (upsert) satu blob. */
async function saveStore(key, value) {
  if (!configured) {
    warnMisconfig("saveStore(" + key + ")");
    throw new Error(MISCONFIG_MSG);
  }
  const { error } = await supabase
    .from(TABLE)
    .upsert({ key, data: value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) {
    console.error("[store] saveStore(" + key + ") gagal:", error.message);
    throw error;
  }
  return value;
}

/** Seed nilai default hanya bila key belum ada (idempoten). */
async function seedStore(key, value) {
  if (!configured) {
    warnMisconfig("seedStore(" + key + ")");
    return;
  }
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("key")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (!data) await saveStore(key, value);
  } catch (e) {
    console.error("[store] seedStore(" + key + ") gagal:", e.message);
  }
}

module.exports = { supabase, loadStore, saveStore, seedStore, TABLE, configured };
