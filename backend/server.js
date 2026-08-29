const express = require("express");
const crypto = require("crypto");
const path = require("path");
const net = require("net");
const bot = require("./bot");
const ai = require("./ai");
const { loadStore, saveStore, seedStore, configured: storeConfigured } = require("./store");
const stats = require("./stats");
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "";
if (!ADMIN_KEY) {
  console.error("[server] ADMIN_KEY belum di-set — semua endpoint admin akan ditolak sampai env ini diisi.");
}
const GITREVERSE_WEBSITE_API = process.env.GITREVERSE_WEBSITE_API || "https://www.gitreverse.com/api/reverse-website";
const GITREVERSE_REPO_API = process.env.GITREVERSE_REPO_API || "https://www.gitreverse.com/api/reverse-prompt";
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

const app = express();
app.use((req, res, next) => {
  const hostHeader = req.headers.host || "";
  const hostname = hostHeader.split(":")[0];
  const port = hostHeader.split(":")[1] || PORT;
  if (hostname === "127.0.0.1") {
    return res.redirect(307, "http://localhost:" + port + req.originalUrl);
  }
  next();
});
app.use(async (req, res, next) => {
  try {
    const cfg = await loadConfig();
    if (!cfg.maintenance) return next();
  } catch { return next(); }
  if (req.path.startsWith("/admin") || req.path.startsWith("/api/admin") || req.path.startsWith("/api/auth") || req.path === "/api/health") return next();
  if (req.path.startsWith("/api/")) {
    return res.status(503).json({ ok: false, error: "Website sedang maintenance. Coba lagi nanti." });
  }
  res.status(503).send(`<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maintenance — Noisy Verse</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a12;color:#eceaf6;font-family:"DM Sans",sans-serif;text-align:center;padding:24px}h1{font-family:"Space Grotesk",sans-serif;font-size:28px;margin:0 0 10px}p{color:#9b97ad;max-width:40ch;margin:0 auto 20px}span{color:#a78bfa}</style></head><body><div><h1>🛠 <span>Noisy Verse</span> sedang maintenance</h1><p>Kami sedang melakukan pembaruan singkat. Silakan kembali beberapa menit lagi.</p></div></body></html>`);
});
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..")));

const DEFAULT_PACKAGES = [
  {
    id: "gratis",
    name: "Gratis",
    tagline: "Coba dulu rasanya",
    priceOld: null,
    price: "Rp0",
    durationDays: 0,
    reverseQuota: 1,
    prdQuota: 1,
    benefits: ["1x reverse website / repo", "1x generate PRD AI (salin teks)", "Lihat design system hasil scraping"],
    featured: false,
    active: true,
    purchasable: false
  },
  {
    id: "premium",
    name: "Premium",
    tagline: "Paling laris untuk kreator serius",
    priceOld: "Rp50rb",
    price: "Rp40rb",
    durationDays: 30,
    reverseQuota: 50,
    prdQuota: 10,
    benefits: ["50x reverse website / repo", "10x generate PRD AI", "Unduh PRD.md langsung", "Design system disertakan", "Prioritas antrian scraping"],
    featured: true,
    active: true,
    purchasable: true
  },
  {
    id: "unlimited",
    name: "Unlimited",
    tagline: "Untuk yang hidup dari editing",
    priceOld: "Rp100rb",
    price: "Rp80rb",
    durationDays: 30,
    reverseQuota: null,
    prdQuota: 30,
    benefits: ["Reverse tanpa batas", "30x generate PRD AI", "Unduh PRD.md langsung", "Semua fitur premium", "Support prioritas 24/7", "Update fitur gratis selamanya"],
    featured: false,
    active: true,
    purchasable: true
  }
];

const DEFAULT_PAYMENTS = [
  { id: "qris", type: "qris", name: "QRIS", accountName: "Noisy Verse", accountNumber: "", imageUrl: "", active: true },
  { id: "bca", type: "bank", name: "BCA", accountName: "Noisy Verse", accountNumber: "1234567890", active: true },
  { id: "dana", type: "ewallet", name: "DANA", accountName: "Noisy Verse", accountNumber: "0812-3456-7890", active: true }
];

// Seed default idempoten (hanya menulis bila key belum ada di Supabase).
async function seedDefaults() {
  await Promise.all([
    seedStore("packages", DEFAULT_PACKAGES),
    seedStore("announcements", []),
    seedStore("config", { maintenance: false }),
    seedStore("projects", []),
    seedStore("coupons", []),
    seedStore("visitors", { total: 0, visitors: {} }),
    seedStore("payments", DEFAULT_PAYMENTS),
    seedStore("orders", []),
    seedStore("users", []),
    seedStore("sessions", {}),
  ]);
}

async function loadPackages() {
  const list = await loadStore("packages", DEFAULT_PACKAGES);
  return Array.isArray(list) && list.length ? list : DEFAULT_PACKAGES;
}
async function savePackages(list) { return saveStore("packages", list); }
async function loadAnnouncements() { return loadStore("announcements", []); }
async function saveAnnouncements(list) { return saveStore("announcements", list); }
/**
 * `config` dibaca oleh middleware maintenance pada SETIAP request /api/*, jadi
 * satu roundtrip Supabase menempel di semua endpoint. Cache pendek in-memory
 * menghapus biaya itu; saveConfig() membatalkan cache sehingga toggle
 * maintenance dari panel admin tetap langsung terasa pada invocation ini.
 */
const CONFIG_TTL_MS = 10 * 1000;
let configCache = null;
let configCacheAt = 0;

async function loadConfig() {
  const now = Date.now();
  if (configCache && now - configCacheAt < CONFIG_TTL_MS) return configCache;
  const cfg = await loadStore("config", { maintenance: false });
  configCache = cfg;
  configCacheAt = now;
  return cfg;
}
async function saveConfig(cfg) {
  configCache = cfg;
  configCacheAt = Date.now();
  return saveStore("config", cfg);
}

async function getPackageById(id) {
  return (await loadPackages()).find((p) => p.id === id) || null;
}

async function loadProjects() { return loadStore("projects", []); }
async function saveProjects(list) { return saveStore("projects", list); }
async function loadPayments() { return loadStore("payments", DEFAULT_PAYMENTS); }
async function savePayments(list) { return saveStore("payments", list); }

async function loadCoupons() { return loadStore("coupons", []); }
async function saveCoupons(list) { return saveStore("coupons", list); }

/* ---------- Kupon: parsing harga & perhitungan diskon ---------- */
// "Rp40rb" -> 40000, "Rp1,2jt" -> 1200000, "Rp32.000" -> 32000
function parseRupiah(str) {
  let s = String(str == null ? "" : str).toLowerCase().replace(/rp/g, "").replace(/\s+/g, "").trim();
  if (!s || s === "gratis" || s === "0") return 0;
  let mult = 1;
  if (/jt|juta/.test(s)) { mult = 1000000; s = s.replace(/jt|juta/g, ""); }
  else if (/rb|ribu|k$/.test(s)) { mult = 1000; s = s.replace(/rb|ribu|k/g, ""); }
  // Konvensi Indonesia: koma = desimal, titik = pemisah ribuan.
  s = s.replace(/,/g, ".");
  // Tanpa sufiks (rb/jt), titik adalah pemisah ribuan -> buang. Dengan sufiks, titik = desimal (mis. 1.2jt).
  if (mult === 1) s = s.replace(/\./g, "");
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return Math.round(n * mult);
}
function formatRupiah(n) {
  return "Rp" + Math.max(0, Math.round(n)).toLocaleString("id-ID");
}
function computeDiscount(coupon, priceStr) {
  const originalPrice = parseRupiah(priceStr);
  let finalPrice = originalPrice;
  if (coupon.type === "percent") {
    const pct = Math.min(100, Math.max(0, Number(coupon.value) || 0));
    finalPrice = originalPrice - Math.round(originalPrice * pct / 100);
  } else {
    finalPrice = originalPrice - (Number(coupon.value) || 0);
  }
  finalPrice = Math.max(0, finalPrice);
  const discountLabel = coupon.type === "percent"
    ? "−" + (Number(coupon.value) || 0) + "%"
    : "−" + formatRupiah(Number(coupon.value) || 0);
  return { originalPrice, finalPrice, finalLabel: formatRupiah(finalPrice), discountLabel };
}
// Validasi kupon terhadap sebuah paket. Mengembalikan { ok, coupon?, error?, ...discount }.
async function validateCoupon(code, packageId) {
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) return { ok: false, error: "Kode kupon kosong." };
  const coupon = (await loadCoupons()).find((c) => c.code === clean);
  if (!coupon || coupon.active === false) return { ok: false, error: "Kode kupon tidak valid / sudah tidak berlaku." };
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= new Date()) {
    return { ok: false, error: "Kupon sudah kedaluwarsa." };
  }
  if (coupon.maxUses && coupon.maxUses > 0 && (coupon.usedCount || 0) >= coupon.maxUses) {
    return { ok: false, error: "Kuota pemakaian kupon sudah habis." };
  }
  if (coupon.packageId && coupon.packageId !== packageId) {
    return { ok: false, error: "Kupon ini tidak berlaku untuk paket yang dipilih." };
  }
  const pkg = await getPackageById(packageId);
  if (!pkg) return { ok: false, error: "Paket tidak ditemukan." };
  const disc = computeDiscount(coupon, pkg.price);
  return { ok: true, coupon, packageId, packageName: pkg.name, ...disc };
}
// Tandai satu pemakaian kupon (dipanggil saat order selesai). Idempotent lewat guard pemanggil.
async function redeemCoupon(code) {
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) return;
  const list = await loadCoupons();
  const c = list.find((x) => x.code === clean);
  if (!c) return;
  c.usedCount = (c.usedCount || 0) + 1;
  await saveCoupons(list);
}


// Statistik pengunjung kini ditangani backend/stats.js (tabel site_stats +
// visitor_hits, realtime). Key kv_store "visitors" hanya dipakai stats.js
// sebagai fallback bila skema statistik belum dijalankan.

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Sesi disimpan di Supabase sebagai satu blob { token: { userId, ts } }.
async function loadSessions() { return loadStore("sessions", {}); }
async function saveSessions(map) { return saveStore("sessions", map); }

async function addSession(token, userId) {
  const map = await loadSessions();
  map[token] = { userId, ts: Date.now() };
  await saveSessions(map);
}

async function removeSession(token) {
  if (!token) return;
  const map = await loadSessions();
  if (map[token]) { delete map[token]; await saveSessions(map); }
}

async function removeSessionsForUser(userId) {
  const map = await loadSessions();
  let changed = false;
  for (const [token, entry] of Object.entries(map)) {
    if (entry.userId === userId) { delete map[token]; changed = true; }
  }
  if (changed) await saveSessions(map);
}

/* ---------- helpers ---------- */

function extractSlug(targetUrl) {
  const { hostname, pathname } = new URL(targetUrl);
  const cleanPath = pathname.replace(/\/+$/, "");
  return (hostname + cleanPath)
    .replace(/^www\./, "")
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw httpError(400, "URL tidak valid.");
  }
  if (!/^https?:$/.test(url.protocol)) throw httpError(400, "Hanya http/https yang diizinkan.");

  const host = url.hostname;
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw httpError(400, "Alamat IP privat tidak diizinkan.");
    return raw;
  }
  const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"];
  if (blocked.includes(host.toLowerCase())) throw httpError(400, "Host tidak diizinkan.");
  if (host.endsWith(".local") || host.endsWith(".internal")) throw httpError(400, "Host tidak diizinkan.");
  return raw;
}

