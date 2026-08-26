/**
 * bot.js — Bot Telegram Noisy Verse.
 *
 * Dua mode:
 *  - Polling (dev lokal): start() menjalankan loop getUpdates.
 *  - Webhook (produksi/Vercel): server memanggil processUpdate(update) dari
 *    route POST /api/telegram/webhook. Tidak ada proses long-running.
 *
 * State (pending proof, kode→chat, daftar chat) disimpan di Supabase lewat
 * store.js (key "bot_state"), bukan file/memory — aman untuk serverless.
 * Semua secret hanya dari env (tidak ada fallback hardcoded).
 */
const { loadStore, saveStore } = require("./store");

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
// Basis URL API sendiri. Di Vercel set PUBLIC_BASE_URL (mis. https://noisyverse.vercel.app);
// VERCEL_URL otomatis tersedia di runtime Vercel. Fallback ke localhost untuk dev.
const API_BASE =
  process.env.PUBLIC_BASE_URL ||
  (process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "http://localhost:" + (process.env.PORT || 3000));
const TG_BASE = "https://api.telegram.org/bot" + TELEGRAM_TOKEN;

let offset = 0;
let botUsername = null;

/* ---------- STATE (Supabase key "bot_state") ---------- */
const BOT_STATE_KEY = "bot_state";

async function loadState() {
  const s = await loadStore(BOT_STATE_KEY, { pending: {}, codeToChat: {}, chats: {} });
  return { pending: s.pending || {}, codeToChat: s.codeToChat || {}, chats: s.chats || {} };
}
async function saveState(s) { return saveStore(BOT_STATE_KEY, s); }

async function rememberChat(chat) {
  if (!chat || chat.type !== "private") return;
  const s = await loadState();
  s.chats[chat.id] = { username: chat.username || null, first_name: chat.first_name || null };
  await saveState(s);
}

async function setPending(chatId, code) {
  const s = await loadState();
  s.pending[chatId] = code;
  await saveState(s);
}
async function getPending(chatId) {
  const s = await loadState();
  return s.pending[chatId] || null;
}
async function setCodeChat(code, chatId) {
  const s = await loadState();
  s.codeToChat[String(code).toUpperCase()] = chatId;
  await saveState(s);
}
async function getCodeChat(code) {
  const s = await loadState();
  return s.codeToChat[String(code).toUpperCase()] || null;
}

async function broadcast(message) {
  const { chats } = await loadState();
  let sent = 0, failed = 0;
  for (const chatId of Object.keys(chats)) {
    try {
      const r = await callApi("sendMessage", {
        chat_id: chatId,
        text: "📢 <b>Pengumuman Noisy Verse</b>\n\n" + message,
        parse_mode: "HTML",
      });
      if (r && r.ok) sent++; else failed++;
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}

async function getPackageName(orderTarget) {
  const m = String(orderTarget || "").match(/^paket:(\w+)$/);
  if (!m) return orderTarget || "-";
  try {
    const res = await fetch(API_BASE + "/api/packages");
    const data = await res.json();
    if (data.ok) {
      const pkg = data.packages.find((p) => p.id === m[1]);
      if (pkg) return pkg.name;
      if (m[1] === "hemat") return "Premium";
      if (m[1] === "coba") return "Gratis";
    }
  } catch {}
  return m[1];
}

async function callApi(method, body) {
  const res = await fetch(TG_BASE + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  return res.json();
}

async function adminApi(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

async function sendMessage(chatId, text, keyboard) {
  return callApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined
  });
}

async function loadBotUsername() {
  try {
    const data = await callApi("getMe");
    if (data.ok) botUsername = data.result.username;
  } catch {}
}

async function handlePhoto(msg) {
  const chatId = msg.chat.id;
  const from = msg.from || {};
  await rememberChat(msg.chat);
  const code = (await getPending(chatId)) || extractCode(msg.caption || "");
  if (!code) {
    return sendMessage(chatId, "Kirim dulu kode pesananmu dengan perintah /order KODE, lalu kirim foto bukti bayar.");
  }

  const orderInfo = await adminApi("GET", "/api/orders/" + code).catch(() => null);
  const account = orderInfo && orderInfo.ok ? orderInfo.account || "belum terhubung" : "tidak diketahui";

  await setCodeChat(code.toUpperCase(), chatId);
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  const packageName = await getPackageName(orderInfo && orderInfo.ok ? orderInfo.target : "");

  await callApi("sendPhoto", {
    chat_id: TELEGRAM_OWNER_ID,
    photo: fileId,
    parse_mode: "HTML",
    caption:
      "🔔 <b>Pesanan Baru Menunggu Acc</b>\n\n" +
      "Kode: <b>" + code + "</b>\n" +
      "Dari: " + (from.username ? "@" + from.username : from.first_name || "-") + "\n" +
      "Akun website: <b>" + account + "</b>\n" +
      "Paket: <b>" + packageName + "</b>\n\n" +
      "Tekan tombol di bawah untuk verifikasi.",
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Acc", callback_data: "acc:" + code },
        { text: "❌ Tolak", callback_data: "rej:" + code }
      ]]
    }
  });

  return sendMessage(chatId, "✅ Bukti diterima untuk pesanan <b>" + code + "</b>.\nMenunggu verifikasi admin — kamu akan diberi tahu di sini setelah diproses.");
}

