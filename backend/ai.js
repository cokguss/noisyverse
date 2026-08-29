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

/* ---------- Provider 2: GarzAI (llama3.1-8b, SSE streaming) ----------
 * Endpoint gratis yang — beda dari unliai/cici — SANGGUP menerima prompt besar
 * (README/ringkasan HTML 3-6 KB, ukuran khas fitur reverse) tanpa menolak, patuh
 * pada instruksi ("Build me...", heading), dan balas ~1-2 detik. Karena claude
 * berbayar sering kehabisan kuota, ini fallback pertama yang paling andal saat ini.
 * Jawaban dialirkan sebagai Server-Sent Events: baris `data: {"content":"..."}`.
 */
const GARZAI_URL = process.env.GARZAI_URL || "https://garz-ai.vercel.app/api/chat";
const GARZAI_MODEL = process.env.GARZAI_MODEL || "llama3.1-8b";

async function garzai(prompt, instruction, timeoutMs) {
  const content = instruction
    ? String(instruction).trim() + "\n\n" + String(prompt).trim()
    : String(prompt).trim();
  // AbortController sendiri: timeout harus mencakup SELURUH pembacaan stream, bukan
  // hanya sampai header diterima (fetchWithTimeout membebaskan timer begitu fetch
  // resolve, jadi tak cocok untuk body streaming yang panjang).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || AI_TIMEOUT_MS);
  try {
    const res = await fetch(GARZAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36",
        "Origin": "https://garz-ai.vercel.app",
        "Referer": "https://garz-ai.vercel.app/",
      },
      body: JSON.stringify({ model: GARZAI_MODEL, messages: [{ role: "user", content }] }),
    });
    if (!res.ok) throw new Error("garzai " + res.status);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Baris terakhir bisa terpotong di tengah chunk — simpan untuk chunk berikutnya.
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const s = line.slice(6).trim();
        if (!s || s === "[DONE]") continue;
        try { const p = JSON.parse(s); if (p.content) full += p.content; } catch {}
      }
    }
    return assertUsable(cleanMarkdown(full.trim()), "garzai");
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Provider 3: Overchat (AxlyDev) ----------
 * Fallback kedua yang juga SANGGUP prompt besar (uji: PRD lengkap ~7 KB dibalas
 * utuh). Lebih lambat dari garzai (~7-25s), jadi ditempatkan setelahnya, tapi jadi
 * jaring pengaman penting untuk "perbaiki semua otomatis" yang mengirim seluruh
 * dokumen PRD — payload terbesar di aplikasi. Endpoint GET, balas {status, result}.
 */
const OVERCHAT_URL = process.env.OVERCHAT_URL || "https://axlyapi.qzz.io/ai/overchat?text=";

async function overchat(prompt, instruction, timeoutMs) {
  const full = instruction ? String(instruction).trim() + "\n\n" + String(prompt).trim() : String(prompt).trim();
  const res = await fetchWithTimeout(OVERCHAT_URL + encodeURIComponent(full), undefined, timeoutMs);
  if (!res.ok) throw new Error("overchat " + res.status);
  const data = await res.json().catch(() => null);
  const text = data && data.result ? String(data.result).trim() : "";
  return assertUsable(cleanMarkdown(text), "overchat");
}

/* ---------- Provider 4: Unliai ---------- */
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
// Urutan sengaja: claude berbayar dulu (kualitas terbaik) → garzai (fallback paling
// andal saat kredit claude habis: sanggup prompt besar, patuh instruksi, cepat) →
// overchat (juga sanggup prompt besar, lebih lambat) → unliai/cici/metaai (upaya
// terakhir; sering menolak/kehabisan kuota).
const PROVIDERS = [
  { name: "haidarxd", fn: haidarxd },
  { name: "garzai", fn: garzai },
  { name: "overchat", fn: overchat },
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

/* ---------- Assistant (chatbot) — GarzAI utama, lalu MetaAI, Cici, Claude ---------- */

async function assistant(prompt, context) {
  const full = context ? context + "\n\nPertanyaan admin: " + prompt : prompt;
  // Utama: GarzAI — paling andal saat ini (MetaAI sering 500 "insufficient tokens").
  try {
    const text = await garzai(prompt, context || "");
    if (text) return text;
  } catch (err) {
    // lanjut ke fallback
  }
  // Fallback 1: MetaAI (natural bila sedang punya kuota).
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
  // Fallback 2: Cici.
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
  // Fallback 3: Claude berbayar — chatbot jangan sampai mati total kalau provider
  // gratis di atas kehabisan kuota.
  return haidarxd(prompt, context || "");
}

module.exports = { generateText, extractAiText, cleanMarkdown, assistant };