function isPrivateIp(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return true;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cleanRepoUrl(raw) {
  return String(raw)
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

const REVERSE_UPSTREAM_TIMEOUT_MS = parseInt(process.env.REVERSE_TIMEOUT_MS, 10) || 22000;
// Anggaran waktu untuk chain AI di dalam reverse. Jalur AI sekarang jalan PERTAMA,
// dan kalau gagal masih ada GitReverse (≤22s) setelahnya. Hitung kasus terburuk
// website: fetch halaman 15s + AI 14s + GitReverse 22s = 51s, masih di bawah batas
// 60s function Vercel Hobby. Menaikkan angka ini bisa membuat function dibunuh
// sebelum fallback selesai, dan pengguna tidak dapat hasil apa pun.
const REVERSE_AI_BUDGET_MS = parseInt(process.env.REVERSE_AI_BUDGET_MS, 10) || 14000;

async function fetchWithTimeout(url, opts, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || REVERSE_UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...(opts || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Reverse via GitReverse (upstream, dipakai jika sedang sehat) ---------- */
async function websiteViaGitReverse(targetUrl) {
  const siteSlug = extractSlug(targetUrl);
  const res = await fetchWithTimeout(GITREVERSE_WEBSITE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteSlug, targetUrl, stream: false }),
  });
  if (!res.ok) throw new Error("gitreverse " + res.status);
  const raw = await res.text();
  let data = null;
  try { data = JSON.parse(raw); } catch {}
  if (!data) {
    const lines = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.replace(/^data:\s*/, ""));
    for (const s of lines) {
      try { const p = JSON.parse(s); if (p && p.prompt) { data = p; break; } } catch {}
    }
  }
  if (!data || data.error || !data.prompt) throw new Error(data && data.error ? data.error : "no prompt");
  return { prompt: data.prompt, designPath: data.designPath || null, fromCache: data.fromCache ?? false, source: "gitreverse" };
}

async function repoViaGitReverse(clean) {
  const res = await fetchWithTimeout(GITREVERSE_REPO_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl: clean }),
  });
  if (!res.ok) throw new Error("gitreverse " + res.status);
  const data = await res.json().catch(() => null);
  if (!data || data.error || !data.prompt) throw new Error(data && data.error ? data.error : "no prompt");
  return { prompt: data.prompt, repo: clean, source: "gitreverse" };
}
/* ---------- Reverse via AI sendiri (fallback saat GitReverse error/down) ---------- */
function summarizeHtml(html, targetUrl) {
  const pick = (re) => { const m = html.match(re); return m ? m[1].trim() : ""; };
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i).replace(/\s+/g, " ");
  const desc =
    pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const ogDesc = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const heads = [];
  const hre = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let hm;
  while ((hm = hre.exec(html)) && heads.length < 30) {
    const t = hm[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (t) heads.push(t);
  }
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (body.length > 3500) body = body.slice(0, 3500);
  return [
    "URL: " + targetUrl,
    title && "Title: " + title,
    ogTitle && ogTitle !== title && "OG Title: " + ogTitle,
    desc && "Description: " + desc,
    ogDesc && ogDesc !== desc && "OG Description: " + ogDesc,
    heads.length && "Headings:\n- " + heads.join("\n- "),
    body && "Visible text (excerpt):\n" + body,
  ].filter(Boolean).join("\n\n");
}
async function websiteViaAI(targetUrl) {
  let res;
  try {
    res = await fetchWithTimeout(targetUrl, {
      headers: {
        // UA browser desktop asli — banyak situs memblokir UA non-browser (403).
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
      redirect: "follow",
    }, 15000);
  } catch {
    throw httpError(502, "Tidak bisa mengakses website itu (mungkin sedang down atau memblokir akses).");
  }
  if (res.status === 403 || res.status === 401) {
    throw httpError(502, "Website itu memblokir akses otomatis — coba website lain.");
  }
  if (!res.ok) throw httpError(502, "Website itu merespons " + res.status + ".");
  const html = await res.text();
  const summary = summarizeHtml(html, targetUrl);
  const instruction =
    "You are a senior product designer. Based on this real website's content and metadata, write ONE detailed, first-person build prompt in English that an AI website builder could use to recreate a site with the same purpose, structure, tone, and visual vibe. " +
    "Start with \"Build me\". Cover: the product and its purpose, the target audience, the overall aesthetic (colors, typography, mood), the hero section, the main page sections in order, key components, and notable interactions. " +
    "Write flowing prose across 4-8 paragraphs. Do NOT use markdown headings, code blocks, or bullet lists, and do NOT mention metadata, analysis, or that this was reverse-engineered.";
  const { text } = await ai.generateText(summary, instruction, { budgetMs: REVERSE_AI_BUDGET_MS });
  if (!text || !text.trim()) throw httpError(502, "Gagal membuat prompt dari website itu. Coba lagi.");
  return { prompt: text.trim(), designPath: null, fromCache: false, source: "ai" };
}
async function repoViaAI(clean) {
  const ghFetch = (suffix, accept) =>
    fetchWithTimeout("https://api.github.com/repos/" + clean + suffix, {
      headers: {
        "Accept": accept || "application/vnd.github+json",
        "User-Agent": "NoisyVerseBot",
        ...(process.env.GITHUB_TOKEN ? { Authorization: "Bearer " + process.env.GITHUB_TOKEN } : {}),
      },
    }, 20000);

  let meta = {};
  try {
    const r = await ghFetch("");
    if (r.status === 404) throw httpError(404, "Repo tidak ditemukan atau bersifat privat.");
    if (r.status === 403) throw httpError(502, "Batas akses GitHub tercapai, coba lagi sebentar lagi.");
    if (r.ok) meta = await r.json();
  } catch (e) { if (e && e.status) throw e; }

  let readme = "";
  try { const r = await ghFetch("/readme", "application/vnd.github.raw+json"); if (r.ok) readme = await r.text(); } catch {}
  let langs = "";
  try { const r = await ghFetch("/languages"); if (r.ok) langs = Object.keys(await r.json()).join(", "); } catch {}
  if (readme.length > 5000) readme = readme.slice(0, 5000);

  const summary = [
    "Repo: " + clean,
    meta.description && "Description: " + meta.description,
    langs && "Languages: " + langs,
    meta.topics && meta.topics.length && "Topics: " + meta.topics.join(", "),
    meta.homepage && "Homepage: " + meta.homepage,
    readme && "README (excerpt):\n" + readme,
  ].filter(Boolean).join("\n\n");
  if (summary.trim() === "Repo: " + clean) throw httpError(502, "Tidak ada info yang bisa diambil dari repo itu.");

  const instruction =
    "You are a senior software engineer. Based on this real GitHub repository's metadata and README, write ONE detailed, first-person build prompt in English that an AI coding tool could use to recreate a project with the same purpose and capabilities. " +
    "Start with \"Build me\". Cover: what the project does, who it's for, the core features and how they work, the tech approach, and the expected behavior. " +
    "Write clear flowing prose across 3-6 paragraphs. Do NOT copy the README verbatim, do NOT use markdown headings or code blocks, and do NOT mention that this came from a README or analysis.";
  const { text } = await ai.generateText(summary, instruction, { budgetMs: REVERSE_AI_BUDGET_MS });
  if (!text || !text.trim()) throw httpError(502, "Gagal membuat prompt dari repo itu. Coba lagi.");
  return { prompt: text.trim(), repo: clean, source: "ai" };
}
/* ---------- Orkestrasi: AI sendiri dulu, GitReverse sebagai jaring pengaman ----------
 * Urutan ini sengaja dibalik: dulu GitReverse dicoba lebih dulu, jadi hasil reverse
 * praktis selalu datang dari upstream pihak ketiga dan model berbayar (claude-sonnet-5,
 * lihat backend/ai.js) tidak pernah terpakai — padahal itu yang dipakai fitur PRD dan
 * hasilnya jauh lebih detail. GitReverse tetap dipertahankan sebagai fallback supaya
 * fitur tidak mati total kalau semua provider AI habis kuota.
 */
async function websiteToPrompt(targetUrl) {
  try {
    return await websiteViaAI(targetUrl);
  } catch (e) {
    console.warn("[reverse] AI website gagal, pakai GitReverse:", e.message);
    try {
      return await websiteViaGitReverse(targetUrl);
    } catch (e2) {
      console.warn("[reverse] GitReverse website juga gagal:", e2.message);
      // Error dari jalur AI lebih informatif untuk pengguna (403/down/blokir),
      // jadi itulah yang dilempar, bukan "gitreverse 500".
      throw e;
    }
  }
}

async function repoToPrompt(repoUrl) {
  const clean = cleanRepoUrl(repoUrl);
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(clean)) {
    throw httpError(400, "Format repo harus owner/repo atau URL GitHub yang valid.");
  }
  try {
    return await repoViaAI(clean);
  } catch (e) {
    // Repo tidak ada / privat: itu keputusan final, jangan buang waktu ke upstream.
    if (e && e.status === 404) throw e;
    console.warn("[reverse] AI repo gagal, pakai GitReverse:", e.message);
    try {
      return await repoViaGitReverse(clean);
    } catch (e2) {
      console.warn("[reverse] GitReverse repo juga gagal:", e2.message);
      throw e;
    }
  }
}

/* ---------- auth ---------- */

async function loadUsers() { return loadStore("users", []); }

async function saveUsers(users) { return saveStore("users", users); }

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString("hex");
}

function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${hashPassword(password, salt)}`;
}

function verifyPassword(password, record) {
  const [salt, hash] = String(record).split(":");
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt);
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  });
  return out;
}

async function currentUser(req) {
  const token = parseCookies(req).nv_session;
  if (!token) return null;
  // Dua blob ini saling bebas, jadi ambil bersamaan. Dulu berurutan: sesi dulu,
  // baru user — dua roundtrip Supabase menempel di setiap request yang butuh
  // login (termasuk /api/auth/me yang dipanggil saat tiap halaman dibuka).
  const [sessionMap, users] = await Promise.all([loadSessions(), loadUsers()]);
  const entry = sessionMap[token];
  if (!entry) return null;
  if (Date.now() - entry.ts >= SESSION_TTL_MS) return null;
  return users.find((u) => u.id === entry.userId) || null;
}

async function setSession(res, userId) {
  const token = crypto.randomBytes(24).toString("hex");
  await addSession(token, userId);
  res.setHeader("Set-Cookie", `nv_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
}

function hasActivePackage(user) {
  const p = user.package;
  return Boolean(p && p.expiresAt && new Date(p.expiresAt) > new Date());
}

function isDeveloper(user) {
  return user.dev === true || user.username === "noisy02";
}

const LEGACY_PACKAGE_ALIAS = { hemat: "premium", coba: "gratis" };

async function normalizePackageId(packageType) {
  const id = LEGACY_PACKAGE_ALIAS[packageType] || packageType;
  return (await getPackageById(id)) ? id : null;
}