async function handleCallback(query) {
  const data = query.data || "";
  const message = query.message;
  const from = query.from || {};

  if (!data.startsWith("acc:") && !data.startsWith("rej:")) return;

  const isAcc = data.startsWith("acc:");
  const code = data.split(":")[1];
  const chatId = await getCodeChat(code.toUpperCase());

  if (String(from.id) !== String(TELEGRAM_OWNER_ID)) {
    return callApi("answerCallbackQuery", { callback_query_id: query.id, text: "Hanya owner yang bisa memverifikasi." });
  }

  if (isAcc) {
    const result = await adminApi("POST", "/api/internal/acc-order", { code });
    if (!result.ok) {
      await callApi("answerCallbackQuery", { callback_query_id: query.id, text: "Gagal: " + (result.error || "unknown") });
      return;
    }
    await callApi("answerCallbackQuery", { callback_query_id: query.id, text: "Pesanan di-ACC!" });
    if (message) {
      await callApi("editMessageReplyMarkup", { chat_id: message.chat.id, message_id: message.message_id });
      await callApi("editMessageText", {
        chat_id: message.chat.id,
        message_id: message.message_id,
        parse_mode: "HTML",
        text: "✅ <b>Pesanan " + code + " DI-ACC</b>\nAkun <b>" + (result.account || "-") + "</b> kini premium aktif.\nPRD quota: " + result.prdQuota
      });
    }
    if (chatId) {
      await sendMessage(
        chatId,
        "🎉 <b>Pembayaran terverifikasi!</b>\n\nPesanan <b>" + code + "</b> sudah di-ACC.\nAkun website kamu sekarang <b>PREMIUM AKTIF</b> — silakan login kembali di website dan nikmati fitur premium."
      );
    }
  } else {
    await adminApi("PATCH", "/api/orders/" + code, { status: "dibatalkan" });
    await callApi("answerCallbackQuery", { callback_query_id: query.id, text: "Pesanan ditolak." });
    if (message) {
      await callApi("editMessageText", {
        chat_id: message.chat.id,
        message_id: message.message_id,
        parse_mode: "HTML",
        text: "❌ <b>Pesanan " + code + " DITOLAK</b>"
      });
    }
    if (chatId) {
      await sendMessage(chatId, "Maaf, bukti pembayaran untuk pesanan <b>" + code + "</b> tidak valid. Hubungi admin untuk info lebih lanjut.");
    }
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  await rememberChat(msg.chat);

  if (msg.photo && msg.photo.length) return handlePhoto(msg);

  if (text.startsWith("/start")) {
    const payload = text.split(" ")[1];
    if (payload) {
      await setPending(chatId, payload.toUpperCase());
      return sendMessage(
        chatId,
        "Kode pesanan <b>" + payload.toUpperCase() + "</b> tercatat.\n\nSekarang kirim <b>foto bukti pembayaran</b> kamu di chat ini."
      );
    }
    return sendMessage(
      chatId,
      "👋 Selamat datang di <b>Noisy Verse Payment</b>!\n\n" +
        "Cara konfirmasi pembayaran:\n1. Buat kode pesanan di website\n2. Bayar via QRIS / transfer\n3. Kirim /order KODE di sini\n4. Kirim foto bukti bayar\n\nSetelah admin verifikasi, akun premium kamu aktif otomatis. 🚀"
    );
  }

  if (text.startsWith("/order")) {
    const code = text.split(" ")[1];
    if (!code) return sendMessage(chatId, "Format: /order KODEPESANAN\nContoh: /order NV-878FA9");
    await setPending(chatId, code.toUpperCase());
    return sendMessage(chatId, "Kode <b>" + code.toUpperCase() + "</b> tercatat. Sekarang kirim foto bukti pembayaran.");
  }

  return sendMessage(chatId, "Kirim /order KODEPESANAN lalu kirim foto bukti bayar kamu.");
}

function extractCode(caption) {
  const m = caption.match(/NV-[A-Z0-9]{6}/i);
  return m ? m[0].toUpperCase() : null;
}

// Proses satu update (dipakai polling & webhook).
async function processUpdate(update) {
  if (!update) return;
  try {
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
  } catch (e) {
    console.error("[bot] gagal proses update:", e.message);
  }
}

async function poll() {
  while (true) {
    try {
      const data = await callApi("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          await processUpdate(update);
        }
      }
    } catch (err) {
      console.error("[bot] polling error:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

function start() {
  if (!TELEGRAM_TOKEN || !TELEGRAM_OWNER_ID) {
    console.log("[bot] Telegram bot NONAKTIF — set TELEGRAM_BOT_TOKEN & TELEGRAM_OWNER_ID untuk mengaktifkan.");
    return;
  }
  console.log("[bot] Telegram bot aktif, mulai polling...");
  loadBotUsername().then(() => {
    if (botUsername) console.log("[bot] Bot: @" + botUsername);
  });
  poll();
}

// Daftarkan webhook Telegram ke URL publik (dipanggil sekali saat setup produksi).
async function setWebhook(url, secret) {
  return callApi("setWebhook", {
    url,
    secret_token: secret || undefined,
    allowed_updates: ["message", "callback_query"],
  });
}

async function getKnownChatCount() {
  const { chats } = await loadState();
  return Object.keys(chats).length;
}

module.exports = {
  start,
  processUpdate,
  setWebhook,
  getBotUsername: () => botUsername,
  getKnownChatCount,
  broadcast,
};
