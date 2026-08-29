const AI_API_URL = process.env.AI_API_URL || "https://api.haidarxd.my.id/api/v1/ai/claude-sonnet-5";
const AI_API_KEY = process.env.AI_API_KEY || "";
const UNLIAI_URL = process.env.UNLIAI_URL || "https://api.ikyyxd.my.id/ai/unliai?teks=";
const METAAI_URL = process.env.METAAI_URL || "https://api.ikyyxd.my.id/ai/metaai?prompt=";
// Vercel Hobby membunuh function pada 60 detik. Timeout per provider harus jauh
// di bawah itu, karena chain mencoba tiga provider berurutan: kalau satu
// provider menggantung 90s, function mati sebelum fallback dicoba dan pengguna
// dapat "AI sedang tidak tersedia" padahal provider kedua sehat.
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS, 10) || 17000;
// Anggaran default untuk seluruh chain. Empat provider × AI_TIMEOUT_MS = 68s, sudah
// melewati batas 60s Vercel Hobby: function akan dibunuh sebelum sempat membalas
// apa pun, jadi pemanggil kehilangan pesan error maupun fallback template-nya.
const AI_CHAIN_BUDGET_MS = parseInt(process.env.AI_CHAIN_BUDGET_MS, 10) || 42000;

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
    // unliai membuka jawaban dengan sapaan lalu identitas dirinya, dalam banyak
    // varian: "UnlimitedAI.Chat: ...", "Halo, saya UnlimitedAI.Chat.", "Halo! Saya
    // UnlimitedAI.Chat." Kalau dibiarkan, nama provider gratis itu tercetak sebagai
    // baris pertama PRD dan hasil reverse pengguna. Buang sapaan + kalimat identitas
    // beserta baris kosong sesudahnya.
    .replace(
      /^\s*(?:hai|halo|hello|hi)[!., ]+(?:saya|aku|i am|i'm)\s+[A-Za-z0-9._-]*AI[A-Za-z0-9._-]*[.!]?\s*/i,
      ""
    )
    .replace(/^\s*[A-Za-z0-9._-]*AI(?:\.Chat)?[A-Za-z0-9._-]*\s*:\s*/i, "")
    // unliai juga sering menaruh satu kalimat basa-basi ("Tentu, ini...", "Berikut
    // adalah...", "Saya siap membantu...", "Sure, here is...") lalu pemisah `---`
    // sebelum konten asli. Hanya buang bila diikuti `---`/heading — supaya tidak
    // pernah memotong isi PRD/reverse yang sesungguhnya.
    .replace(
      /^\s*(?:tentu|baik(?:lah)?|berikut|saya siap|sure|certainly|here(?:'s| is)|of course)\b[^\n]*\n+(?=(?:---+|#{1,3}\s)\s*\n?)/i,
      ""
    )
    .replace(/^\s*---+\s*\n+/, "")
    .trim();
}

/* ---------- Provider 1: HaidarXD Claude Sonnet ---------- */
// API ini menerima parameter lewat query string DAN body JSON; apikey wajib di
// query (tanpa itu 401 "Parameter 'apikey' wajib disertakan"). Prompt panjang
// dikirim di body supaya tidak menabrak batas panjang URL.
async function haidarxd(prompt, instruction, timeoutMs) {
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
  }, timeoutMs);
  if (!res.ok) {
    // 502 dari gateway ini biasanya membungkus pesan kuota Anthropic ("You've reached
    // your plan quota"). Tanpa dibaca, log hanya berisi "haidarxd 502" dan orang
    // mengira endpoint-nya rusak padahal kreditnya yang habis.
    const body = await res.text().catch(() => "");
    if (/plan quota|credit|insufficient/i.test(body)) throw new Error("haidarxd kuota habis");
    throw new Error("haidarxd " + res.status);
  }
  const data = await res.json().catch(() => null);
  const text = cleanMarkdown(extractAiText(data));
  return assertUsable(text, "haidarxd");
}