async function activatePackage(username, packageType, durationDays) {
  const users = await loadUsers();
  const user = users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user) return null;
  const pkgId = (await normalizePackageId(packageType)) || "premium";
  const pkg = await getPackageById(pkgId);
  const days = parseInt(durationDays, 10) || pkg.durationDays || 30;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  user.package = { type: pkgId, expiresAt };
  user.prdQuota = (user.prdQuota === undefined ? 1 : user.prdQuota) + (pkg.prdQuota || 0);
  user.reverseQuota = pkg.reverseQuota === null
    ? 999999
    : ((user.reverseQuota === undefined ? 1 : user.reverseQuota) + pkg.reverseQuota);
  await saveUsers(users);
  return {
    username: user.username,
    package: user.package,
    prdQuota: user.prdQuota,
    prdUsed: user.prdUsed || 0,
    reverseQuota: user.reverseQuota,
    reverseUsed: user.reverseUsed || 0
  };
}

function publicUser(user) {
  const dev = isDeveloper(user);
  const pkg = user.package;
  return {
    id: user.id,
    username: user.username,
    prdUsed: user.prdUsed || 0,
    prdQuota: dev ? 999999 : (user.prdQuota === undefined ? 1 : user.prdQuota),
    reverseUsed: user.reverseUsed || 0,
    reverseQuota: dev ? 999999 : (user.reverseQuota === undefined ? 1 : user.reverseQuota),
    unlimited: dev,
    dev,
    package: pkg || null,
    packageActive: hasActivePackage(user),
    packageExpiresAt: pkg ? pkg.expiresAt : null,
    packageType: pkg ? pkg.type : null,
    createdAt: user.createdAt,
  };
}

/* ---------- orders ---------- */

async function loadOrders() { return loadStore("orders", []); }

async function saveOrders(orders) { return saveStore("orders", orders); }

function newOrderCode() {
  return "NV-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

/* ---------- middleware ---------- */

const rateBuckets = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    return next();
  }
  bucket.count++;
  if (bucket.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ ok: false, error: "Terlalu banyak permintaan. Coba lagi sebentar." });
  }
  next();
}

function requireAdmin(req, res, next) {
  const key = req.get("X-Admin-Key");
  if (!ADMIN_KEY || key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: "Admin key tidak valid." });
  next();
}

/* ---------- routes ---------- */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "noisy-verse",
    // `store: false` = SUPABASE_URL/SUPABASE_SERVICE_KEY belum di-set di env,
    // jadi tidak ada data yang tersimpan. Berguna untuk cek cepat pasca-deploy.
    store: storeConfigured,
    time: new Date().toISOString()
  });
});

app.get("/api/config", async (req, res) => {
  let maintenance = false;
  try { maintenance = (await loadConfig()).maintenance === true; } catch {}
  // Di mode webhook tidak ada start() yang meng-cache username bot, jadi
  // resolve sekarang (sekali per cold start) — kalau null, halaman bayar
  // menyembunyikan tombol "konfirmasi ke bot" dan pengguna kehilangan jalur bayar.
  let botUsername = null;
  try { botUsername = await bot.resolveBotUsername(); } catch {}
  res.json({
    ok: true,
    botUsername,
    botActive: bot.botConfigured(),
    maintenance
  });
});

app.post("/api/ai/prd", rateLimit, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) {
      throw Object.assign(httpError(401, "Login dulu untuk generate PRD."), { code: "NEED_LOGIN" });
    }
    const isDev = isDeveloper(user);
    const used = user.prdUsed || 0;
    const quota = user.prdQuota === undefined ? 1 : user.prdQuota;
    if (!isDev && used >= quota) {
      throw Object.assign(
        httpError(403, "Kuota PRD kamu sudah habis (" + used + "/" + quota + "). Beli paket di halaman harga untuk tambah kuota."),
        { code: "PRD_QUOTA_USED" }
      );
    }

    const { prompt, instruction } = req.body || {};
    if (!prompt || !String(prompt).trim()) throw httpError(400, "Field 'prompt' wajib diisi.");

    const { text, provider } = await ai.generateText(String(prompt).trim(), String(instruction || "").trim());

    if (!isDev) {
      const users = await loadUsers();
      const fresh = users.find((u) => u.id === user.id);
      if (fresh) {
        fresh.prdUsed = (fresh.prdUsed || 0) + 1;
        await saveUsers(users);
      }
      // Siarkan counter baru ke klien realtime.
      await bumpStats();
    }

    const freshUser = (await loadUsers()).find((u) => u.id === user.id);
    res.json({
      ok: true,
      text,
      source: provider,
      prdUsed: isDev ? 0 : ((freshUser && freshUser.prdUsed) || used + 1),
      prdQuota: isDev ? 999999 : quota
    });
  } catch (err) {
    next(err);
  }
});

/* Normalisasi pertanyaan klarifikasi ke bentuk {q, options[]}.
   Menerima string lama ("pertanyaan") maupun objek baru {q, options}. */
function normalizeClarifyQuestions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      if (typeof item === "string") {
        const q = item.trim();
        return q ? { q, options: [] } : null;
      }
      if (item && typeof item === "object") {
        const q = String(item.q || item.question || "").trim();
        if (!q) return null;
        const options = Array.isArray(item.options)
          ? item.options.map((o) => String(o || "").trim()).filter(Boolean).slice(0, 5)
          : [];
        return { q, options };
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, 4);
}

/* Klarifikasi PRD: AI boleh balik bertanya bila brief kurang jelas. Tidak memotong kuota. */
app.post("/api/ai/prd-clarify", rateLimit, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) {
      throw Object.assign(httpError(401, "Login dulu untuk generate PRD."), { code: "NEED_LOGIN" });
    }
    const isDev = isDeveloper(user);
    const used = user.prdUsed || 0;
    const quota = user.prdQuota === undefined ? 1 : user.prdQuota;
    if (!isDev && used >= quota) {
      throw Object.assign(
        httpError(403, "Kuota PRD kamu sudah habis (" + used + "/" + quota + "). Beli paket di halaman harga untuk tambah kuota."),
        { code: "PRD_QUOTA_USED" }
      );
    }

    const { brief, lang } = req.body || {};
    if (!brief || !String(brief).trim()) throw httpError(400, "Field 'brief' wajib diisi.");

    const langName = lang === "en" ? "English" : "Bahasa Indonesia";
    const instruction =
      "Kamu senior product manager. Nilai apakah brief produk berikut sudah cukup detail untuk membuat PRD yang bagus. " +
      "Jika masih ada hal penting yang ambigu/kurang (mis. target user, masalah inti, fitur wajib, platform, monetisasi), " +
      "ajukan MAKSIMAL 4 pertanyaan klarifikasi singkat dan spesifik dalam " + langName + ". " +
      "Untuk SETIAP pertanyaan, sertakan 2-4 pilihan jawaban umum yang masuk akal supaya user tinggal memilih (user tetap bisa menulis jawaban sendiri). " +
      "Balas HANYA dengan JSON valid tanpa teks lain, format persis: " +
      '{"needMoreInfo": true/false, "questions": [{"q": "pertanyaan", "options": ["pilihan jawaban 1", "pilihan jawaban 2"]}]}. ' +
      "Jika brief sudah cukup, kembalikan {\"needMoreInfo\": false, \"questions\": []}.";

    let needMoreInfo = false;
    let questions = [];
    try {
      const { text } = await ai.generateText(String(brief).trim(), instruction);
      const match = String(text).match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed && parsed.needMoreInfo && Array.isArray(parsed.questions)) {
          questions = normalizeClarifyQuestions(parsed.questions);
          needMoreInfo = questions.length > 0;
        }
      }
    } catch (err) {
      // Degradasi anggun: kalau AI gagal/parse gagal, lanjut buat PRD tanpa klarifikasi.
      needMoreInfo = false;
      questions = [];
    }

    res.json({ ok: true, needMoreInfo, questions });
  } catch (err) {
    next(err);
  }
});

/* Analisa kelemahan PRD: AI menandai bagian yang kurang/lemah. Tidak memotong kuota. */
app.post("/api/ai/prd-audit", rateLimit, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) {
      throw Object.assign(httpError(401, "Login dulu untuk memakai fitur ini."), { code: "NEED_LOGIN" });
    }
    const { prd, lang } = req.body || {};
    if (!prd || !String(prd).trim()) throw httpError(400, "Field 'prd' wajib diisi.");

    const langName = lang === "en" ? "English" : "Bahasa Indonesia";
    const instruction =
      "Kamu senior product manager. Tinjau PRD (markdown) berikut secara kritis dan temukan bagian yang lemah, kurang detail, ambigu, atau tidak lengkap. " +
      "Tulis dalam " + langName + ". Balas HANYA dengan JSON valid tanpa teks lain, format persis: " +
      '{"issues": [{"section": "nama bagian PRD", "issue": "apa yang kurang", "suggestion": "saran perbaikan singkat", "severity": "tinggi|sedang|rendah"}]}. ' +
      "Maksimal 8 issue, urut dari yang paling penting. Kalau PRD sudah sangat baik, kembalikan {\"issues\": []}.";

    let issues = [];
    try {
      const { text } = await ai.generateText(String(prd).trim(), instruction);
      const match = String(text).match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed && Array.isArray(parsed.issues)) {
          issues = parsed.issues
            .filter((it) => it && typeof it.issue === "string" && it.issue.trim())
            .slice(0, 8)
            .map((it) => ({
              section: String(it.section || "").trim(),
              issue: String(it.issue || "").trim(),
              suggestion: String(it.suggestion || "").trim(),
              severity: ["tinggi", "sedang", "rendah"].includes(it.severity) ? it.severity : "sedang",
            }));
        }
      }
    } catch (err) {
      issues = [];
    }

    res.json({ ok: true, issues });
  } catch (err) {
    next(err);
  }
});

