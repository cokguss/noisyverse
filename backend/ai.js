const AI_API_URL = process.env.AI_API_URL || "https://api.haidarxd.my.id/api/v1/ai/claude-sonnet-5";
const AI_API_KEY = process.env.AI_API_KEY || "";
const UNLIAI_URL = process.env.UNLIAI_URL || "https://api.ikyyxd.my.id/ai/unliai?teks=";
const METAAI_URL = process.env.METAAI_URL || "https://api.ikyyxd.my.id/ai/metaai?prompt=";
// Vercel Hobby membunuh function pada 60 detik. Timeout per provider harus jauh
// di bawah itu, karena chain mencoba tiga provider berurutan: kalau satu
// provider menggantung 90s, function mati sebelum fallback dicoba dan pengguna
// dapat "AI sedang tidak tersedia" padahal provider kedua sehat.
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS, 10) || 17000;

async function fetchWithTimeout(url, opts, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || AI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...(opts || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Provider gratis kadang membalas HTTP 200 berisi penolakan ("teks terlalu
 * panjang", "login dulu") — bukan error, tapi juga bukan jawaban. Kalau
 * diteruskan, teks penolakan itu muncul sebagai hasil reverse/PRD di layar
 * pengguna. Deteksi di satu tempat supaya berlaku untuk SEMUA provider.
 */
const REFUSAL_RE =
  /anonymous users have reached the limit|sign in to continue with long text|message is quite long|insufficient tokens|rate limit|silakan login|terlalu panjang/i;

function assertUsable(text, providerName) {
  if (!text) throw new Error(providerName + " kosong");
  if (REFUSAL_RE.test(text)) throw new Error(providerName + " menolak (limit/teks panjang)");
  return text;
}


function extractAiText(data) {
  if (typeof data === "string") return data.trim();
  if (!data || typeof data !== "object") return "";
  const candidates = [data.reply, data.result, data.answer, data.response, data.content, data.text];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (c && typeof c === "object") {
      const nested = extractAiText(c);
      if (nested) return nested;
    }
  }
  if (data.data !== undefined) return extractAiText(data.data);
  return "";
}

function cleanMarkdown(text) {
  return String(text)
    .split("\n")
    .filter((l) => !/^:::/.test(l.trim()))
    .join("\n")
    .trim();
}

/* ---------- Provider 1: HaidarXD Claude Sonnet ---------- */
// API ini menerima parameter lewat query string DAN body JSON; apikey wajib di
// query (tanpa itu 401 "Parameter 'apikey' wajib disertakan"). Prompt panjang
// dikirim di body supaya tidak menabrak batas panjang URL.
async function haidarxd(prompt, instruction) {
  if (!AI_API_KEY) throw new Error("haidarxd tanpa apikey");
  const url = AI_API_URL + (AI_API_URL.includes("?") ? "&" : "?") + "apikey=" + encodeURIComponent(AI_API_KEY);
  // Field `instruction` diabaikan oleh provider ini, jadi gabungkan ke message —
  // tanpa ini semua instruksi format (bahasa, struktur PRD) hilang tanpa jejak.
  const message = instruction
    ? String(instruction).trim() + "\n\n" + String(prompt).trim()
    : String(prompt).trim();
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": AI_API_KEY,
      "Authorization": "Bearer " + AI_API_KEY
    },
    body: JSON.stringify({ message, thinking: false })
  });
  if (!res.ok) throw new Error("haidarxd " + res.status);
  const data = await res.json().catch(() => null);
  const text = cleanMarkdown(extractAiText(data));
  return assertUsable(text, "haidarxd");
}

/* ---------- Provider 2: Unliai ---------- */
async function unliai(prompt, instruction) {
  const full = instruction ? instruction + "\n\n" + prompt : prompt;
  const res = await fetchWithTimeout(UNLIAI_URL + encodeURIComponent(full));
  if (!res.ok) throw new Error("unliai " + res.status);
  const data = await res.json().catch(() => null);
  let text = data && data.result ? String(data.result.response || "").trim() : "";
  if (/tidak ada respon/i.test(text)) throw new Error("unliai kosong");
  return assertUsable(cleanMarkdown(text), "unliai");
}

/* ---------- Provider 3: MetaAI (llama-4-scout, andal untuk fallback) ---------- */
async function metaai(prompt, instruction) {
  const full = instruction ? instruction + "\n\n" + prompt : prompt;
  const res = await fetchWithTimeout(METAAI_URL + encodeURIComponent(full));
  if (!res.ok) throw new Error("metaai " + res.status);
  const data = await res.json().catch(() => null);
  const text = data && data.result ? String(data.result.response || "").trim() : "";
  return assertUsable(cleanMarkdown(text), "metaai");
}

/* ---------- Chain ---------- */
const PROVIDERS = [
  { name: "haidarxd", fn: haidarxd },
  { name: "unliai", fn: unliai },
  { name: "metaai", fn: metaai }
];

async function generateText(prompt, instruction) {
  const errors = [];
  for (const provider of PROVIDERS) {
    try {
      const text = await provider.fn(prompt, instruction);
      return { text, provider: provider.name };
    } catch (err) {
      errors.push(provider.name + ": " + err.message);
    }
  }
  throw new Error("Semua provider AI gagal (" + errors.join(" | ") + ")");
}

/* ---------- Assistant (chatbot) — MetaAI utama, lalu Cici, lalu Claude ---------- */
const CICI_URL = process.env.CICI_URL || "https://api.ikyyxd.my.id/ai/cici?prompt=";

async function assistant(prompt, context) {
  const full = context ? context + "\n\nPertanyaan admin: " + prompt : prompt;
  // Utama: MetaAI (andal & natural).
  try {
    const res = await fetchWithTimeout(METAAI_URL + encodeURIComponent(full));
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const text = data && data.result ? String(data.result.response || "").trim() : "";
      if (text && !REFUSAL_RE.test(text)) return text;
    }
  } catch (err) {
    // lanjut ke fallback
  }
  // Fallback 1: Cici.
  try {
    const res = await fetchWithTimeout(CICI_URL + encodeURIComponent(full));
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const text = data && data.result ? String(data.result.reply || "").trim() : "";
      if (text && !REFUSAL_RE.test(text)) return text;
    }
  } catch (err) {
    // lanjut ke fallback
  }
  // Fallback 2: Claude berbayar — chatbot jangan sampai mati total kalau dua
  // provider gratis di atas kehabisan kuota (MetaAI pernah 500 "insufficient tokens").
  return haidarxd(prompt, context || "");
}

module.exports = { generateText, extractAiText, cleanMarkdown, assistant };
