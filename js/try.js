(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /* ---------- AUTH ---------- */
  let me = null;

  function renderAuthState() {
    const guest = $("authGuest");
    const user = $("authUser");
    if (me) {
      guest.hidden = true;
      user.hidden = false;
      $("authName").textContent = me.username;
      const chip = $("trialChip");
      // Reverse (GitVerse) tak terbatas untuk akun developer atau paket Unlimited.
      if (me.unlimited || me.reverseQuota >= 999999) {
        chip.textContent = "GitVerse: Unlimited ∞";
        chip.className = "trial-chip available";
      } else {
        const used = me.reverseUsed || (me.freeTrialUsed ? 1 : 0);
        const quota = me.reverseQuota === undefined ? 1 : me.reverseQuota;
        const sisa = Math.max(0, quota - used);
        chip.textContent = sisa > 0 ? "GitVerse: " + sisa + "/" + quota + " tersisa" : "Kuota GitVerse: habis";
        chip.className = "trial-chip " + (sisa > 0 ? "available" : "used");
      }
      const banner = $("premiumBanner");
      if (banner) {
        if (me.unlimited) {
          banner.hidden = false;
          banner.className = "premium-banner";
          banner.innerHTML = '<i class="ph-fill ph-shield-star"></i> Akun Developer — semua fitur <strong>Unlimited ∞</strong>';
        } else if (me.packageActive && me.package) {
          banner.hidden = false;
          banner.className = "premium-banner";
          const until = new Date(me.package.expiresAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
          banner.innerHTML = '<i class="ph-fill ph-crown-simple"></i> Paket <strong>' + escapeHtml(me.package.type) + "</strong> aktif s/d <strong>" + until + "</strong>";
        } else {
          banner.hidden = true;
        }
      }
    } else {
      guest.hidden = false;
      user.hidden = true;
      const banner = $("premiumBanner");
      if (banner) banner.hidden = true;
    }
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = String(str == null ? "" : str);
    return d.innerHTML;
  }

  $("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    me = null;
    renderAuthState();
  });

  (async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        if (data.ok) { me = data.user; renderAuthState(); }
      }
    } catch {}
  })();

  /* ---------- TYPE SWITCHER ---------- */
  let currentType = "repo";
  const hints = {
    repo: "Contoh: vercel/next.js · facebook/react",
    website: "Contoh: https://linear.app · https://vercel.com"
  };
  const placeholders = {
    repo: "owner/repo",
    website: "https://contoh-website.com"
  };
  const examples = {
    repo: ["vercel/next.js", "facebook/react", "supabase/supabase"],
    website: ["https://linear.app", "https://vercel.com", "https://stripe.com"]
  };

  function renderExamples() {
    const box = $("tryExamples");
    if (!box) return;
    const list = examples[currentType] || [];
    box.innerHTML =
      '<span class="try-examples-label">Coba contoh:</span>' +
      list.map((v) => '<button class="ex-chip" type="button" data-value="' + escapeHtml(v) + '">' + escapeHtml(v) + "</button>").join("");
    box.querySelectorAll(".ex-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        $("targetInput").value = chip.dataset.value;
        $("targetInput").focus();
      });
    });
  }

  function applyType(type) {
    currentType = type;
    const isSoon = type === "3d";
    const inputRow = $("tryInputRow");
    const hint = $("tryHint");
    const exBox = $("tryExamples");
    const soon = $("trySoon");
    if (inputRow) inputRow.hidden = isSoon;
    if (hint) hint.hidden = isSoon;
    if (exBox) exBox.hidden = isSoon;
    if (soon) soon.hidden = !isSoon;
    if (isSoon) return;
    $("targetInput").placeholder = placeholders[type] || "";
    $("tryHint").textContent = hints[type] || "";
    renderExamples();
  }

  document.querySelectorAll(".type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".type-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      applyType(btn.dataset.type);
    });
  });

  applyType(currentType);

  /* ---------- REVERSE ---------- */
  const reverseBtn = $("reverseBtn");
  const resultBox = $("resultBox");
  const errorBox = $("errorBox");
  const promptOutput = $("promptOutput");

  /* Hasil reverse selalu dalam bahasa Inggris dari GitReverse.
     Simpan versi asli (en) + cache terjemahan (id) supaya toggle instan. */
  const langCache = { en: "", id: "" };
  let currentLang = "en";
  let translating = false;

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }

  function friendly(err) {
    if (err.message === "Failed to fetch" || err.message === "Load failed") {
      return "Tidak bisa terhubung ke server. Jalankan backend (npm start di folder backend) lalu buka lewat http://localhost:3000/coba.html";
    }
    return err.message;
  }

  function refreshMe() {
    return fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => { if (data.ok) { me = data.user; renderAuthState(); } })
      .catch(() => {});
  }

  function setLoading(on) {
    reverseBtn.disabled = on;
    reverseBtn.innerHTML = on
      ? '<i class="ph ph-circle-notch" style="animation: demo-spin 0.8s linear infinite; display: inline-block;"></i> Memproses...'
      : '<i class="ph ph-magic-wand"></i> Reverse';
    const skel = $("reverseSkeleton");
    if (on) {
      errorBox.hidden = true;
      resultBox.hidden = false;
      $("resultActions").hidden = true;
      promptOutput.hidden = true;
      if (skel) skel.hidden = false;
    } else {
      if (skel) skel.hidden = true;
      promptOutput.hidden = false;
      $("resultActions").hidden = false;
    }
  }

  function validateTarget(type, target) {
    if (type === "website") {
      let u;
      try { u = new URL(/^https?:\/\//i.test(target) ? target : "https://" + target); }
      catch { return "URL tidak valid. Contoh: https://linear.app"; }
      if (!/^https?:$/i.test(u.protocol)) return "URL harus diawali http:// atau https://";
      if (!/\./.test(u.hostname) || /\s/.test(u.hostname)) return "Domain tidak valid. Contoh: https://vercel.com";
      return null;
    }
    // repo: terima "owner/repo" atau URL github
    const m = target.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/,"");
    if (!/^[\w.-]+\/[\w.-]+$/.test(m)) return "Format repo tidak valid. Contoh: expressjs/express atau https://github.com/vercel/next.js";
    return null;
  }

  reverseBtn.addEventListener("click", async () => {
    if (currentType === "3d") return;
    const target = $("targetInput").value.trim();
    errorBox.hidden = true;
    resultBox.hidden = true;
    if (!target) return showError("Isi dulu URL atau repo-nya.");
    const invalid = validateTarget(currentType, target);
    if (invalid) return showError(invalid);

    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetch("/api/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: currentType, target }),
        signal: controller.signal
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.code === "NEED_LOGIN") {
          me = null;
          renderAuthState();
          location.href = "login.html?next=%2Fcoba.html";
          return;
        }
        if (data.code === "TRIAL_USED" || data.code === "QUOTA_USED") {
          await refreshMe();
          setLoading(false);
          location.href = "bayar.html";
          return;
        }
        throw new Error(data.error || "Gagal memproses permintaan.");
      }

      if (me) {
        me.reverseUsed = data.reverseUsed;
        me.reverseQuota = data.reverseQuota;
        renderAuthState();
      }
      langCache.en = data.prompt;
      langCache.id = "";
      currentLang = "en";
      setLang("en");
      promptOutput.textContent = data.prompt;
      // Design System: buka halaman internal (proxy GitReverse / AI fallback). Hanya untuk website.
      const dLink = $("designLink");
      const slug = data.designSlug || (data.designPath ? data.designPath.replace(/^\/+/, "").replace(/^designs\//, "") : "");
      const showDesign = currentType === "website" && (data.designPath || data.designSlug);
      dLink.hidden = !showDesign;
      if (showDesign) {
        const qs = new URLSearchParams();
        if (slug) qs.set("slug", slug);
        qs.set("target", target);
        dLink.href = "design.html?" + qs.toString();
      }
      setLoading(false);
      resultBox.hidden = false;
    } catch (err) {
      resultBox.hidden = true;
      if (err.name === "AbortError") {
        showError("Proses terlalu lama (timeout). Servernya mungkin sibuk — coba lagi sebentar lagi.");
      } else {
        showError(friendly(err));
      }
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  });

  function setLang(lang) {
    currentLang = lang;
    const enBtn = $("langEnBtn");
    const idBtn = $("langIdBtn");
    if (enBtn) enBtn.classList.toggle("active", lang === "en");
    if (idBtn) idBtn.classList.toggle("active", lang === "id");
  }

  async function switchLang(lang) {
    if (translating || lang === currentLang) return;
    // Versi sudah ada di cache -> tampilkan langsung.
    if (langCache[lang]) {
      setLang(lang);
      promptOutput.textContent = langCache[lang];
      return;
    }
    if (lang === "en") { setLang("en"); promptOutput.textContent = langCache.en; return; }

    // Perlu menerjemahkan EN -> ID.
    translating = true;
    const idBtn = $("langIdBtn");
    const prevLabel = idBtn ? idBtn.textContent : "ID";
    if (idBtn) { idBtn.disabled = true; idBtn.textContent = "…"; }
    errorBox.hidden = true;
    try {
      const res = await fetch("/api/reverse/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: langCache.en, lang: "id" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.code === "NEED_LOGIN") { location.href = "login.html?next=%2Fcoba.html"; return; }
        throw new Error(data.error || "Gagal menerjemahkan.");
      }
      langCache.id = data.text;
      setLang("id");
      promptOutput.textContent = data.text;
    } catch (err) {
      showError(friendly(err));
    } finally {
      translating = false;
      if (idBtn) { idBtn.disabled = false; idBtn.textContent = prevLabel; }
    }
  }

  $("langEnBtn").addEventListener("click", () => switchLang("en"));
  $("langIdBtn").addEventListener("click", () => switchLang("id"));

  $("copyBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(promptOutput.textContent);
      $("copyBtn").innerHTML = '<i class="ph ph-check"></i> Tersalin';
      setTimeout(() => { $("copyBtn").innerHTML = '<i class="ph ph-copy-simple"></i> Salin'; }, 1800);
    } catch {}
  });
})();
