(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  let paket = params.get("paket") || "";

  const planNameEl = document.getElementById("payPlanName");
  const planPriceEl = document.getElementById("payPlanPrice");
  let basePriceLabel = "";
  let appliedCoupon = null;

  // Load real packages from the server so name & price always match /api/packages.
  fetch("/api/packages")
    .then((r) => r.json())
    .then((data) => {
      if (!data.ok || !Array.isArray(data.packages) || !data.packages.length) return;
      const purchasable = data.packages.filter((p) => p.purchasable !== false && p.price !== "Rp0");
      let pkg = data.packages.find((p) => p.id === paket);
      if (!pkg || pkg.purchasable === false || pkg.price === "Rp0") {
        pkg = purchasable.find((p) => p.featured) || purchasable[0] || data.packages[0];
      }
      if (!pkg) return;
      paket = pkg.id;
      planNameEl.textContent = pkg.name;
      const priceValue = pkg.price === "Rp0" ? "Gratis" : pkg.price;
      basePriceLabel = priceValue + (pkg.durationDays ? " / " + pkg.durationDays + " hari" : "");
      planPriceEl.textContent = basePriceLabel;
      resetCoupon();
    })
    .catch(() => {});

  let orderCode = null;
  let botUsername = null;
  let me = null;

  const createBtn = document.getElementById("createOrderBtn");
  const payTg = document.getElementById("payTg");
  const loginNotice = document.getElementById("loginNotice");

  fetch("/api/config")
    .then((r) => r.json())
    .then((c) => { if (c.ok && c.botUsername) botUsername = c.botUsername; })
    .catch(() => {});

  function renderAuth() {
    if (!me) {
      loginNotice.hidden = false;
      createBtn.disabled = true;
      return;
    }
    loginNotice.hidden = true;
    if (me.unlimited || me.dev) {
      createBtn.disabled = true;
      createBtn.innerHTML = '<i class="ph-fill ph-shield-star"></i> Akun developer tidak dapat membeli paket';
      payTg.disabled = true;
      payTg.value = "@" + me.username;
      return;
    }
    if (me.packageActive) {
      createBtn.disabled = true;
      const until = me.packageExpiresAt
        ? new Date(me.packageExpiresAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })
        : "";
      createBtn.innerHTML = '<i class="ph-fill ph-check-circle"></i> Paket aktif s/d ' + until;
      codeBox.hidden = false;
      codeBox.classList.remove("is-error");
      codeBox.innerHTML = "<i class='ph-fill ph-info'></i> Paket kamu masih aktif sampai " + until + ". Beli lagi setelah masa aktif habis.";
      payTg.disabled = true;
      payTg.value = "@" + me.username;
      return;
    }
    if (!payTg.value) payTg.value = "@" + me.username;
  }

  fetch("/api/auth/me")
    .then((r) => r.json())
    .then((data) => { if (data.ok) { me = data.user; renderAuth(); } })
    .catch(() => renderAuth());

  /* ---------- PAYMENT METHODS (dynamic) ---------- */
  async function loadPaymentMethods() {
    const wrap = document.getElementById("payMethods");
    try {
      const res = await fetch("/api/payments");
      const data = await res.json();
      if (!data.ok || !data.payments.length) {
        wrap.innerHTML =
          '<div class="pay-method"><div class="pay-method-head">' +
          '<i class="ph-fill ph-warning-circle"></i> Metode pembayaran belum tersedia</div>' +
          '<div class="bank-row"><span>Hubungi admin via Telegram untuk cara bayar.</span></div></div>';
        return;
      }
      wrap.innerHTML = "";
      for (const p of data.payments) {
        const div = document.createElement("div");
        div.className = "pay-method" + (p.imageUrl ? " qris-method qris-upload" : "");
        const headIcon = p.type === "bank" ? "ph-bank" : p.type === "ewallet" ? "ph-wallet" : "ph-qr-code";
        const logo = window.PaymentBrands
          ? window.PaymentBrands.logoHtml(p.name, "md")
          : '<i class="ph-fill ' + headIcon + '"></i>';
        if (p.imageUrl) {
          // Gambar QRIS yang diupload sudah kartu lengkap — tampilkan apa adanya (rasio utuh), tanpa frame ganda.
          div.innerHTML =
            '<div class="pay-method-head">' + logo + " " + escapeHtml(p.name) + "</div>" +
            '<div class="qris-frame">' +
              '<img src="' + escapeHtml(p.imageUrl) + '" alt="QR ' + escapeHtml(p.name) + '" />' +
              '<div class="qris-frame-foot">a.n. <b>' + escapeHtml(p.accountName) + "</b>" +
                (p.accountNumber ? " · " + escapeHtml(p.accountNumber) : "") + "</div>" +
            "</div>";
        } else if (p.type === "qris") {
          // Tanpa gambar QRIS yang diupload, tidak ada QR yang sah untuk dipindai.
          // Dulu di sini digambar QR contoh (data=NOISY-VERSE) — pengunjung bisa
          // memindainya dan uangnya tidak sampai ke mana pun. Jadi beri instruksi.
          div.innerHTML =
            '<div class="pay-method-head">' + logo + " " + escapeHtml(p.name) + "</div>" +
            '<div class="bank-row"><span>a.n. ' + escapeHtml(p.accountName) +
              " · minta QR terbaru ke admin via Telegram</span></div>";
        } else {
          div.innerHTML =
            '<div class="pay-method-head">' + logo + " " + escapeHtml(p.name) + "</div>" +
            '<div class="bank-row"><span>' + escapeHtml(p.accountName) + "</span><strong>" + escapeHtml(p.accountNumber) + "</strong></div>";
        }
        wrap.appendChild(div);
      }
    } catch {
      wrap.innerHTML =
        '<div class="pay-method"><div class="pay-method-head">' +
        '<i class="ph-fill ph-warning-circle"></i> Gagal memuat metode pembayaran</div>' +
        '<div class="bank-row"><span>Muat ulang halaman, atau hubungi admin via Telegram.</span></div></div>';
    }
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = String(str == null ? "" : str);
    return d.innerHTML;
  }

  loadPaymentMethods();

  const codeBox = document.getElementById("payCodeBox");

  /* ---------- COUPON ---------- */
  const couponInput = document.getElementById("couponInput");
  const applyCouponBtn = document.getElementById("applyCouponBtn");
  const couponMsg = document.getElementById("couponMsg");

  function resetCoupon() {
    appliedCoupon = null;
    if (couponMsg) { couponMsg.hidden = true; couponMsg.className = "coupon-msg"; couponMsg.innerHTML = ""; }
    if (planPriceEl && basePriceLabel) planPriceEl.textContent = basePriceLabel;
  }

  if (applyCouponBtn) {
    applyCouponBtn.addEventListener("click", async () => {
      const code = (couponInput.value || "").trim();
      if (!code) { resetCoupon(); return; }
      applyCouponBtn.disabled = true;
      try {
        const res = await fetch("/api/coupons/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, packageId: paket })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Kode kupon tidak valid.");
        appliedCoupon = data.code;
        planPriceEl.innerHTML = "<s class='coupon-old'>" + escapeHtml(basePriceLabel) + "</s> " +
          "<span class='coupon-applied'>" + escapeHtml(data.finalLabel) + "</span> " +
          "<span class='coupon-badge'>" + escapeHtml(data.code) + " " + escapeHtml(data.discountLabel) + "</span>";
        couponMsg.hidden = false;
        couponMsg.className = "coupon-msg is-ok";
        couponMsg.innerHTML = "<i class='ph-fill ph-check-circle'></i> Kupon diterapkan! Hemat dari " + escapeHtml(data.finalLabel) + ".";
      } catch (err) {
        resetCoupon();
        couponMsg.hidden = false;
        couponMsg.className = "coupon-msg is-error";
        couponMsg.innerHTML = "<i class='ph-fill ph-warning-circle'></i> " + escapeHtml(err.message);
      } finally {
        applyCouponBtn.disabled = false;
      }
    });
  }

  document.getElementById("createOrderBtn").addEventListener("click", async () => {
    if (!me) return;
    if (me.unlimited || me.dev) return;
    const tgRaw = payTg.value.trim().replace(/^@+/, "");
    const lang = (window.NoisyLang && window.NoisyLang.dict().lang) || "id";
    if (!tgRaw) {
      codeBox.hidden = false;
      codeBox.classList.add("is-error");
      codeBox.innerHTML = "<i class='ph-fill ph-warning-circle'></i> " +
        (lang === "en" ? "Please fill in your Telegram username first." : "Isi username Telegram dulu ya.");
      return;
    }
    const tg = "@" + tgRaw;

    createBtn.disabled = true;
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "website", target: "paket:" + paket, telegram: tg, coupon: appliedCoupon })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Gagal membuat pesanan.");

      orderCode = data.code;
      document.getElementById("payCode").textContent = orderCode;
      codeBox.hidden = false;
      codeBox.classList.remove("is-error");

      const confirmBot = document.getElementById("confirmBot");
      const confirmChat = document.getElementById("confirmChat");
      if (botUsername) {
        confirmBot.href = "https://t.me/" + botUsername + "?start=" + orderCode;
        confirmBot.hidden = false;
      } else {
        confirmChat.hidden = false;
      }
    } catch (err) {
      codeBox.hidden = false;
      codeBox.classList.add("is-error");
      codeBox.innerHTML = "<i class='ph-fill ph-warning-circle'></i> " + err.message;
    } finally {
      createBtn.disabled = false;
    }
  });
})();