/* Sempurnakan PRD: AI merevisi PRD, atau balik bertanya bila ambigu. Tidak memotong kuota. */
app.post("/api/ai/prd-refine", rateLimit, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) {
      throw Object.assign(httpError(401, "Login dulu untuk memakai fitur ini."), { code: "NEED_LOGIN" });
    }
    const { prd, feedback, section, mode, answers, lang } = req.body || {};
    if (!prd || !String(prd).trim()) throw httpError(400, "Field 'prd' wajib diisi.");

    const langName = lang === "en" ? "English" : "Bahasa Indonesia";
    const isAuto = mode === "auto";

    const parts = [];
    parts.push("PRD saat ini (raw markdown):");
    parts.push("");
    parts.push(String(prd).trim());
    parts.push("");
    if (isAuto) {
      parts.push("Tugas: temukan sendiri bagian yang paling lemah/kurang lengkap lalu perbaiki & lengkapi.");
    } else {
      if (section && String(section).trim()) parts.push("Fokus pada bagian: " + String(section).trim());
      if (feedback && String(feedback).trim()) parts.push("Masukan/keluhan dari user: " + String(feedback).trim());
    }
    if (Array.isArray(answers) && answers.length) {
      parts.push("Jawaban klarifikasi dari user:");
      answers.forEach((qa) => {
        if (qa && qa.q && qa.a) parts.push("- " + qa.q + " → " + qa.a);
      });
    }

    const instruction =
      "Kamu senior product manager & software architect. Perbaiki dan sempurnakan PRD di atas sesuai arahan. " +
      "Tulis SELURUH dokumen dalam " + langName + ". Pertahankan seluruh struktur & section yang sudah ada (jangan menghapus/memotong bagian), tingkatkan yang kurang. " +
      "PENTING: jika arahan user ambigu atau kamu butuh info tambahan untuk memperbaiki dengan benar, JANGAN mengarang. " +
      "Balas HANYA dengan JSON valid: {\"needMoreInfo\": true, \"questions\": [{\"q\": \"pertanyaan\", \"options\": [\"pilihan jawaban 1\", \"pilihan jawaban 2\"]}]} (maksimal 4 pertanyaan singkat dalam " + langName + ", tiap pertanyaan sertakan 2-4 pilihan jawaban umum). " +
      "Kalau sudah cukup jelas, keluarkan PRD LENGKAP hasil revisi sebagai raw Markdown SAJA (tanpa penjelasan sebelum/sesudah, tanpa membungkus dengan ``` ).";

    const { text } = await ai.generateText(parts.join("\n"), instruction);
    const trimmed = String(text || "").trim();
    if (!trimmed) throw httpError(502, "AI tidak merespons. Coba lagi sebentar lagi.");

    // Deteksi pertanyaan balik (JSON needMoreInfo). Kalau bukan, anggap markdown PRD.
    const jsonMatch = trimmed.match(/^\s*\{[\s\S]*"needMoreInfo"[\s\S]*\}\s*$/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed && parsed.needMoreInfo && Array.isArray(parsed.questions)) {
          const questions = normalizeClarifyQuestions(parsed.questions);
          if (questions.length) {
            return res.json({ ok: true, needMoreInfo: true, questions });
          }
        }
      } catch (err) {
        // Bukan JSON valid -> perlakukan sebagai markdown.
      }
    }

    res.json({ ok: true, needMoreInfo: false, text: trimmed });
  } catch (err) {
    next(err);
  }
});

// Ekstraksi task dari PRD (fallback bila klien tak mengirim task list). Logika
// harus SAMA dengan extractTasksClient di js/prd.js: heading ##/###, judul section
// beragam, plus fallback berjenjang supaya selalu menghasilkan ≥1 task dan
// POST /api/projects tak pernah menolak "Tidak ada task".
function extractTasksFromPrd(prd) {
  const lines = String(prd || "").split("\n");
  const SECTION_RE = /fitur|user stor|milestone|task|features|stories|fungsional|functional|requirement|kebutuhan|ruang lingkup|scope|mvp|roadmap|fase|phase|deliverable|modul|module|epic|cakupan/i;
  const HEADING_RE = /^(#{2,3})\s+(.+)$/;
  const BOILERPLATE_RE = /ringkasan|latar belakang|overview|tujuan|metrik|kpi|risiko|referensi|glossary|kesimpulan|pendahuluan|daftar isi|appendix|lampiran/i;
  const clean = (s) => s.replace(/\*\*/g, "").replace(/^[#\s]+/, "").replace(/[:：]\s*$/, "").trim();
  const bulletTitle = (line) => {
    const m = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
    return m ? clean(m[1]) : null;
  };

  const tasks = [];
  let inSection = false;
  for (const line of lines) {
    const h = line.match(HEADING_RE);
    if (h) { inSection = SECTION_RE.test(h[2]); continue; }
    if (!inSection) continue;
    const t = bulletTitle(line);
    if (t && t.length > 3 && tasks.length < 15) tasks.push(t);
  }
  if (tasks.length) return tasks;

  const headings = [];
  for (const line of lines) {
    const h = line.match(HEADING_RE);
    if (!h) continue;
    const title = clean(h[2]).replace(/^\d+[.)]\s*/, "");
    if (title.length > 3 && !BOILERPLATE_RE.test(title) && headings.length < 15) headings.push(title);
  }
  if (headings.length) return headings;

  const bullets = [];
  for (const line of lines) {
    const t = bulletTitle(line);
    if (t && t.length > 3 && bullets.length < 10) bullets.push(t);
  }
  if (bullets.length) return bullets;

  return ["Setup proyek & scaffolding"];
}

app.post("/api/projects", rateLimit, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) throw Object.assign(httpError(401, "Login dulu."), { code: "NEED_LOGIN" });
    const { title, prd, tasks } = req.body || {};
    if (!title || !String(title).trim()) throw httpError(400, "Judul proyek wajib diisi.");
    let taskList = Array.isArray(tasks) ? tasks.map((t) => String(t).trim()).filter(Boolean) : [];
    if (!taskList.length) taskList = extractTasksFromPrd(prd);
    if (!taskList.length) throw httpError(400, "Tidak ada task yang bisa dibuat dari PRD ini.");

    const projects = await loadProjects();
    const project = {
      id: "prj_" + crypto.randomBytes(4).toString("hex"),
      owner: user.username,
      token: crypto.randomBytes(12).toString("hex"),
      title: String(title).trim().slice(0, 120),
      tasks: taskList.slice(0, 15).map((t, i) => ({
        id: "t" + (i + 1),
        title: t.slice(0, 160),
        status: "pending",
        note: ""
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    projects.push(project);
    await saveProjects(projects);
    res.status(201).json({ ok: true, id: project.id, token: project.token, tasks: project.tasks });
  } catch (err) {
    next(err);
  }
});

app.get("/api/projects/mine", async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ ok: false, error: "Belum login." });
  const mine = (await loadProjects())
    .filter((p) => p.owner === user.username)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map((p) => ({
      id: p.id,
      token: p.token,
      title: p.title,
      tasks: p.tasks,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    }));
  res.json({ ok: true, projects: mine });
});

app.get("/api/projects/:token", async (req, res) => {
  const project = (await loadProjects()).find((p) => p.token === req.params.token);
  if (!project) return res.status(404).json({ ok: false, error: "Proyek tidak ditemukan." });
  res.json({
    ok: true,
    title: project.title,
    owner: project.owner,
    tasks: project.tasks,
    updatedAt: project.updatedAt
  });
});

app.post("/api/agent/report", async (req, res, next) => {
  try {
    const { token, taskId, status, note } = req.body || {};
    if (!token || !taskId) throw httpError(400, "Field 'token' dan 'taskId' wajib diisi.");
    const allowed = ["pending", "progress", "done"];
    const st = allowed.includes(status) ? status : "progress";
    const projects = await loadProjects();
    const project = projects.find((p) => p.token === token);
    if (!project) throw httpError(404, "Token proyek tidak valid.");
    const task = project.tasks.find((t) => t.id === taskId);
    if (!task) throw httpError(404, "Task tidak ditemukan.");
    task.status = st;
    if (note) task.note = String(note).slice(0, 300);
    project.updatedAt = new Date().toISOString();
    await saveProjects(projects);
    res.json({ ok: true, taskId: task.id, status: task.status, title: task.title });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/projects/:id", async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) throw httpError(401, "Login dulu.");
    const projects = await loadProjects();
    const idx = projects.findIndex((p) => p.id === req.params.id && p.owner === user.username);
    if (idx === -1) throw httpError(404, "Proyek tidak ditemukan.");
    projects.splice(idx, 1);
    await saveProjects(projects);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------- VISITOR STATS (realtime via Supabase) ---------- */

/** Hash IP dengan salt — IP asli tidak pernah disimpan. */
function visitorHash(req) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
  const salt = process.env.VISITOR_SALT || "noisy-verse-salt";
  return crypto.createHash("sha256").update(ip + salt).digest("hex").slice(0, 16);
}

/** Counter turunan dari data aplikasi (dipakai untuk sinkronisasi site_stats). */
async function appCounters() {
  const users = await loadUsers();
  return {
    reverses: users.reduce((s, u) => s + (u.reverseUsed || 0), 0),
    prd: users.reduce((s, u) => s + (u.prdUsed || 0), 0),
    members: users.length
  };
}

/**
 * Siarkan counter aplikasi terbaru ke site_stats (memicu event realtime).
 * Di-await supaya selesai sebelum function serverless dibekukan, tapi
 * kegagalan di sini TIDAK boleh menggagalkan request utama.
 */
async function bumpStats() {
  try {
    await stats.refreshStats(await appCounters());
  } catch (err) {
    console.error("[stats] bumpStats gagal:", err.message);
  }
}

app.post("/api/track/visit", async (req, res) => {
  try {
    // Satu RPC: catat kunjungan + sinkronkan counter aplikasi sekaligus.
    await stats.trackVisit(visitorHash(req), await appCounters());
  } catch (err) {
    console.error("[stats] track visit gagal:", err.message);
  }
  res.json({ ok: true });
});

app.get("/api/stats/visitors", async (req, res) => {
  const s = await stats.readStats();
  res.json({ ok: true, total: s.total, unique: s.unique, live: s.live });
});

/**
 * Heartbeat dari browser (~60s sekali) supaya angka "sedang online" akurat:
 * menyegarkan last_seen tanpa menaikkan total kunjungan.
 */
app.post("/api/track/heartbeat", async (req, res) => {
  try {
    await stats.touchVisit(visitorHash(req));
  } catch (err) {
    console.error("[stats] heartbeat gagal:", err.message);
  }
  res.json({ ok: true });
});

app.get("/api/stats/public", async (req, res) => {
  // refreshStats memastikan live_now akurat (tidak menghitung sesi kedaluwarsa)
  // sekaligus menyiarkan angka terbaru ke klien realtime.
  let s;
  try {
    s = await stats.refreshStats(await appCounters());
  } catch {
    s = null;
  }
  if (!s) s = await stats.readStats();
  res.json({
    ok: true,
    totalVisits: s.total,
    uniqueVisitors: s.unique,
    liveNow: s.live,
    reverses: s.reverses,
    prd: s.prd,
    members: s.members
  });
});

/**
 * Kredensial read-only untuk langganan realtime di browser.
 * Publishable/anon key memang aman dipublikasikan: tabel site_stats hanya
 * punya policy SELECT, dan visitor_hits (berisi hash IP) ditolak total oleh RLS.
 * Bila key tidak di-set, frontend otomatis kembali ke polling biasa.
 */
app.get("/api/stats/realtime-config", (req, res) => {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
  res.json({ ok: true, enabled: Boolean(url && key), url, key });
});

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  const orders = (await loadOrders()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ ok: true, orders });
});

app.get("/api/admin/packages-list", requireAdmin, async (req, res) => {
  res.json({ ok: true, packages: await loadPackages() });
});

app.get("/api/admin/broadcast-count", requireAdmin, async (req, res) => {
  res.json({ ok: true, count: await bot.getKnownChatCount() });
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {  const users = (await loadUsers()).map((u) => ({
    username: u.username,
    dev: isDeveloper(u),
    package: u.package || null,
    packageActive: hasActivePackage(u),
    freeTrialUsed: !!u.freeTrialUsed,
    prdUsed: u.prdUsed || 0,
    prdQuota: u.prdQuota === undefined ? 1 : u.prdQuota,
    createdAt: u.createdAt
  }));
  res.json({ ok: true, users });
});

app.delete("/api/admin/users/:username", requireAdmin, async (req, res, next) => {
  try {
    const uname = String(req.params.username).toLowerCase();
    if (uname === "noisy02") throw httpError(403, "Akun developer utama tidak dapat dihapus.");
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.username.toLowerCase() === uname);
    if (idx === -1) throw httpError(404, "User tidak ditemukan.");
    const removed = users.splice(idx, 1)[0];
    await saveUsers(users);
    await removeSessionsForUser(removed.id);
    res.json({ ok: true, deleted: removed.username });
  } catch (err) {
    next(err);
  }
});

