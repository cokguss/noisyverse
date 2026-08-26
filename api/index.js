/**
 * api/index.js — Entrypoint serverless Vercel.
 *
 * Vercel menjalankan file di folder api/ sebagai serverless function. File ini
 * hanya mengekspor app Express dari backend/server.js (yang TIDAK memanggil
 * app.listen saat di-require). Semua rute /api/* dan /api/telegram/webhook
 * dilayani lewat function ini; file statis (html/css/js/assets) dilayani Vercel.
 */
module.exports = require("../backend/server.js");
