/**
 * set-webhook.js — Daftarkan webhook Telegram ke deployment produksi.
 *
 * Jalankan SEKALI setelah deploy ke Vercel & env sudah di-set:
 *   PUBLIC_BASE_URL=https://<domain-vercel-kamu> \
 *   TELEGRAM_BOT_TOKEN=... \
 *   [TELEGRAM_WEBHOOK_SECRET=...] \
 *   npm run set-webhook
 *
 * Untuk kembali ke mode polling (dev lokal), hapus webhook:
 *   node backend/set-webhook.js --delete
 */
const bot = require("./bot");

(async () => {
  const remove = process.argv.includes("--delete");
  const base =
    process.env.PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "");

  if (remove) {
    const r = await bot.setWebhook("");
    console.log("[set-webhook] webhook dihapus:", JSON.stringify(r));
    return;
  }

  if (!base) {
    console.error("[set-webhook] Set PUBLIC_BASE_URL (mis. https://noisyverse.vercel.app) dulu.");
    process.exit(1);
  }
  const url = base.replace(/\/+$/, "") + "/api/telegram/webhook";
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const r = await bot.setWebhook(url, secret);
  console.log("[set-webhook] setWebhook ->", url);
  console.log("[set-webhook] respons Telegram:", JSON.stringify(r));
})().catch((e) => {
  console.error("[set-webhook] gagal:", e.message);
  process.exit(1);
});