app.post("/api/admin/grant-package", requireAdmin, async (req, res, next) => {
  try {
    const { username, packageType, durationDays, force } = req.body || {};
    if (!packageType || !(await normalizePackageId(packageType))) {
      throw httpError(400, "packageType tidak valid. Gunakan: premium, unlimited, atau gratis.");
    }
    // Idempotent: jangan ACC ulang user yang paketnya masih aktif (mencegah kuota menumpuk).
    const existing = (await loadUsers()).find((u) => u.username.toLowerCase() === String(username || "").toLowerCase());
    if (!existing) throw httpError(404, "User tidak ditemukan.");
    if (!force && (existing.dev || hasActivePackage(existing))) {
      return res.json({ ok: true, already: true, username: existing.username });
    }
    const result = await activatePackage(username, packageType, durationDays);
    if (!result) throw httpError(404, "User tidak ditemukan.");
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

app.post("/api/admin/grant-dev", requireAdmin, async (req, res, next) => {
  try {
    const { username } = req.body || {};
    const users = await loadUsers();
    const user = users.find((u) => u.username.toLowerCase() === String(username || "").toLowerCase());
    if (!user) throw httpError(404, "User tidak ditemukan.");
    user.dev = true;
    await saveUsers(users);
    res.json({ ok: true, username: user.username, dev: true });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/admin/orders/:code", requireAdmin, async (req, res, next) => {
  try {
    const orders = await loadOrders();
    const idx = orders.findIndex((o) => o.code === req.params.code.toUpperCase());
    if (idx === -1) throw httpError(404, "Pesanan tidak ditemukan.");
    const removed = orders.splice(idx, 1)[0];
    await saveOrders(orders);
    res.json({ ok: true, deleted: removed.code });
  } catch (err) {
    next(err);
  }
});

app.post("/api/internal/acc-order", requireAdmin, async (req, res, next) => {
  try {
    const { code } = req.body || {};
    if (!code) throw httpError(400, "Field 'code' wajib diisi.");
    const orders = await loadOrders();
    const order = orders.find((o) => o.code === String(code).toUpperCase());
    if (!order) throw httpError(404, "Pesanan tidak ditemukan.");
    if (order.status === "selesai") {
      return res.json({ ok: true, already: true, code: order.code, account: order.account });
    }
    if (!order.account) {
      throw httpError(400, "Pesanan ini tidak terhubung ke akun website manapun.");
    }
    const paketMatch = String(order.target).match(/^paket:(\w+)$/);
    const packageType = paketMatch ? paketMatch[1] : "premium";
    const granted = await activatePackage(order.account, packageType);
    if (!granted) throw httpError(404, "Akun '" + order.account + "' tidak ditemukan di website.");
    order.status = "selesai";
    order.updatedAt = new Date().toISOString();
    // Redeem kupon sekali saat order benar-benar selesai (idempotent lewat guard).
    if (order.coupon && order.coupon.code && !order.couponRedeemed) {
      await redeemCoupon(order.coupon.code);
      order.couponRedeemed = true;
    }
    await saveOrders(orders);
    res.json({ ok: true, code: order.code, account: order.account, package: granted.package, prdQuota: granted.prdQuota, reverseQuota: granted.reverseQuota });
  } catch (err) {
    next(err);
  }
});

app.post("/api/admin/grant", requireAdmin, async (req, res, next) => {
  try {
    const { username, quota } = req.body || {};
    const uname = String(username || "").trim().replace(/^@/, "");
    const amount = parseInt(quota, 10);
    if (!uname) throw httpError(400, "Field 'username' wajib diisi.");
    if (!amount || amount < 1 || amount > 500) throw httpError(400, "Kuota harus angka 1-500.");

    const users = await loadUsers();
    const user = users.find((u) => u.username.toLowerCase() === uname.toLowerCase());
    if (!user) throw httpError(404, "User tidak ditemukan.");

    user.prdQuota = (user.prdQuota === undefined ? 1 : user.prdQuota) + amount;
    await saveUsers(users);
    res.json({ ok: true, username: user.username, prdQuota: user.prdQuota, prdUsed: user.prdUsed || 0 });
  } catch (err) {
    next(err);
  }
});

/* ---------- PACKAGES (dynamic pricing) ---------- */

const PACKAGE_ORDER = { gratis: 0, premium: 1, unlimited: 2 };

app.get("/api/packages", async (req, res) => {
  const list = (await loadPackages())
    .filter((p) => p.active !== false)
    .sort((a, b) => {
      const ra = PACKAGE_ORDER[a.id] !== undefined ? PACKAGE_ORDER[a.id] : 10 + String(a.name).localeCompare(String(b.name));
      const rb = PACKAGE_ORDER[b.id] !== undefined ? PACKAGE_ORDER[b.id] : 10;
      return ra - rb;
    });
  res.json({ ok: true, packages: list });
});

app.post("/api/admin/packages", requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.id || !/^[a-z0-9_-]{2,20}$/.test(body.id)) throw httpError(400, "ID paket wajib (2-20 huruf kecil/angka).");
    if (!body.name) throw httpError(400, "Nama paket wajib diisi.");
    const list = await loadPackages();
    if (list.some((p) => p.id === body.id)) throw httpError(409, "ID paket sudah ada.");
    list.push({
      id: body.id,
      name: body.name,
      tagline: body.tagline || "",
      priceOld: body.priceOld || null,
      price: body.price || "Rp0",
      durationDays: parseInt(body.durationDays, 10) || 30,
      reverseQuota: body.reverseQuota === null || body.reverseQuota === "null" ? null : (parseInt(body.reverseQuota, 10) || 1),
      prdQuota: parseInt(body.prdQuota, 10) || 1,
      benefits: Array.isArray(body.benefits) ? body.benefits.filter(Boolean) : [],
      featured: !!body.featured,
      active: body.active !== false,
      purchasable: body.purchasable !== false
    });
    await savePackages(list);
    res.status(201).json({ ok: true, packages: list });
  } catch (err) {
    next(err);
  }
});

app.put("/api/admin/packages/:id", requireAdmin, async (req, res, next) => {
  try {
    const list = await loadPackages();
    const pkg = list.find((p) => p.id === req.params.id);
    if (!pkg) throw httpError(404, "Paket tidak ditemukan.");
    const body = req.body || {};
    if (body.name !== undefined) pkg.name = body.name;
    if (body.tagline !== undefined) pkg.tagline = body.tagline;
    if (body.priceOld !== undefined) pkg.priceOld = body.priceOld || null;
    if (body.price !== undefined) pkg.price = body.price;
    if (body.durationDays !== undefined) pkg.durationDays = parseInt(body.durationDays, 10) || pkg.durationDays;
    if (body.reverseQuota !== undefined) pkg.reverseQuota = body.reverseQuota === null || body.reverseQuota === "null" ? null : (parseInt(body.reverseQuota, 10) || 0);
    if (body.prdQuota !== undefined) pkg.prdQuota = parseInt(body.prdQuota, 10) || pkg.prdQuota;
    if (body.benefits !== undefined) pkg.benefits = Array.isArray(body.benefits) ? body.benefits.filter(Boolean) : [];
    if (body.featured !== undefined) {
      list.forEach((p) => { if (p.featured && p.id !== pkg.id) p.featured = false; });
      pkg.featured = !!body.featured;
    }
    if (body.active !== undefined) pkg.active = !!body.active;
    if (body.purchasable !== undefined) pkg.purchasable = !!body.purchasable;
    await savePackages(list);
    res.json({ ok: true, packages: list });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/admin/packages/:id", requireAdmin, async (req, res, next) => {
  try {
    const list = await loadPackages();
    const idx = list.findIndex((p) => p.id === req.params.id);
    if (idx === -1) throw httpError(404, "Paket tidak ditemukan.");
    if (list[idx].id === "gratis") throw httpError(403, "Paket Gratis tidak boleh dihapus.");
    const removed = list.splice(idx, 1)[0];
    await savePackages(list);
    res.json({ ok: true, deleted: removed.id });
  } catch (err) {
    next(err);
  }
});

/* ---------- COUPONS (kupon diskon) ---------- */

app.get("/api/admin/coupons", requireAdmin, async (req, res) => {
  res.json({ ok: true, coupons: await loadCoupons() });
});

app.post("/api/admin/coupons", requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const code = String(body.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) {
      throw httpError(400, "Kode kupon wajib 3-20 karakter (huruf/angka/-/_).");
    }
    const type = body.type === "fixed" ? "fixed" : "percent";
    const value = Number(body.value);
    if (!isFinite(value) || value <= 0) throw httpError(400, "Nilai diskon harus angka lebih dari 0.");
    if (type === "percent" && value > 100) throw httpError(400, "Diskon persen maksimal 100.");
    const packageId = String(body.packageId || "").trim();
    if (packageId && !(await getPackageById(packageId))) throw httpError(400, "Paket tujuan tidak ditemukan.");
    const list = await loadCoupons();
    if (list.some((c) => c.code === code)) throw httpError(409, "Kode kupon sudah ada.");
    const coupon = {
      code,
      type,
      value,
      packageId,
      maxUses: parseInt(body.maxUses, 10) || 0,
      usedCount: 0,
      expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : null,
      active: body.active !== false,
      createdAt: new Date().toISOString(),
    };
    list.push(coupon);
    await saveCoupons(list);
    res.status(201).json({ ok: true, coupons: list });
  } catch (err) {
    next(err);
  }
});

