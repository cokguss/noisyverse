const AI_API_URL = process.env.AI_API_URL || "https://api.haidarxd.my.id/api/v1/ai/gpt55";
const AI_API_KEY = process.env.AI_API_KEY || "";
const UNLIAI_URL = process.env.UNLIAI_URL || "https://api.ikyyxd.my.id/ai/unliai?teks=";
const METAAI_URL = process.env.METAAI_URL || "https://api.ikyyxd.my.id/ai/metaai?prompt=";
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS, 10) || 90000;

async function fetchWithTimeout(url, opts, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || AI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...(opts || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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

/* ---------- Provider 1: HaidarXD GPT ---------- */
async function haidarxd(prompt, instruction) {
  const res = await fetchWithTimeout(AI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + AI_API_KEY,
      "x-api-key": AI_API_KEY
    },
    body: JSON.stringify({
      message: String(prompt).trim(),
      instruction: String(instruction || "").trim(),
      web_search: "false",
      conversation_id: "",
      parent_message_id: "",
      history: "[]"
    })
  });
  if (!res.ok) throw new Error("haidarxd " + res.status);
  const data = await res.json().catch(() => null);
  const text = cleanMarkdown(extractAiText(data));
  if (!text) throw new Error("haidarxd kosong");
  // Provider gratis menolak teks panjang untuk user anonim; jangan diteruskan sebagai hasil.
  if (/anonymous users have reached the limit|sign in to continue with long text|message is quite long/i.test(text)) {
    throw new Error("haidarxd limit teks panjang");
  }
  return text;
}

/* ---------- Provider 2: Unliai ---------- */
async function unliai(prompt, instruction) {
  const full = instruction ? instruction + "\n\n" + prompt : prompt;
  const res = await fetchWithTimeout(UNLIAI_URL + encodeURIComponent(full));
  if (!res.ok) throw new Error("unliai " + res.status);
  const data = await res.json().catch(() => null);
  let text = data && data.result ? String(data.result.response || "").trim() : "";
  if (!text || /tidak ada respon/i.test(text)) throw new Error("unliai kosong");
  return cleanMarkdown(text);
}

/* ---------- Provider 3: MetaAI (llama-4-scout, andal untuk fallback) ---------- */
async function metaai(prompt, instruction) {
  const full = instruction ? instruction + "\n\n" + prompt : prompt;
  const res = await fetchWithTimeout(METAAI_URL + encodeURIComponent(full));
  if (!res.ok) throw new Error("metaai " + res.status);
  const data = await res.json().catch(() => null);
  const text = data && data.result ? String(data.result.response || "").trim() : "";
  if (!text) throw new Error("metaai kosong");
  return cleanMarkdown(text);
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

/* ---------- Assistant (chatbot) — MetaAI utama, Cici sebagai fallback ---------- */
const CICI_URL = process.env.CICI_URL || "https://api.ikyyxd.my.id/ai/cici?prompt=";

async function assistant(prompt, context) {
  const full = context ? context + "\n\nPertanyaan admin: " + prompt : prompt;
  // Utama: MetaAI (andal & natural).
  try {
    const res = await fetchWithTimeout(METAAI_URL + encodeURIComponent(full));
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const text = data && data.result ? String(data.result.response || "").trim() : "";
      if (text) return text;
    }
  } catch (err) {
    // lanjut ke fallback
  }
  // Fallback: Cici.
  const res = await fetch(CICI_URL + encodeURIComponent(full));
  if (!res.ok) throw new Error("cici " + res.status);
  const data = await res.json().catch(() => null);
  const text = data && data.result ? String(data.result.reply || "").trim() : "";
  if (!text) throw new Error("cici kosong");
  return text;
}

module.exports = { generateText, extractAiText, cleanMarkdown, assistant };
