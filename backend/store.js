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

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "[store] SUPABASE_URL / SUPABASE_SERVICE_KEY belum di-set. " +
      "Set kedua env ini (service-role key, server-side saja) sebelum menjalankan."
  );
}

const supabase = createClient(
  SUPABASE_URL || "http://localhost:54321",
  SUPABASE_SERVICE_KEY || "missing-service-key",
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

/** Baca satu blob. Mengembalikan `fallback` (di-clone) bila baris belum ada / error. */
async function loadStore(key, fallback) {
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

module.exports = { supabase, loadStore, saveStore, seedStore, TABLE };