app.put("/api/admin/coupons/:code", requireAdmin, async (req, res, next) => {
  try {
    const list = await loadCoupons();
    const coupon = list.find((c) => c.code === String(req.params.code || "").toUpperCase());
    if (!coupon) throw httpError(404, "Kupon tidak ditemukan.");
    const body = req.body || {};
    if (body.type !== undefined) coupon.type = body.type === "fixed" ? "fixed" : "percent";
    if (body.value !== undefined) {
      const value = Number(body.value);
      if (!isFinite(value) || value <= 0) throw httpError(400, "Nilai diskon harus angka lebih dari 0.");
      if (coupon.type === "percent" && value > 100) throw httpError(400, "Diskon persen maksimal 100.");
      coupon.value = value;
    }
    if (body.packageId !== undefined) {
      const pid = String(body.packageId || "").trim();
      if (pid && !(await getPackageById(pid))) throw httpError(400, "Paket tujuan tidak ditemukan.");
      coupon.packageId = pid;
    }
    if (body.maxUses !== undefined) coupon.maxUses = parseInt(body.maxUses, 10) || 0;
    if (body.expiresAt !== undefined) coupon.expiresAt = body.expiresAt ? new Date(body.expiresAt).toISOString() : null;
    if (body.active !== undefined) coupon.active = !!body.active;
    await saveCoupons(list);
    res.json({ ok: true, coupons: list });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/admin/coupons/:code", requireAdmin, async (req, res, next) => {
  try {
    const list = await loadCoupons();
    const idx = list.findIndex((c) => c.code === String(req.params.code || "").toUpperCase());
    if (idx === -1) throw httpError(404, "Kupon tidak ditemukan.");
    const removed = list.splice(idx, 1)[0];
    await saveCoupons(list);
    res.json({ ok: true, deleted: removed.code });
  } catch (err) {
    next(err);
  }
});

// Publik: cek kupon terhadap paket & hitung harga diskon (tidak menaikkan usedCount).
app.post("/api/coupons/validate", rateLimit, async (req, res, next) => {
  try {
    const { code, packageId } = req.body || {};
    const result = await validateCoupon(code, String(packageId || "").trim());
    if (!result.ok) throw httpError(400, result.error);
    res.json({
      ok: true,
      code: result.coupon.code,
      discount: { type: result.coupon.type, value: result.coupon.value },
      packageName: result.packageName,
      originalPrice: result.originalPrice,
      finalPrice: result.finalPrice,
      finalLabel: result.finalLabel,
      discountLabel: result.discountLabel,
    });
  } catch (err) {
    next(err);
  }
});

/* ---------- ANNOUNCEMENTS ---------- */

app.get("/api/announcements", async (req, res) => {
  const now = Date.now();
  const list = (await loadAnnouncements())
    .filter((a) => a.active !== false && (!a.expiresAt || new Date(a.expiresAt) > now))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ ok: true, announcements: list });
});

app.get("/api/admin/announcements", requireAdmin, async (req, res) => {
  const list = (await loadAnnouncements()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ ok: true, announcements: list });
});

app.post("/api/admin/announcements", requireAdmin, async (req, res, next) => {
  try {
    const { message, type, expiresAt } = req.body || {};
    if (!message || !String(message).trim()) throw httpError(400, "Pesan notifikasi wajib diisi.");
    const list = await loadAnnouncements();
    const item = {
      id: "an_" + crypto.randomBytes(4).toString("hex"),
      message: String(message).trim().slice(0, 300),
      type: ["info", "success", "warning"].includes(type) ? type : "info",
      expiresAt: expiresAt || null,
      active: true,
      createdAt: new Date().toISOString()
    };
    list.push(item);
    await saveAnnouncements(list);
    res.status(201).json({ ok: true, announcement: item });
  } catch (err) {
    next(err);
  }
});

app.put("/api/admin/announcements/:id", requireAdmin, async (req, res, next) => {
  try {
    const { message, type, expiresAt, active } = req.body || {};
    const list = await loadAnnouncements();
    const item = list.find((a) => a.id === req.params.id);
    if (!item) throw httpError(404, "Notifikasi tidak ditemukan.");
    if (message !== undefined) {
      if (!String(message).trim()) throw httpError(400, "Pesan tidak boleh kosong.");
      item.message = String(message).trim().slice(0, 300);
    }
    if (type !== undefined && ["info", "success", "warning"].includes(type)) item.type = type;
    if (expiresAt !== undefined) item.expiresAt = expiresAt || null;
    if (active !== undefined) item.active = !!active;
    await saveAnnouncements(list);
    res.json({ ok: true, announcement: item });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/admin/announcements/:id", requireAdmin, async (req, res, next) => {
  try {
    const list = await loadAnnouncements();
    const idx = list.findIndex((a) => a.id === req.params.id);
    if (idx === -1) throw httpError(404, "Notifikasi tidak ditemukan.");
    const removed = list.splice(idx, 1)[0];
    await saveAnnouncements(list);
    res.json({ ok: true, deleted: removed.id });
  } catch (err) {
    next(err);
  }
});

/* ---------- PAYMENT METHODS ---------- */

/**
 * QRIS yang diupload admin disimpan sebagai data URI base64 di dalam blob
 * `payments` (~180 KB). Kalau ikut dikirim di /api/payments, setiap pembukaan
 * halaman bayar mengunduh 180 KB JSON yang tidak bisa di-cache browser — itulah
 * sebabnya QRIS baru muncul beberapa detik setelah halaman tampil. Di sini data
 * URI ditukar dengan URL gambar sungguhan yang bisa di-cache.
 */
function publicPayment(p) {
  if (!p.imageUrl || !/^data:/.test(p.imageUrl)) return p;
  return { ...p, imageUrl: "/api/payments/" + encodeURIComponent(p.id) + "/qr" };
}

app.get("/api/payments", async (req, res) => {
  const list = (await loadPayments()).filter((p) => p.active !== false).map(publicPayment);
  res.json({ ok: true, payments: list });
});

// Sajikan gambar QRIS sebagai berkas biner + cache panjang. ETag dari isi
// gambar, jadi begitu admin mengganti QRIS, URL-nya sama tapi ETag berubah.
app.get("/api/payments/:id/qr", async (req, res, next) => {
  try {
    const item = (await loadPayments()).find((p) => p.id === req.params.id);
    if (!item || !item.imageUrl) throw httpError(404, "Gambar pembayaran tidak ditemukan.");
    const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(item.imageUrl);
    if (!m) throw httpError(404, "Gambar pembayaran tidak ditemukan.");
    const buf = Buffer.from(m[2], "base64");
    const etag = '"' + crypto.createHash("sha1").update(buf).digest("hex") + '"';
    res.setHeader("ETag", etag);
    res.setHeader("Content-Type", m[1]);
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    res.end(buf);
  } catch (err) {
    next(err);
  }
});

app.get("/api/admin/payments", requireAdmin, async (req, res) => {
  res.json({ ok: true, payments: await loadPayments() });
});

app.post("/api/admin/payments", requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) throw httpError(400, "Nama metode wajib diisi.");
    if (!["bank", "ewallet", "qris"].includes(body.type)) throw httpError(400, "Tipe harus: bank, ewallet, atau qris.");
    if (!body.accountName || !String(body.accountName).trim()) throw httpError(400, "Atas nama wajib diisi.");
    if (body.type !== "qris" && !String(body.accountNumber || "").trim()) throw httpError(400, "Nomor rekening/HP wajib diisi.");

    const list = await loadPayments();
    const item = {
      id: "pm_" + crypto.randomBytes(3).toString("hex"),
      type: body.type,
      name: String(body.name).trim().slice(0, 40),
      accountName: String(body.accountName).trim().slice(0, 60),
      accountNumber: String(body.accountNumber || "").trim().slice(0, 40),
      imageUrl: String(body.imageUrl || "").trim(),
      active: body.active !== false
    };
    list.push(item);
    await savePayments(list);
    res.status(201).json({ ok: true, payments: list });
  } catch (err) {
    next(err);
  }
});

app.put("/api/admin/payments/:id", requireAdmin, async (req, res, next) => {
  try {
    const list = await loadPayments();
    const item = list.find((p) => p.id === req.params.id);
    if (!item) throw httpError(404, "Metode pembayaran tidak ditemukan.");
    const body = req.body || {};
    if (body.name !== undefined) item.name = String(body.name).trim().slice(0, 40);
    if (body.accountName !== undefined) item.accountName = String(body.accountName).trim().slice(0, 60);
    if (body.accountNumber !== undefined) item.accountNumber = String(body.accountNumber).trim().slice(0, 40);
    if (body.imageUrl !== undefined) item.imageUrl = String(body.imageUrl).trim();
    if (body.active !== undefined) item.active = !!body.active;
    await savePayments(list);
    res.json({ ok: true, payments: list });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/admin/payments/:id", requireAdmin, async (req, res, next) => {
  try {
    const list = await loadPayments();
    const idx = list.findIndex((p) => p.id === req.params.id);
    if (idx === -1) throw httpError(404, "Metode pembayaran tidak ditemukan.");
    const removed = list.splice(idx, 1)[0];
    await savePayments(list);
    res.json({ ok: true, deleted: removed.id });
  } catch (err) {
    next(err);
  }
});

/* ---------- STATS / EXPORT / BROADCAST / MAINTENANCE ---------- */

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  // Tiga blob independen -> baca paralel, bukan berurutan (3 roundtrip jadi 1).
  const [users, orders, pkgList] = await Promise.all([loadUsers(), loadOrders(), loadPackages()]);
  const premiumActive = users.filter((u) => hasActivePackage(u)).length;
  const revenue = orders
    .filter((o) => o.status === "selesai")
    .reduce((sum, o) => {
      const m = String(o.target).match(/^paket:(\w+)$/);
      const pkg = m ? pkgList.find((p) => p.id === m[1] || (m[1] === "hemat" && p.id === "premium")) : null;
      const num = pkg ? parseInt(String(pkg.price).replace(/[^\d]/g, ""), 10) || 0 : 0;
      return sum + num * 1000;
    }, 0);
  const reverses = users.reduce((s, u) => s + (u.reverseUsed || 0), 0);
  const prd = users.reduce((s, u) => s + (u.prdUsed || 0), 0);
  res.json({
    ok: true,
    stats: {
      users: users.length,
      premiumActive,
      orders: orders.length,
      ordersPending: orders.filter((o) => o.status === "menunggu_pembayaran").length,
      revenue,
      reverses,
      prd
    }
  });
});