/* ---------- Provider 2: Unliai ---------- */
async function unliai(prompt, instruction, timeoutMs) {
  const full = instruction ? instruction + "\n\n" + prompt : prompt;
  const res = await fetchWithTimeout(UNLIAI_URL + encodeURIComponent(full), undefined, timeoutMs);
  if (!res.ok) throw new Error("unliai " + res.status);
  const data = await res.json().catch(() => null);
  let text = data && data.result ? String(data.result.response || "").trim() : "";
  if (/tidak ada respon/i.test(text)) throw new Error("unliai kosong");
  return assertUsable(cleanMarkdown(text), "unliai");
}

/* ---------- Provider 3: MetaAI (llama-4-scout, andal untuk fallback) ---------- */
async function metaai(prompt, instruction, timeoutMs) {
  const full = instruction ? instruction + "\n\n" + prompt : prompt;
  const res = await fetchWithTimeout(METAAI_URL + encodeURIComponent(full), undefined, timeoutMs);
  if (!res.ok) throw new Error("metaai " + res.status);
  const data = await res.json().catch(() => null);
  const text = data && data.result ? String(data.result.response || "").trim() : "";
  return assertUsable(cleanMarkdown(text), "metaai");
}

/* ---------- Provider 4: Cici ---------- */
const CICI_URL = process.env.CICI_URL || "https://api.ikyyxd.my.id/ai/cici?prompt=";
// Satu-satunya provider gratis yang masih menjawab saat metaai 500 ("insufficient
// tokens") dan unliai menggantung. Batas praktisnya prompt pendek: pada ~5 KB dia
// balas 500 "timeout of 30000ms exceeded", jadi tempatkan setelah unliai.
async function cici(prompt, instruction, timeoutMs) {
  const full = instruction ? instruction + "\n\n" + prompt : prompt;
  const res = await fetchWithTimeout(CICI_URL + encodeURIComponent(full), undefined, timeoutMs);
  if (!res.ok) throw new Error("cici " + res.status);
  const data = await res.json().catch(() => null);
  const text = data && data.result ? String(data.result.reply || "").trim() : "";
  return assertUsable(cleanMarkdown(text), "cici");
}

/* ---------- Chain ---------- */
const PROVIDERS = [
  { name: "haidarxd", fn: haidarxd },
  { name: "unliai", fn: unliai },
  { name: "cici", fn: cici },
  { name: "metaai", fn: metaai }
];

async function generateText(prompt, instruction, opts) {
  // budgetMs = anggaran waktu total untuk SELURUH chain. Tanpa ini, empat provider
  // × AI_TIMEOUT_MS bisa melewati batas 60s Vercel Hobby dan function mati sebelum
  // sempat membalas apa pun (pemanggil kehilangan fallback-nya sendiri).
  const budgetMs = opts && opts.budgetMs > 0 ? opts.budgetMs : AI_CHAIN_BUDGET_MS;
  const started = Date.now();
  const errors = [];
  for (let i = 0; i < PROVIDERS.length; i++) {
    const provider = PROVIDERS[i];
    let perCall;
    if (budgetMs) {
      const left = budgetMs - (Date.now() - started);
      if (left < 5000) { errors.push(provider.name + ": waktu habis"); continue; }
      // Bagi sisa waktu rata ke provider yang belum dicoba. Tanpa pembagian ini satu
      // provider yang menggantung (unliai sering begitu) menghabiskan seluruh anggaran
      // dan provider sehat di belakangnya tidak pernah kebagian giliran.
      const share = left / (PROVIDERS.length - i);
      perCall = Math.min(AI_TIMEOUT_MS, Math.max(6000, share));
    }
    try {
      const text = await provider.fn(prompt, instruction, perCall);
      return { text, provider: provider.name };
    } catch (err) {
      errors.push(provider.name + ": " + err.message);
    }
  }
  throw new Error("Semua provider AI gagal (" + errors.join(" | ") + ")");
}

/* ---------- Assistant (chatbot) — MetaAI utama, lalu Cici, lalu Claude ---------- */

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
