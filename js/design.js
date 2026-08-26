(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(location.search);
  const slug = (params.get("slug") || "").trim();
  const target = (params.get("target") || "").trim();

  let me = null;
  let mdEn = "";
  const cache = { en: "", id: "" };
  let currentLang = "en";
  let translating = false;

  /* ---------- mini markdown renderer (dari prd.js) ---------- */
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function inline(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])_([^_]+)_(?=$|[\s).,])/, "$1<em>$2</em>");
  }

  function renderMarkdown(md) {
    const rows = escapeHtml(md).split("\n");
    let html = "";
    let inUl = false, inOl = false, inCode = false;
    let table = [];

    const closeLists = () => {
      if (inUl) { html += "</ul>"; inUl = false; }
      if (inOl) { html += "</ol>"; inOl = false; }
    };
    const flushTable = () => {
      if (!table.length) return;
      let t = "<table><thead><tr>";
      table[0].forEach((c) => { t += "<th>" + inline(c) + "</th>"; });
      t += "</tr></thead><tbody>";
      table.slice(1).forEach((row) => {
        if (row.join("").replace(/[-:\s]/g, "") === "") return;
        t += "<tr>" + row.map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>";
      });
      t += "</tbody></table>";
      html += t;
      table = [];
    };

    for (const raw of rows) {
      const line = raw.trimEnd();
      if (/^```/.test(line.trim())) {
        flushTable(); closeLists();
        if (!inCode) { html += "<pre class='ds-code'><code>"; inCode = true; }
        else { html += "</code></pre>"; inCode = false; }
        continue;
      }
      if (inCode) { html += line + "\n"; continue; }
      if (/^\|/.test(line)) {
        closeLists();
        table.push(line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        continue;
      }
      flushTable();
      if (/^###\s/.test(line)) { closeLists(); html += "<h3>" + inline(line.slice(4)) + "</h3>"; }
      else if (/^##\s/.test(line)) { closeLists(); html += "<h2>" + inline(line.slice(3)) + "</h2>"; }
      else if (/^#\s/.test(line)) { closeLists(); html += "<h1>" + inline(line.slice(2)) + "</h1>"; }
      else if (/^---+$/.test(line.trim())) { closeLists(); html += "<hr>"; }
      else if (/^&gt;\s?/.test(line)) { closeLists(); html += "<blockquote>" + inline(line.replace(/^&gt;\s?/, "")) + "</blockquote>"; }
      else if (/^[-*]\s/.test(line)) {
        if (inOl) closeLists();
        if (!inUl) { closeLists(); html += "<ul>"; inUl = true; }
        html += "<li>" + inline(line.slice(2)) + "</li>";
      }
      else if (/^\d+\.\s/.test(line)) {
        if (inUl) closeLists();
        if (!inOl) { closeLists(); html += "<ol>"; inOl = true; }
        html += "<li>" + inline(line.replace(/^\d+\.\s/, "")) + "</li>";
      }
      else if (line.trim() === "") { closeLists(); }
      else { closeLists(); html += "<p>" + inline(line) + "</p>"; }
    }
    if (inCode) html += "</code></pre>";
    flushTable();
    closeLists();
    return html;
  }

  /* ---------- PLACEHOLDER_REST ---------- */

  function showError(msg) {
    $("dsSkeleton").hidden = true;
    $("dsBody").hidden = true;
    const box = $("dsError");
    box.textContent = msg;
    box.hidden = false;
  }

  function friendly(err) {
    if (err.message === "Failed to fetch" || err.message === "Load failed") {
      return "Tidak bisa terhubung ke server. Jalankan backend (npm start di folder backend) lalu buka lewat http://localhost:3000/coba.html";
    }
    return err.message;
  }

  function canDownload() {
    return !!(me && (me.unlimited || me.dev || me.packageActive));
  }

  function updateDownloadGate() {
    const btn = $("dsDownloadBtn");
    if (canDownload()) {
      btn.disabled = false;
      btn.title = "Unduh design.md";
      btn.innerHTML = '<i class="ph ph-download-simple"></i> Unduh';
    } else {
      btn.disabled = true;
      btn.title = "Unduh design.md tersedia di paket Premium / Unlimited — user gratis bisa Salin";
      btn.innerHTML = '<i class="ph ph-lock-simple"></i> Unduh (Premium)';
    }
  }

  function setLangBtns(lang) {
    currentLang = lang;
    $("dsLangEn").classList.toggle("active", lang === "en");
    $("dsLangId").classList.toggle("active", lang === "id");
  }

  function render(md) {
    $("dsBody").innerHTML = renderMarkdown(md);
  }

  function downloadName() {
    const base = slug || "design";
    return base.replace(/[^a-z0-9-]/gi, "-") + "-design.md";
  }

  /* ---------- actions ---------- */
  $("dsCopyBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(cache[currentLang] || mdEn);
      $("dsCopyBtn").innerHTML = '<i class="ph ph-check"></i> Tersalin';
      setTimeout(() => { $("dsCopyBtn").innerHTML = '<i class="ph ph-copy-simple"></i> Salin'; }, 1800);
    } catch {}
  });

  $("dsDownloadBtn").addEventListener("click", () => {
    if (!canDownload()) return;
    const md = cache[currentLang] || mdEn;
    const blob = new Blob(["﻿" + md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  $("dsLangEn").addEventListener("click", () => {
    if (currentLang === "en") return;
    setLangBtns("en");
    render(cache.en);
  });

  $("dsLangId").addEventListener("click", async () => {
    if (translating || currentLang === "id") return;
    if (cache.id) { setLangBtns("id"); render(cache.id); return; }
    translating = true;
    const btn = $("dsLangId");
    const prev = btn.textContent;
    btn.disabled = true; btn.textContent = "…";
    $("dsError").hidden = true;
    try {
      const res = await fetch("/api/reverse/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: mdEn, lang: "id" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.code === "NEED_LOGIN") { location.href = loginUrl(); return; }
        throw new Error(data.error || "Gagal menerjemahkan.");
      }
      cache.id = data.text;
      setLangBtns("id");
      render(cache.id);
    } catch (err) {
      showError(friendly(err));
    } finally {
      translating = false;
      btn.disabled = false; btn.textContent = prev;
    }
  });

  function loginUrl() {
    return "login.html?next=" + encodeURIComponent(location.pathname + location.search);
  }

  /* ---------- init ---------- */
  (async () => {
    if (!slug && !target) {
      showError("Parameter tidak lengkap. Buka halaman ini lewat tombol \"Lihat Design System\" di halaman Coba.");
      return;
    }
    try {
      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) {
        const md = await meRes.json();
        if (md.ok) me = md.user;
      }
    } catch {}
    updateDownloadGate();

    const qs = new URLSearchParams();
    if (slug) qs.set("slug", slug);
    if (target) qs.set("target", target);
    if (slug) $("dsSubtitle").textContent = "Design system untuk: " + slug;

    try {
      const res = await fetch("/api/reverse/design?" + qs.toString());
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.code === "NEED_LOGIN") { location.href = loginUrl(); return; }
        throw new Error(data.error || "Gagal memuat design system.");
      }
      mdEn = data.markdown;
      cache.en = data.markdown;
      $("dsSourceLabel").textContent = data.source === "ai" ? "design.md (AI generated)" : "design.md";
      $("dsSkeleton").hidden = true;
      $("dsBody").hidden = false;
      $("dsActions").hidden = false;
      setLangBtns("en");
      render(mdEn);
    } catch (err) {
      showError(friendly(err));
    }
  })();
})();