function toCsv(rows) {
  return rows.map((r) => r.map((c) => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
}

app.get("/api/admin/export/users", requireAdmin, async (req, res) => {
  const rows = [["username", "dev", "paket", "paket_aktif", "berlaku_sampai", "reverse_used", "reverse_quota", "prd_used", "prd_quota", "daftar"]];
  for (const u of await loadUsers()) {
    rows.push([
      u.username, isDeveloper(u) ? "ya" : "tidak",
      u.package ? u.package.type : "gratis",
      hasActivePackage(u) ? "ya" : "tidak",
      u.package ? u.package.expiresAt : "-",
      u.reverseUsed || 0,
      isDeveloper(u) ? "unlimited" : (u.reverseQuota === undefined ? 1 : u.reverseQuota),
      u.prdUsed || 0,
      isDeveloper(u) ? "unlimited" : (u.prdQuota === undefined ? 1 : u.prdQuota),
      u.createdAt
    ]);
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=users.csv");
  res.send("\ufeff" + toCsv(rows));
});

app.get("/api/admin/export/orders", requireAdmin, async (req, res) => {
  const rows = [["kode", "telegram", "akun", "paket", "status", "dibuat"]];
  for (const o of await loadOrders()) {
    rows.push([o.code, o.telegram, o.account || "-", o.target, o.status, o.createdAt]);
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=orders.csv");
  res.send("\ufeff" + toCsv(rows));
});

app.post("/api/admin/broadcast", requireAdmin, async (req, res, next) => {
  try {
    const { message } = req.body || {};
    if (!message || !String(message).trim()) throw httpError(400, "Pesan broadcast wajib diisi.");
    const result = await bot.broadcast(String(message).trim().slice(0, 1000));
    res.json({ ok: true, sent: result.sent, failed: result.failed });
  } catch (err) {
    next(err);
  }
});

app.post("/api/assistant", rateLimit, async (req, res, next) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || !String(prompt).trim()) throw httpError(400, "Pertanyaan wajib diisi.");

    const pkgList = (await loadPackages()).filter((p) => p.active !== false);
    const pkgInfo = pkgList.map((p) =>
      p.name + " (" + p.price + (p.priceOld ? ", diskon dari " + p.priceOld : "") + ", " + p.durationDays + " hari" +
      ", reverse " + (p.reverseQuota === null ? "unlimited" : p.reverseQuota + "x") +
      ", PRD " + p.prdQuota + "x" + ")"
    ).join("; ");

    const context =
      "Kamu adalah asisten AI yang ramah untuk pengunjung website 'Noisy Verse' — jasa reverse website/repo GitHub menjadi prompt AI, plus generator PRD berbasis AI. " +
      "Jawab singkat, ramah, dan dalam Bahasa Indonesia. Gunakan 'kamu' untuk menyapa. " +
      "Info website: User baru gratis 1x reverse + 1x generate PRD (salin teks; unduh PRD.md khusus paket berbayar). " +
      "Cara beli: pilih paket di bagian Harga → klik Beli Sekarang → buat kode pesanan → bayar via QRIS/transfer → konfirmasi foto bukti ke bot Telegram @noisyversepayment_bot → admin verifikasi → akun premium aktif otomatis. " +
      "Paket: " + pkgInfo + ". " +
      "Garansi: gagal proses karena kesalahan sistem diganti/refresh kuota. Kontak admin: Telegram @noisy02. " +
      "Jangan janjikan hal di luar kebijakan. Jika pertanyaan di luar topik website, arahkan dengan ramah ke Telegram @noisy02.";

    const reply = await ai.assistant(String(prompt).trim().slice(0, 500), context);
    res.json({ ok: true, reply });
  } catch (err) {
    next(err);
  }
});

app.post("/api/admin/assistant", rateLimit, async (req, res, next) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || !String(prompt).trim()) throw httpError(400, "Pertanyaan wajib diisi.");

    const users = await loadUsers();
    const orders = await loadOrders();
    const pkgList = await loadPackages();
    const pending = orders.filter((o) => o.status === "menunggu_pembayaran");
    const revenue = orders
      .filter((o) => o.status === "selesai")
      .reduce((sum, o) => {
        const m = String(o.target).match(/^paket:(\w+)$/);
        const pkg = m ? pkgList.find((p) => p.id === m[1] || (m[1] === "hemat" && p.id === "premium")) : null;
        return sum + (pkg ? parseInt(String(pkg.price).replace(/[^\d]/g, ""), 10) || 0 : 0) * 1000;
      }, 0);

    const context =
      "Kamu adalah asisten AI untuk admin website 'Noisy Verse' — jasa reverse website/repo GitHub menjadi prompt AI, plus generator PRD berbasis AI. " +
      "Jawab pertanyaan admin dengan singkat, jelas, dan dalam Bahasa Indonesia. " +
      "Cara mengelola website: (1) ACC pesanan: buka Admin Panel tab Pesanan, pilih status lalu Simpan — atau tekan tombol Acc di bot Telegram saat bukti bayar masuk; " +
      "(2) Aktivasi paket user: tab Pengguna, pilih paket + durasi hari lalu klik Acc — kuota PRD & reverse otomatis ditambah; " +
      "(3) Jadikan developer: tab Pengguna, klik tombol Dev; (4) Hapus user/pesanan: tombol hapus di tabel; " +
      "(5) Ubah harga/tambah paket: tab Paket; (6) Notifikasi website: tab Notifikasi (bisa atur kedaluwarsa); (7) Broadcast Telegram: tab Broadcast; " +
      "(8) Maintenance mode: tab Pengaturan. " +
      "Paket aktif saat ini: " + pkgList.map((p) => p.name + " (" + p.price + ", " + p.durationDays + " hari, reverse " + (p.reverseQuota === null ? "unlimited" : p.reverseQuota) + "x, PRD " + p.prdQuota + "x)").join("; ") + ". " +
      "Data saat ini: total user " + users.length + ", premium aktif " + users.filter((u) => hasActivePackage(u)).length +
      ", total pesanan " + orders.length + ", menunggu bayar " + pending.length + ", pendapatan Rp" + revenue.toLocaleString("id-ID") + ".";

    const reply = await ai.assistant(String(prompt).trim().slice(0, 500), context);
    res.json({ ok: true, reply });
  } catch (err) {
    next(err);
  }
});

app.post("/api/admin/maintenance", requireAdmin, async (req, res, next) => {
  try {
    const cfg = await loadConfig();
    cfg.maintenance = !!(req.body || {}).enabled;
    await saveConfig(cfg);
    res.json({ ok: true, maintenance: cfg.maintenance });
  } catch (err) {
    next(err);
  }
});

/**
 * Endpoint yang WAJIB menulis ke database (auth, order, admin) tidak ada
 * gunanya dicoba bila kredensial Supabase belum di-set — hasilnya cuma error
 * 500. Tolak lebih awal dengan pesan yang bisa dipahami pengunjung.
 * Endpoint baca-saja sengaja dibiarkan lewat supaya halaman tetap tampil
 * (memakai nilai default) alih-alih blank.
 */
function requireStore(req, res, next) {
  if (storeConfigured) return next();
  return res.status(503).json({
    ok: false,
    error: "Server belum terhubung ke database, fitur akun sementara nonaktif. Hubungi admin via Telegram @noisy02."
  });
}

app.post("/api/auth/register", rateLimit, requireStore, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const uname = String(username || "").trim();
    const pass = String(password || "");

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(uname)) {
      throw httpError(400, "Username 3-20 karakter, hanya huruf, angka, dan underscore.");
    }
    if (pass.length < 6) throw httpError(400, "Password minimal 6 karakter.");

    const users = await loadUsers();
    if (users.some((u) => u.username.toLowerCase() === uname.toLowerCase())) {
      throw httpError(409, "Username sudah dipakai, pilih yang lain.");
    }

    const user = {
      id: "u_" + crypto.randomBytes(6).toString("hex"),
      username: uname,
      password: makePasswordRecord(pass),
      freeTrialUsed: false,
      trialUsedAt: null,
      prdUsed: 0,
      prdQuota: 1,
      reverseUsed: 0,
      reverseQuota: 1,
      package: null,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    await saveUsers(users);
    await setSession(res, user.id);
    // Jumlah member berubah -> siarkan ke klien realtime.
    await bumpStats();

    res.status(201).json({ ok: true, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

app.post("/api/auth/login", rateLimit, requireStore, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const user = (await loadUsers()).find(
      (u) => u.username.toLowerCase() === String(username || "").trim().toLowerCase()
    );
    if (!user || !verifyPassword(String(password || ""), user.password)) {
      throw httpError(401, "Username atau password salah.");
    }
    await setSession(res, user.id);
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const token = parseCookies(req).nv_session;
  if (token) {
    await removeSession(token);
  }
  res.setHeader("Set-Cookie", "nv_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ ok: false, error: "Belum login." });
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/reverse", rateLimit, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) {
      throw Object.assign(httpError(401, "Login dulu untuk mencoba fitur ini."), { code: "NEED_LOGIN" });
    }
    const isDev = isDeveloper(user);
    const premium = hasActivePackage(user);
    const used = user.reverseUsed || 0;
    const quota = user.reverseQuota === undefined ? 1 : user.reverseQuota;
    const unlimitedReverse = isDev || (premium && quota >= 999999);
    if (!isDev && !unlimitedReverse && used >= quota) {
      throw Object.assign(
        httpError(403, "Kuota reverse kamu sudah habis (" + used + "/" + quota + "). Beli paket untuk tambah kuota."),
        { code: "QUOTA_USED" }
      );
    }

    const { type, target } = req.body || {};
    if (!type || !target) throw httpError(400, "Field 'type' dan 'target' wajib diisi.");

    let result;
    if (type === "website") {
      const publicUrl = assertPublicUrl(String(target).trim());
      result = await websiteToPrompt(publicUrl);
      // Slug untuk halaman design.md (dipakai walau designPath null pada fallback AI).
      let slug = "";
      try { slug = extractSlug(publicUrl); result.designSlug = slug; } catch {}
      // GitReverse menyisipkan URL "https://gitreverse.com/designs/<slug>" di dalam prompt.
      // Arahkan ke halaman design internal Noisy Verse, bukan situs gitreverse.
      if (result.prompt) {
        const origin = req.protocol + "://" + req.get("host");
        const internal = origin + "/design.html?slug=" + encodeURIComponent(slug || extractSlug(publicUrl)) +
          "&target=" + encodeURIComponent(publicUrl);
        let prompt = String(result.prompt).replace(
          /https?:\/\/(?:www\.)?gitreverse\.com\/designs\/[A-Za-z0-9._-]+/gi,
          internal
        );
        // Jika prompt belum memuat arahan ke design system (kasus fallback AI atau
        // GitReverse tak menyertakannya), tambahkan agar selalu mengarah ke halaman
        // design internal Noisy Verse untuk melihat design.md.
        if (!prompt.includes(internal)) {
          prompt = prompt.trim() + "\n\nUse this design system for the visuals: " + internal;
        }
        result.prompt = prompt;
      }
    } else if (type === "repo") {
      result = await repoToPrompt(String(target).trim());
    } else {
      throw httpError(400, "Field 'type' harus 'website' atau 'repo'.");
    }

    let freshUsed = used;
    if (!isDev && !unlimitedReverse) {
      const users = await loadUsers();
      const fresh = users.find((u) => u.id === user.id);
      if (fresh) {
        fresh.reverseUsed = (fresh.reverseUsed || 0) + 1;
        freshUsed = fresh.reverseUsed;
        await saveUsers(users);
      }
      // Siarkan counter baru ke klien realtime.
      await bumpStats();
    }

    res.json({
      ok: true,
      type,
      target,
      reverseUsed: isDev || unlimitedReverse ? 0 : freshUsed,
      reverseQuota: isDev || unlimitedReverse ? 999999 : quota,
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

/* Pecah teks panjang jadi potongan kecil untuk diterjemahkan (provider AI gratis
   menolak/gagal pada input panjang). Hormati batas baris & jangan potong di dalam
   code fence (```), supaya struktur markdown tetap utuh. */
function chunkForTranslate(text, maxLen) {
  const lines = String(text).split("\n");
  const chunks = [];
  let buf = [];
  let bufLen = 0;
  let inFence = false;
  const flush = () => { if (buf.length) { chunks.push(buf.join("\n")); buf = []; bufLen = 0; } };
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && buf.length && bufLen + line.length + 1 > maxLen) flush();
    buf.push(line);
    bufLen += line.length + 1;
  }
  flush();
  return chunks;
}

/* Terjemahkan hasil reverse (EN <-> ID). Wajib login, tidak memotong kuota apa pun. */
app.post("/api/reverse/translate", rateLimit, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) {
      throw Object.assign(httpError(401, "Login dulu untuk memakai fitur ini."), { code: "NEED_LOGIN" });
    }
    const { text, lang } = req.body || {};
    if (!text || !String(text).trim()) throw httpError(400, "Field 'text' wajib diisi.");
    const target = lang === "en" ? "English" : "Bahasa Indonesia";
    const instruction =
      "Kamu penerjemah teknis. Terjemahkan teks berikut ke " + target + ". " +
      "Ini adalah prompt/brief untuk membangun aplikasi, jadi PERTAHANKAN: format markdown, heading, bullet, code block, " +
      "istilah teknis, nama teknologi/library/API, path, dan nama file apa adanya (jangan diterjemahkan). " +
      "Terjemahkan hanya kalimat naratif/penjelasannya. Balas HANYA dengan hasil terjemahan tanpa komentar atau pembuka.";

    const raw = String(text).trim();
    const MAX = 1000; // aman di bawah batas "teks panjang" provider gratis
    let translated = "";
    let provider = "";

    if (raw.length <= MAX) {
      const r = await ai.generateText(raw, instruction);
      translated = String(r.text || "").trim();
      provider = r.provider;
    } else {
      // Teks panjang (mis. design.md ~12KB): terjemahkan per-potongan lalu gabung.
      // Diproses beberapa potongan sekaligus (concurrency terbatas) supaya tidak terlalu lama.
      const chunks = chunkForTranslate(raw, MAX);
      const results = new Array(chunks.length);
      const provs = new Set();
      let idx = 0;
      const worker = async () => {
        while (idx < chunks.length) {
          const i = idx++;
          const ch = chunks[i];
          if (!ch.trim()) { results[i] = ch; continue; }
          const r = await ai.generateText(ch, instruction);
          const t = String(r.text || "").trim();
          if (!t) throw httpError(502, "Sebagian teks gagal diterjemahkan. Coba lagi sebentar lagi.");
          results[i] = t;
          provs.add(r.provider);
        }
      };
      const CONCURRENCY = Math.min(3, chunks.length);
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      translated = results.join("\n");
      provider = [...provs].join("+");
    }

    if (!translated) {
      throw httpError(502, "Gagal menerjemahkan. Coba lagi sebentar lagi.");
    }
    res.json({ ok: true, text: translated, lang: lang === "en" ? "en" : "id", source: provider });
  } catch (err) {
    next(err);
  }
});

/* Ambil design.md (design system) untuk halaman design.html. Wajib login, tak potong kuota.
   Utama: proxy design.md GitReverse via slug. Fallback: generate sendiri via AI dari target. */
app.get("/api/reverse/design", rateLimit, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) {
      throw Object.assign(httpError(401, "Login dulu untuk melihat design system."), { code: "NEED_LOGIN" });
    }
    const slug = String(req.query.slug || "").trim().toLowerCase();
    const target = String(req.query.target || "").trim();
    if (!slug && !target) throw httpError(400, "Parameter 'slug' atau 'target' wajib diisi.");

    const BROWSER_HEADERS = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/markdown,text/plain,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    };

    // 1) Proxy design.md dari GitReverse (bila slug valid).
    if (slug && /^[a-z0-9-]+$/.test(slug)) {
      try {
        const dRes = await fetchWithTimeout(
          "https://www.gitreverse.com/api/website-design/" + encodeURIComponent(slug) + "?download=1",
          { headers: BROWSER_HEADERS, redirect: "follow" }
        );
        if (dRes.ok) {
          const md = await dRes.text();
          if (md && md.trim().length > 40) {
            return res.json({ ok: true, markdown: md.trim(), slug, source: "gitreverse" });
          }
        }
      } catch (err) {
        console.warn("[design] GitReverse design.md gagal, coba AI:", err.message);
      }
    }

    // 2) Fallback: generate design system sendiri via AI dari konten situs.
    if (target) {
      const publicUrl = assertPublicUrl(target);
      let html = "";
      try {
        const wRes = await fetchWithTimeout(publicUrl, {
          headers: {
            ...BROWSER_HEADERS,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
          },
          redirect: "follow",
        }, 15000);
        if (wRes.status === 403 || wRes.status === 401) {
          throw httpError(502, "Website itu memblokir akses otomatis — coba website lain.");
        }
        if (wRes.ok) html = await wRes.text();
      } catch (err) {
        if (err && err.status) throw err;
      }
      const summary = html ? summarizeHtml(html, publicUrl) : "URL: " + publicUrl;
      const instruction =
        "You are a senior product/design engineer. Based on this real website's content, write a COMPLETE design system document in Markdown (English) that a developer could follow to recreate the same look & feel. " +
        "Use numbered sections with clear headings and markdown tables where useful: 1. Visual Theme & Mood, 2. Color Palette (with hex values), 3. Typography (font families, sizes, weights), 4. Component Styling (buttons, cards, inputs, nav), 5. Layout & Grid, 6. Spacing, Radius & Elevation, 7. Do's & Don'ts, 8. Responsive Behavior, 9. Agent Prompt Guide (a ready-to-use prompt to rebuild the site). " +
        "Output raw Markdown ONLY — no explanations before/after, do not wrap in a code fence.";
      const { text } = await ai.generateText(summary, instruction);
      if (!text || !text.trim()) throw httpError(502, "Gagal membuat design system dari website itu. Coba lagi.");
      return res.json({ ok: true, markdown: text.trim(), slug: slug || null, source: "ai" });
    }

    throw httpError(502, "Design system tidak tersedia untuk target ini.");
  } catch (err) {
    next(err);
  }
});

app.post("/api/orders", rateLimit, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (user && isDeveloper(user)) {
      throw httpError(403, "Akun developer tidak dapat membeli paket.");
    }
    if (user && hasActivePackage(user)) {
      const until = user.package && user.package.expiresAt
        ? new Date(user.package.expiresAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })
        : "";
      throw Object.assign(
        httpError(403, "Paket kamu masih aktif s/d " + until + ". Tidak bisa membeli lagi sebelum masa aktif habis."),
        { code: "PACKAGE_ACTIVE" }
      );
    }

    const { type, target, telegram, coupon } = req.body || {};
    if (!type || !["website", "repo"].includes(type)) throw httpError(400, "Field 'type' harus 'website' atau 'repo'.");
    if (!target || String(target).trim().length < 4) throw httpError(400, "Field 'target' wajib diisi.");
    if (!telegram || String(telegram).trim().length < 3) throw httpError(400, "Field 'telegram' wajib diisi.");

    // Kupon opsional: validasi ulang di server terhadap paket pada target ("paket:<id>").
    let orderCoupon = null;
    if (coupon) {
      const paketMatch = String(target).trim().match(/^paket:(\w+)$/);
      const packageId = paketMatch ? paketMatch[1] : "";
      const check = await validateCoupon(coupon, packageId);
      if (!check.ok) throw httpError(400, check.error);
      orderCoupon = {
        code: check.coupon.code,
        type: check.coupon.type,
        value: check.coupon.value,
        originalPrice: check.originalPrice,
        finalPrice: check.finalPrice,
        finalLabel: check.finalLabel,
      };
    }

    const orders = await loadOrders();
    const order = {
      code: newOrderCode(),
      type,
      target: String(target).trim(),
      telegram: String(telegram).trim(),
      account: user ? user.username : null,
      status: "menunggu_pembayaran",
      coupon: orderCoupon,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      result: null,
    };
    orders.push(order);
    await saveOrders(orders);

    res.status(201).json({ ok: true, code: order.code, status: order.status, account: order.account, coupon: orderCoupon });
  } catch (err) {
    next(err);
  }
});

app.get("/api/orders/:code", async (req, res, next) => {
  try {
    const order = (await loadOrders()).find((o) => o.code === req.params.code.toUpperCase());
    if (!order) throw httpError(404, "Pesanan tidak ditemukan.");
    res.json({
      ok: true,
      code: order.code,
      type: order.type,
      target: order.target,
      account: order.account || null,
      status: order.status,
      createdAt: order.createdAt,
      prompt: order.result ? order.result.prompt : null,
      designPath: order.result ? order.result.designPath : null,
    });
  } catch (err) {
    next(err);
  }
});

app.patch("/api/orders/:code", requireAdmin, async (req, res, next) => {
  try {
    const allowed = ["menunggu_pembayaran", "diproses", "selesai", "dibatalkan"];
    const { status, result } = req.body || {};
    const orders = await loadOrders();
    const order = orders.find((o) => o.code === req.params.code.toUpperCase());
    if (!order) throw httpError(404, "Pesanan tidak ditemukan.");
    if (status && !allowed.includes(status)) {
      throw httpError(400, `Status harus salah satu dari: ${allowed.join(", ")}`);
    }
    // Idempotent: order yang sudah "selesai" tidak boleh diubah lagi lewat panel.
    if (order.status === "selesai" && !(result && typeof result === "object")) {
      return res.json({ ok: true, already: true, code: order.code, status: order.status });
    }
    if (status) order.status = status;
    if (result && typeof result === "object") order.result = result;
    // Redeem kupon sekali saat status pindah ke "selesai" lewat panel.
    if (order.status === "selesai" && order.coupon && order.coupon.code && !order.couponRedeemed) {
      await redeemCoupon(order.coupon.code);
      order.couponRedeemed = true;
    }
    order.updatedAt = new Date().toISOString();
    await saveOrders(orders);
    res.json({ ok: true, code: order.code, status: order.status });
  } catch (err) {
    next(err);
  }
});

/* ---------- TELEGRAM WEBHOOK ---------- */
// Endpoint yang dipanggil Telegram saat mode webhook (produksi/Vercel).
// Opsional: verifikasi header rahasia bila TELEGRAM_WEBHOOK_SECRET di-set.
app.post("/api/telegram/webhook", async (req, res) => {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
    if (secret && req.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
      return res.status(401).json({ ok: false });
    }
    // Balas cepat supaya Telegram tidak retry; proses update setelahnya.
    res.json({ ok: true });
    await bot.processUpdate(req.body || {});
  } catch (err) {
    console.error("[webhook] gagal memproses update:", err.message);
  }
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Endpoint tidak ditemukan." });
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  // Error 500 = bug/misconfigurasi server. Detail teknisnya (nama env yang
  // kurang, stack trace, pesan driver) hanya untuk log — pengunjung cukup
  // diberi pesan yang bisa mereka tindak lanjuti. httpError() dengan status
  // 4xx/502 memang pesan untuk pengguna, jadi diteruskan apa adanya.
  if (status === 500) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: "Server sedang bermasalah. Coba lagi sebentar lagi atau hubungi admin via Telegram @noisy02."
    });
  }
  const body = { ok: false, error: err.message || "Terjadi kesalahan internal." };
  if (err.code) body.code = err.code;
  res.status(status).json(body);
});

// Ekspor app untuk Vercel serverless (api/index.js). Server HTTP + polling bot
// hanya dijalankan saat file ini dieksekusi langsung (dev lokal), bukan saat di-require.
module.exports = app;

if (require.main === module) {
  seedDefaults()
    .catch((e) => console.error("[seed] gagal:", e.message))
    .finally(() => {
      const server = app.listen(PORT, () => {
        console.log(`Noisy Verse backend berjalan di http://localhost:${PORT}`);
        bot.start();
      });

      server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          console.error("");
          console.error("GAGAL: Port " + PORT + " sedang dipakai proses lain.");
          console.error("Kemungkinan ada server lama yang masih jalan. Coba:");
          console.error("  1. Tutup terminal lain yang menjalankan npm run dev, atau");
          console.error("  2. Jalankan: npx kill-port " + PORT + "  (lalu jalankan ulang)");
          console.error("  3. Atau pakai port lain:  $env:PORT=3001; npm run dev");
          console.error("");
          process.exit(1);
        }
        throw err;
      });
    });
}
