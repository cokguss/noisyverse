(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let currentMd = "";
  let me = null;

  /* ---------- AUTH ---------- */

  function renderAuthState() {
    const guest = $("authGuest");
    const user = $("authUser");    if (me) {
      guest.hidden = true;
      user.hidden = false;
      $("authName").textContent = me.username;
      const chip = $("prdQuotaChip");
      if (me.unlimited) {
        chip.textContent = "Kuota PRD: Unlimited ∞";
        chip.className = "trial-chip available";
      } else if (me.packageActive) {
        chip.textContent = "Premium aktif ✓";
        chip.className = "trial-chip available";
      } else {
        const used = me.prdUsed || 0;
        const quota = me.prdQuota === undefined ? 1 : me.prdQuota;
        const sisa = Math.max(0, quota - used);
        chip.textContent = sisa > 0 ? "Kuota PRD: " + sisa + " tersisa" : "Kuota PRD: habis";
        chip.className = "trial-chip " + (sisa > 0 ? "available" : "used");
      }
      updateDownloadGate();
    } else {
      guest.hidden = false;
      user.hidden = true;
    }
  }

  $("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    me = null;
    renderAuthState();
    renderQuotaLine();
    $("projectsPanel").hidden = true;
  });

  (async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          me = data.user;
          renderAuthState();
          renderQuotaLine();
          await loadProjects();
          startProjectPolling();
        }
      }
    } catch {}
  })();

  /* ---------- STACK MODE ---------- */
  $("fStackMode").addEventListener("change", () => {
    $("fStackCustom").hidden = $("fStackMode").value !== "custom";
  });

  const STR = {
    id: {
      docTitle: "Dokumen Persyaratan Produk (PRD)",
      overview: "1. Ringkasan Produk",
      background: "2. Latar Belakang & Masalah",
      goals: "3. Tujuan & Non-Tujuan",
      goalsSub: "3.1 Tujuan",
      goalsSub2: "3.2 Non-Tujuan (di luar lingkup)",
      audience: "4. Target Pengguna",
      stories: "5. User Stories",
      features: "6. Fitur & Persyaratan Fungsional",
      nfr: "7. Persyaratan Non-Fungsional",
      uiux: "8. Panduan UI/UX",
      tech: "9. Teknologi & Stack",
      metrics: "10. Metrik Sukses (KPI)",
      risks: "11. Risiko & Mitigasi",
      milestones: "12. Milestone Rilis",
      openq: "13. Pertanyaan Terbuka",
      problem: "Masalah yang diselesaikan",
      solution: "Solusi yang ditawarkan",
      must: "Wajib (Must have)",
      should: "Sebaiknya (Should have)",
      could: "Bisa (Could have)",
      asA: "Sebagai",
      iWant: "saya ingin",
      soThat: "sehingga",
      perf: "Performa: aplikasi responsif, waktu muat utama < 3 detik.",
      security: "Keamanan: data pengguna disimpan dengan aman, tidak dibagikan ke pihak ketiga.",
      usability: "Kemudahan: antarmuka sederhana, dapat dipakai tanpa pelatihan khusus.",
      compat: "Kompatibilitas: berfungsi baik di perangkat mobile maupun desktop.",
      uiClean: "Desain bersih dan modern dengan hierarki visual yang jelas.",
      uiMobile: "Responsif penuh, diprioritaskan untuk perangkat mobile.",
      uiFeedback: "Setiap aksi pengguna memiliki umpan balik visual (loading, sukses, error).",
      uiAccess: "Kontras warna memenuhi standar aksesibilitas WCAG AA.",
      kpi1: "Jumlah pengguna aktif mingguan (WAU)",
      kpi2: "Tingkat penyelesaian tugas inti (task success rate)",
      kpi3: "Skor kepuasan pengguna (survei/rating minimal 4/5)",
      kpi4: "Retensi pengguna 30 hari",
      risk1: "Lingkup fitur terlalu luas",
      risk1m: "Prioritas ketat dengan metode MoSCoW, rilis bertahap.",
      risk2: "Waktu pengembangan meleset",
      risk2m: "Pembagian milestone mingguan dengan review berkala.",
      risk3: "Adopsi pengguna rendah di awal",
      risk3m: "Uji coba dengan kelompok pengguna awal (early adopters) sebelum rilis luas.",
      ms1: "Fase 1 — Fondasi: struktur proyek, desain sistem, fitur inti.",
      ms2: "Fase 2 — Fitur utama lengkap & pengujian internal.",
      ms3: "Fase 3 — Beta ke pengguna terbatas, perbaikan masukan.",
      ms4: "Fase 4 — Rilis publik & iterasi berkelanjutan.",
      oq1: "Model monetisasi apa yang paling sesuai?",
      oq2: "Platform mana yang diprioritaskan saat peluncuran pertama?",
      oq3: "Apakah perlu integrasi pihak ketiga pada versi awal?",
      errNama: "Isi dulu nama produknya.",
      errPrompt: "Tulis dulu deskripsi atau prompt idenya.",
      version: "Versi",
      generated: "Dibuat otomatis oleh",
      date: "Tanggal",
      product: "Produk",
      type: "Jenis",
      audienceLabel: "Audiens",
      primaryUser: "Pengguna utama produk"
    },
    en: {
      docTitle: "Product Requirements Document (PRD)",
      overview: "1. Product Overview",
      background: "2. Background & Problem",
      goals: "3. Goals & Non-Goals",
      goalsSub: "3.1 Goals",
      goalsSub2: "3.2 Non-Goals (out of scope)",
      audience: "4. Target Users",
      stories: "5. User Stories",
      features: "6. Features & Functional Requirements",
      nfr: "7. Non-Functional Requirements",
      uiux: "8. UI/UX Guidelines",
      tech: "9. Technology & Stack",
      metrics: "10. Success Metrics (KPIs)",
      risks: "11. Risks & Mitigation",
      milestones: "12. Release Milestones",
      openq: "13. Open Questions",
      problem: "Problem being solved",
      solution: "Proposed solution",
      must: "Must have",
      should: "Should have",
      could: "Could have",
      asA: "As a",
      iWant: "I want to",
      soThat: "so that",
      perf: "Performance: responsive app, main page load under 3 seconds.",
      security: "Security: user data stored securely, never shared with third parties.",
      usability: "Usability: simple interface, usable without special training.",
      compat: "Compatibility: works well on both mobile and desktop devices.",
      uiClean: "Clean, modern design with clear visual hierarchy.",
      uiMobile: "Fully responsive, mobile-first approach.",
      uiFeedback: "Every user action has visual feedback (loading, success, error states).",
      uiAccess: "Color contrast meets WCAG AA accessibility standards.",
      kpi1: "Weekly active users (WAU)",
      kpi2: "Core task completion rate",
      kpi3: "User satisfaction score (survey/rating of at least 4/5)",
      kpi4: "30-day user retention",
      risk1: "Feature scope creep",
      risk1m: "Strict MoSCoW prioritization, phased releases.",
      risk2: "Development timeline slippage",
      risk2m: "Weekly milestones with regular reviews.",
      risk3: "Low early user adoption",
      risk3m: "Pilot with early adopters before wide release.",
      ms1: "Phase 1 — Foundation: project structure, system design, core features.",
      ms2: "Phase 2 — Full main features & internal testing.",
      ms3: "Phase 3 — Beta to limited users, feedback fixes.",
      ms4: "Phase 4 — Public release & continuous iteration.",
      oq1: "Which monetization model fits best?",
      oq2: "Which platform should be prioritized at first launch?",
      oq3: "Are third-party integrations needed in the initial version?",
      errNama: "Please fill in the product name.",
      errPrompt: "Please write the idea description or prompt first.",
      version: "Version",
      generated: "Auto-generated by",
      date: "Date",
      product: "Product",
      type: "Type",
      audienceLabel: "Audience",
      primaryUser: "Primary user of the product"
    }
  };

  function lines(value) {
    return String(value || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  /* ---------- mini markdown renderer (preview only) ---------- */
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function inline(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])_([^_]+)_(?=$|[\s).,])/, "$1<em>$2</em>");
  }

  function renderMarkdown(md) {
    const rows = escapeHtml(md).split("\n");
    let html = "";
    let inUl = false, inOl = false;
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
      else if (/^-\s/.test(line)) {
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
    flushTable();
    closeLists();
    return html;
  }

  /* ---------- PRD builder (fallback template) ---------- */
  function generate() {
    const nama = $("fNama").value.trim();
    const jenis = $("fJenis").value;
    const audiens = $("fAudiens").value.trim() || "pengguna umum";
    const prompt = $("fPrompt").value.trim();
    const fitur = lines($("fFitur").value);
    const goals = lines($("fGoal").value);
    const lang = $("fBahasa").value;
    const S = STR[lang];
    const now = new Date();
    const tanggal = now.toLocaleDateString(lang === "en" ? "en-US" : "id-ID", { day: "numeric", month: "long", year: "numeric" });

    const goalList = goals.length ? goals : (lang === "en"
      ? ["Solve the core problem efficiently.", "Deliver a delightful user experience."]
      : ["Menyelesaikan masalah inti dengan efisien.", "Menghadirkan pengalaman pengguna yang menyenangkan."]);

    const fiturList = fitur.length ? fitur : (lang === "en"
      ? ["User registration & login", "Core feature dashboard", "Settings & profile management"]
      : ["Registrasi & login pengguna", "Dashboard fitur inti", "Pengaturan & profil pengguna"]);

    const mustCount = Math.max(1, Math.ceil(fiturList.length * 0.6));
    const must = fiturList.slice(0, mustCount);
    const should = fiturList.slice(mustCount);

    const L = [];
    L.push("# " + nama + " — " + S.docTitle);
    L.push("");
    L.push("> " + S.version + " 1.0 · " + S.date + ": " + tanggal + " · " + S.generated + " **Noisy Verse PRD Generator**");
    L.push("");
    L.push("| " + S.product + " | " + S.type + " | " + S.audienceLabel + " |");
    L.push("|---|---|---|");
    L.push("| " + nama + " | " + jenis + " | " + audiens + " |");
    L.push("");
    L.push("---");
    L.push("");
    L.push("## " + S.overview);
    L.push("");
    L.push(prompt);
    L.push("");
    L.push("## " + S.background);
    L.push("");
    L.push("**" + S.problem + ":** " + (lang === "en"
      ? "The target audience currently has no simple, integrated solution for this need."
      : "Target audiens saat ini belum memiliki solusi yang sederhana dan terintegrasi untuk kebutuhan ini."));
    L.push("");
    L.push("**" + S.solution + ":** " + nama + " — " + prompt.split(".")[0] + ".");
    L.push("");
    L.push("## " + S.goals);
    L.push("");
    L.push("### " + S.goalsSub);
    L.push("");
    goalList.forEach((g) => L.push("- " + g));
    L.push("");
    L.push("### " + S.goalsSub2);
    L.push("");
    L.push(lang === "en"
      ? "- Features outside the core scope of version 1.0\n- Native platform-specific integrations (unless stated)\n- Enterprise-grade customization"
      : "- Fitur di luar lingkup inti versi 1.0\n- Integrasi spesifik platform native (kecuali disebutkan)\n- Kustomisasi tingkat enterprise");
    L.push("");
    L.push("## " + S.audience);
    L.push("");
    L.push("| Segmen | Deskripsi |");
    L.push("|---|---|");
    L.push("| " + audiens + " | " + S.primaryUser + " |");
    L.push("");
    L.push("## " + S.stories);
    L.push("");
    fiturList.forEach((f) => {
      L.push("- " + S.asA + " **" + audiens + "**, " + S.iWant + " **" + f.charAt(0).toLowerCase() + f.slice(1) + "**, " + S.soThat + " " + (lang === "en" ? "I can get the intended benefit of the product." : "saya bisa mendapatkan manfaat utama dari produk ini."));
    });
    L.push("");
    L.push("## " + S.features);
    L.push("");
    L.push("### " + S.must);
    L.push("");
    must.forEach((f, i) => L.push((i + 1) + ". **" + f + "**"));
    L.push("");
    if (should.length) {
      L.push("### " + S.should);
      L.push("");
      should.forEach((f, i) => L.push((i + 1) + ". " + f));
      L.push("");
    }
    L.push("### " + S.could);
    L.push("");
    L.push(lang === "en"
      ? "- Dark mode\n- Multi-language support\n- Public API for developers"
      : "- Mode gelap (dark mode)\n- Dukungan multi-bahasa\n- API publik untuk developer");
    L.push("");
    L.push("## " + S.nfr);
    L.push("");
    L.push("- " + S.perf);
    L.push("- " + S.security);
    L.push("- " + S.usability);
    L.push("- " + S.compat);
    L.push("");
    L.push("## " + S.uiux);
    L.push("");
    L.push("- " + S.uiClean);
    L.push("- " + S.uiMobile);
    L.push("- " + S.uiFeedback);
    L.push("- " + S.uiAccess);
    L.push("");
    L.push("## " + S.tech);
    L.push("");
    L.push(lang === "en"
      ? "- To be decided (suggestion: modern web stack such as React/Next.js + Node.js + PostgreSQL)"
      : "- Menyesuaikan (saran: stack web modern seperti React/Next.js + Node.js + PostgreSQL)");
    L.push("");
    L.push("## " + S.metrics);
    L.push("");
    L.push("- " + S.kpi1);
    L.push("- " + S.kpi2);
    L.push("- " + S.kpi3);
    L.push("- " + S.kpi4);
    L.push("");
    L.push("## " + S.risks);
    L.push("");
    L.push("| Risiko | Mitigasi |");
    L.push("|---|---|");
    L.push("| " + S.risk1 + " | " + S.risk1m + " |");
    L.push("| " + S.risk2 + " | " + S.risk2m + " |");
    L.push("| " + S.risk3 + " | " + S.risk3m + " |");
    L.push("");
    L.push("## " + S.milestones);
    L.push("");
    L.push("- " + S.ms1);
    L.push("- " + S.ms2);
    L.push("- " + S.ms3);
    L.push("- " + S.ms4);
    L.push("");
    L.push("## " + S.openq);
    L.push("");
    L.push("- " + S.oq1);
    L.push("- " + S.oq2);
    L.push("- " + S.oq3);
    L.push("");
    L.push("---");
    L.push("");
    L.push("_" + S.generated + " [Noisy Verse](https://github.com/cokguss) PRD Generator._");

    return L.join("\n");
  }

  /* ---------- UI wiring ---------- */
  function showError(msg) {
    const box = $("prdError");
    box.textContent = msg;
    box.hidden = false;
  }

  function friendly(err) {
    if (err.message === "Failed to fetch" || err.message === "Load failed") {
      return "Tidak bisa terhubung ke server. Jalankan backend (npm start di folder backend) lalu buka lewat http://localhost:3000/prd.html";
    }
    return err.message;
  }

  $("fPrompt").addEventListener("input", () => {
    $("promptCount").textContent = $("fPrompt").value.length;
  });

  function resolveStack() {
    const mode = $("fStackMode").value;
    if (mode === "custom") return $("fStackCustom").value.trim();
    if (mode === "ai") return "";
    return $("fStackMode").options[$("fStackMode").selectedIndex].text;
  }

  function buildAiPrompt() {
    const nama = $("fNama").value.trim();
    const jenis = $("fJenis").value;
    const audiens = $("fAudiens").value.trim();
    const prompt = $("fPrompt").value.trim();
    const fitur = lines($("fFitur").value);
    const goals = lines($("fGoal").value);
    const stack = resolveStack();
    const lang = $("fBahasa").value;

    const parts = [];
    parts.push("Buat dokumen PRD (Product Requirements Document) yang SANGAT LENGKAP, DETAIL, dan PROFESIONAL untuk produk berikut:");
    parts.push("");
    parts.push("Nama produk: " + nama);
    parts.push("Jenis produk: " + jenis);
    if (audiens) parts.push("Target audiens: " + audiens);
    parts.push("Deskripsi / prompt ide: " + prompt);
    if (fitur.length) parts.push("Fitur yang diinginkan:\n" + fitur.map((f) => "- " + f).join("\n"));
    if (goals.length) parts.push("Tujuan bisnis:\n" + goals.map((g) => "- " + g).join("\n"));
    if (clarifyQA.length) parts.push("Klarifikasi tambahan dari user:\n" + clarifyQA.map((qa) => "- " + qa.q + " → " + qa.a).join("\n"));
    parts.push(stack ? "Stack teknologi (wajib dipakai): " + stack : "Stack teknologi: pilihkan sendiri kombinasi stack terbaik untuk produk ini dan jelaskan alasannya.");
    parts.push("");
    parts.push(lang === "en"
      ? "Output rules: Write the ENTIRE document in English. Output raw Markdown ONLY (no explanations before/after). Must contain these sections IN ORDER: # title, metadata blockquote, product overview, background & problem, goals & non-goals, target users table, user stories list, features with MoSCoW priorities (Must/Should/Could), non-functional requirements, UI/UX guidelines, technology & stack with reasoning, ARCHITECTURE & PROJECT FOLDER STRUCTURE (complete folder tree in a code block with explanation per folder), DATABASE SCHEMA (main tables with columns & relations in markdown tables), API ENDPOINTS LIST (method, path, description in a table), success metrics KPIs, risks & mitigation table, release milestones, open questions. Be very specific and detailed in every section — no placeholders, no lorem ipsum."
      : "Aturan output: Tulis SELURUH dokumen dalam Bahasa Indonesia. Keluarkan raw Markdown SAJA (tanpa penjelasan sebelum/sesudah). Wajib memuat bagian berikut BERURUTAN: # judul, blockquote metadata, ringkasan produk, latar belakang & masalah, tujuan & non-tujuan, tabel target pengguna, daftar user stories, fitur dengan prioritas MoSCoW (Must/Should/Could), persyaratan non-fungsional, panduan UI/UX, teknologi & stack beserta alasannya, ARSITEKTUR & STRUKTUR FOLDER PROYEK (pohon folder lengkap dalam code block beserta penjelasan per folder), SKEMA DATABASE (tabel utama beserta kolom & relasinya dalam markdown table), DAFTAR API ENDPOINTS (method, path, deskripsi dalam tabel), metrik sukses KPI, tabel risiko & mitigasi, milestone rilis, pertanyaan terbuka. Isi setiap bagian sangat spesifik dan detail — tanpa placeholder, tanpa lorem ipsum.");
    return parts.join("\n");
  }

  function setGenLoading(on) {
    const btn = $("genBtn");
    btn.disabled = on;
    btn.innerHTML = on
      ? '<i class="ph ph-circle-notch" style="display:inline-block;animation:demo-spin .8s linear infinite"></i> AI sedang menulis PRD...'
      : '<i class="ph ph-file-text"></i> Generate PRD';
  }

  function showSkeleton() {
    $("prdEmpty").hidden = true;
    $("previewActions").hidden = true;
    const p = $("prdPreview");
    p.hidden = false;
    p.innerHTML =
      '<div class="skeleton-md">' +
        '<div class="skeleton-line title"></div>' +
        '<div class="skeleton-line w90"></div>' +
        '<div class="skeleton-line w80"></div>' +
        '<div class="skeleton-line w60"></div>' +
        '<div class="skeleton-line title gap"></div>' +
        '<div class="skeleton-line w90"></div>' +
        '<div class="skeleton-line w80"></div>' +
        '<div class="skeleton-line"></div>' +
        '<div class="skeleton-line w60"></div>' +
      '</div>';
  }

  function showResult(md, source) {
    currentMd = md;
    currentSource = source;
    $("prdPreview").innerHTML = renderMarkdown(md);
    $("prdPreview").hidden = false;
    $("prdEditor").hidden = true;
    $("prdEmpty").hidden = true;
    $("previewActions").hidden = false;
    const label = $("sourceChip");
    if (label) {
      label.textContent = source === "ai" ? "AI Generated" : "Template (fallback)";
      label.className = "source-chip" + (source === "ai" ? "" : " warn");
    }
    setupRefinePanel();
  }

  /* ---------- REFINE / SEMPURNAKAN PRD ---------- */
  let currentSource = "ai";
  let refinePending = null;
  let refineBusy = false;

  function prdHeadings() {
    const out = [];
    String(currentMd || "").split("\n").forEach((l) => {
      const m = l.match(/^#{1,3}\s+(.+)$/);
      if (m) out.push(m[1].replace(/\*\*/g, "").trim());
    });
    return out;
  }

  function setupRefinePanel() {
    const sel = $("refineSection");
    if (sel) {
      const heads = prdHeadings();
      sel.innerHTML =
        '<option value="">' + (isEn() ? "Whole document" : "Seluruh dokumen") + "</option>" +
        heads.map((h) => '<option value="' + escapeHtml(h) + '">' + escapeHtml(h) + "</option>").join("");
      sel.selectedIndex = 0;
      if (window.nvSelectEnhance) window.nvSelectEnhance();
      // Segarkan label trigger nv-select agar mencerminkan opsi baru.
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    $("auditList").hidden = true;
    $("auditList").innerHTML = "";
    $("refinePanel").hidden = false;
  }

  function setRefineBusy(on, activeBtn) {
    refineBusy = on;
    ["auditBtn", "refineAutoBtn", "refineTargetedBtn"].forEach((id) => { $(id).disabled = on; });
    if (activeBtn) {
      const b = $(activeBtn);
      b.dataset.label = b.dataset.label || b.innerHTML;
      b.innerHTML = on
        ? '<i class="ph ph-circle-notch" style="display:inline-block;animation:demo-spin .8s linear infinite"></i> ' + (isEn() ? "Working..." : "Memproses...")
        : b.dataset.label;
    }
  }

  async function runAudit() {
    if (refineBusy || !currentMd) return;
    $("prdError").hidden = true;
    setRefineBusy(true, "auditBtn");
    try {
      const res = await fetch("/api/ai/prd-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prd: currentMd, lang: $("fBahasa").value }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.code === "NEED_LOGIN") { location.href = "login.html?next=%2Fprd.html"; return; }
        throw new Error(data.error || "Gagal menganalisa PRD.");
      }
      renderAudit(data.issues || []);
    } catch (err) {
      showError(friendly(err));
    } finally {
      setRefineBusy(false, "auditBtn");
    }
  }

  function renderAudit(issues) {
    const wrap = $("auditList");
    if (!issues.length) {
      wrap.innerHTML = '<div class="audit-empty"><i class="ph ph-check-circle"></i> ' +
        (isEn() ? "The AI found no major gaps. Looks solid!" : "AI tidak menemukan kekurangan berarti. PRD sudah bagus!") + "</div>";
      wrap.hidden = false;
      return;
    }
    wrap.innerHTML = issues.map((it, i) =>
      '<div class="audit-issue sev-' + it.severity + '">' +
        '<div class="audit-issue-head">' +
          '<span class="audit-sev">' + escapeHtml(it.severity) + "</span>" +
          (it.section ? '<span class="audit-section">' + escapeHtml(it.section) + "</span>" : "") +
        "</div>" +
        '<p class="audit-text">' + escapeHtml(it.issue) + "</p>" +
        (it.suggestion ? '<p class="audit-sugg"><i class="ph ph-lightbulb"></i> ' + escapeHtml(it.suggestion) + "</p>" : "") +
        '<button class="btn-mini fix-issue" type="button" data-i="' + i + '">' +
          '<i class="ph ph-wrench"></i> ' + (isEn() ? "Fix this part" : "Perbaiki bagian ini") + "</button>" +
      "</div>"
    ).join("");
    wrap.hidden = false;
    wrap.querySelectorAll(".fix-issue").forEach((btn) => {
      btn.addEventListener("click", () => {
        const it = issues[Number(btn.dataset.i)];
        runRefine({
          mode: "targeted",
          section: it.section || "",
          feedback: it.issue + (it.suggestion ? " — " + it.suggestion : ""),
        });
      });
    });
  }

  async function runRefine(opts) {
    if (refineBusy || !currentMd) return;
    $("prdError").hidden = true;
    const activeBtn = opts.mode === "auto" ? "refineAutoBtn" : "refineTargetedBtn";
    setRefineBusy(true, activeBtn);
    try {
      const res = await fetch("/api/ai/prd-refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prd: currentMd,
          mode: opts.mode,
          section: opts.section || "",
          feedback: opts.feedback || "",
          answers: opts.answers || [],
          lang: $("fBahasa").value,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.code === "NEED_LOGIN") { location.href = "login.html?next=%2Fprd.html"; return; }
        throw new Error(data.error || "Gagal menyempurnakan PRD.");
      }
      if (data.needMoreInfo && data.questions && data.questions.length) {
        refinePending = { mode: opts.mode, section: opts.section || "", feedback: opts.feedback || "" };
        renderClarifyPanel(data.questions);
        return;
      }
      showResult(data.text, "ai");
      const agentTasks = extractTasksClient(data.text);
      if (agentTasks.length) {
        $("agentTasks").value = agentTasks.join("\n");
        $("agentPanel").hidden = false;
      }
    } catch (err) {
      showError(friendly(err));
    } finally {
      setRefineBusy(false, activeBtn);
    }
  }

  function enterManualEdit() {
    const ed = $("prdEditor");
    ed.value = currentMd;
    ed.hidden = false;
    $("prdPreview").hidden = true;
    $("refineTools").hidden = true;
    $("editManualBtn").hidden = true;
    $("saveManualBtn").hidden = false;
    $("cancelManualBtn").hidden = false;
  }

  function exitManualEdit(save) {
    const ed = $("prdEditor");
    if (save) {
      const v = ed.value.trim();
      if (v) showResult(v, currentSource);
    }
    ed.hidden = true;
    $("prdPreview").hidden = false;
    $("refineTools").hidden = false;
    $("editManualBtn").hidden = false;
    $("saveManualBtn").hidden = true;
    $("cancelManualBtn").hidden = true;
  }

  $("auditBtn").addEventListener("click", runAudit);
  $("refineAutoBtn").addEventListener("click", () => runRefine({ mode: "auto" }));
  $("refineTargetedBtn").addEventListener("click", () => {
    const section = $("refineSection").value;
    const feedback = $("refineNote").value.trim();
    if (!section && !feedback) {
      return showError(isEn() ? "Pick a section or describe what to improve." : "Pilih bagian atau tulis apa yang mau diperbaiki dulu.");
    }
    runRefine({ mode: "targeted", section, feedback });
  });
  $("editManualBtn").addEventListener("click", enterManualEdit);
  $("saveManualBtn").addEventListener("click", () => exitManualEdit(true));
  $("cancelManualBtn").addEventListener("click", () => exitManualEdit(false));

  function refreshMe() {
    return fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => { if (data.ok) { me = data.user; renderAuthState(); } })
      .catch(() => {});
  }

  function updateDownloadGate() {
    const btn = $("downloadBtn");
    const canDownload = me && (me.unlimited || me.dev || me.packageActive);
    btn.disabled = !canDownload;
    btn.title = canDownload
      ? "Unduh PRD.md"
      : "Unduh PRD tersedia di paket Premium / Unlimited — user gratis bisa Salin Markdown";
    btn.innerHTML = canDownload
      ? '<i class="ph ph-download-simple"></i> Unduh'
      : '<i class="ph ph-lock-simple"></i> Unduh (Premium)';
  }

  function renderQuotaLine() {
    const line = $("prdQuotaLine");
    if (!me) { line.hidden = true; return; }
    const used = me.prdUsed || 0;
    const quota = me.prdQuota === undefined ? 1 : me.prdQuota;
    const sisa = Math.max(0, quota - used);
    line.hidden = false;
    line.innerHTML = me.unlimited
      ? '<i class="ph-fill ph-infinity"></i> Sisa PRD kamu: <strong>Unlimited</strong>'
      : '<i class="ph-fill ph-file-text"></i> Sisa PRD kamu: <strong>' + sisa + " dari " + quota + "</strong>" +
        (sisa === 0 ? ' — <a href="bayar.html">beli paket untuk tambah kuota</a>' : "");
  }

  /* ---------- AGENT MONITOR ---------- */
  let currentToken = null;

  function extractTasksClient(prd) {
    const tasks = [];
    const linesList = String(prd || "").split("\n");
    let inSection = false;
    for (const line of linesList) {
      if (/^##\s/.test(line)) {
        inSection = /fitur|user stor|milestone|task|features|stories/i.test(line);
        continue;
      }
      if (!inSection) continue;
      const m = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
      if (m) {
        const title = m[1].replace(/\*\*/g, "").trim();
        if (title.length > 3 && tasks.length < 15) tasks.push(title);
      }
    }
    return tasks;
  }

  function renderProjects(projects) {
    const wrap = $("projectsList");
    wrap.innerHTML = "";
    for (const p of projects) {
      const done = p.tasks.filter((t) => t.status === "done").length;
      const pct = p.tasks.length ? Math.round((done / p.tasks.length) * 100) : 0;
      const card = document.createElement("div");
      card.className = "project-card";
      card.innerHTML =
        "<div class='project-head'>" +
          "<strong>" + escapeHtml(p.title) + "</strong>" +
          "<span class='project-pct'>" + pct + "%</span>" +
        "</div>" +
        "<div class='project-bar'><div class='project-bar-fill' style='width:" + pct + "%'></div></div>" +
        "<ul class='task-list'>" +
          p.tasks.map((t) =>
            "<li class='task-" + t.status + "'>" +
              "<span class='task-check'>" + (t.status === "done" ? "<i class='ph-fill ph-check'></i>" : t.status === "progress" ? "<i class='ph ph-spinner'></i>" : "") + "</span>" +
              "<span class='task-title'>" + escapeHtml(t.title) + "</span>" +
              (t.note ? "<small>" + escapeHtml(t.note) + "</small>" : "") +
            "</li>"
          ).join("") +
        "</ul>" +
        "<button class='btn-mini danger del-project' data-id='" + p.id + "'><i class='ph ph-trash'></i> Hapus</button>";
      wrap.appendChild(card);
    }
    wrap.querySelectorAll(".del-project").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Hapus proyek ini?")) return;
        await fetch("/api/projects/" + btn.dataset.id, { method: "DELETE" });
        loadProjects();
      });
    });
  }

  async function loadProjects() {
    if (!me) return;
    try {
      const res = await fetch("/api/projects/mine");
      const data = await res.json();
      if (data.ok && data.projects.length) {
        renderProjects(data.projects);
        $("projectsPanel").hidden = false;
      } else {
        $("projectsPanel").hidden = true;
      }
    } catch {}
  }

  $("createPlanBtn").addEventListener("click", async () => {
    const tasks = $("agentTasks").value.split("\n").map((s) => s.trim()).filter(Boolean);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: $("fNama").value.trim() || "Proyek PRD", prd: currentMd, tasks })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Gagal.");
      currentToken = data.token;
      $("agentToken").textContent = data.token;
      $("agentResult").hidden = false;
      await loadProjects();
    } catch (err) {
      alert("Gagal: " + err.message);
    }
  });

  $("copySnippetBtn").addEventListener("click", async () => {
    const snippet =
      "Kamu adalah AI coding agent yang mengerjakan proyek dari PRD berikut.\n\n" +
      "=== PRD ===\n" + currentMd + "\n\n=== ATURAN PELAPORAN ===\n" +
      "Setiap kali kamu menyelesaikan / mulai / mengubah status sebuah task, laporkan dengan HTTP request:\n\n" +
      "POST " + location.origin + "/api/agent/report\n" +
      "Content-Type: application/json\n\n" +
      JSON.stringify({ token: currentToken, taskId: "t1", status: "done", note: "keterangan singkat" }, null, 2) +
      "\n\nstatus: pending | progress | done. taskId: t1, t2, t3, ... sesuai urutan task.";
    try {
      await navigator.clipboard.writeText(snippet);
      $("copySnippetBtn").innerHTML = "<i class='ph ph-check'></i> Tersalin";
      setTimeout(() => { $("copySnippetBtn").innerHTML = "<i class='ph ph-copy-simple'></i> Salin Instruksi Agent"; }, 2000);
    } catch {}
  });

  let projectTimer = null;
  function startProjectPolling() {
    if (projectTimer) return;
    projectTimer = setInterval(() => {
      if (me && !$("projectsPanel").hidden) loadProjects();
    }, 10000);
  }

  let clarifyQA = [];

  function isEn() { return $("fBahasa").value === "en"; }

  async function runPrdGeneration() {
    setGenLoading(true);
    showSkeleton();
    let aiFailed = false;
    let md = "";

    try {
      const res = await fetch("/api/ai/prd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: buildAiPrompt(), instruction: "Kamu senior product manager & software architect. Output hanya raw markdown." })
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.text) {
        if (data.code === "NEED_LOGIN") {
          me = null;
          renderAuthState();
          location.href = "login.html?next=%2Fprd.html";
          return;
        }
        if (data.code === "PRD_QUOTA_USED") {
          await refreshMe();
          setGenLoading(false);
          if (!currentMd) { $("prdPreview").hidden = true; $("prdEmpty").hidden = false; }
          showError(data.error + " Beli paket di halaman harga untuk tambah kuota.");
          return;
        }
        throw new Error(data.error || "AI tidak merespons.");
      }
      md = data.text;
    } catch (err) {
      if (err.message === "Failed to fetch" || err.message === "Load failed") {
        setGenLoading(false);
        if (!currentMd) { $("prdPreview").hidden = true; $("prdEmpty").hidden = false; }
        return showError("Tidak bisa terhubung ke server. Jalankan backend (npm start di folder backend) lalu buka lewat http://localhost:3000/prd.html");
      }
      aiFailed = true;
      md = generate();
    }

    await refreshMe();
    renderQuotaLine();
    setTimeout(() => {
      showResult(md, aiFailed ? "template" : "ai");
      setGenLoading(false);
      const agentTasks = extractTasksClient(md);
      if (agentTasks.length) {
        $("agentTasks").value = agentTasks.join("\n");
        $("agentPanel").hidden = false;
      }
      if (aiFailed) {
        $("prdError").textContent = "AI sedang tidak tersedia, PRD dibuat dengan mode template. Coba lagi nanti untuk hasil AI.";
        $("prdError").hidden = false;
      }
    }, 250);
  }

  function renderClarifyPanel(questions) {
    const wrap = $("clarifyQuestions");
    // Terima format lama (string) maupun baru ({q, options}).
    const norm = (questions || []).map((item) =>
      typeof item === "string"
        ? { q: item, options: [] }
        : { q: String(item.q || item.question || ""), options: Array.isArray(item.options) ? item.options.filter(Boolean) : [] }
    ).filter((it) => it.q);

    wrap.innerHTML = norm.map((it, i) => {
      const opts = it.options.map((opt, j) =>
        '<button type="button" class="clarify-opt" data-q="' + i + '" data-opt="' + j + '">' + escapeHtml(opt) + '</button>'
      ).join("");
      return '<div class="clarify-q">' +
        '<label class="field-label" for="clarifyA' + i + '">' + escapeHtml(it.q) + '</label>' +
        (opts ? '<div class="clarify-opts" data-q="' + i + '">' + opts + '</div>' : '') +
        '<input type="text" id="clarifyA' + i + '" class="try-input clarify-input" data-q="' + escapeHtml(it.q) + '" autocomplete="off" placeholder="' +
          (it.options.length ? (isEn() ? "Pick one or more above, or type your own" : "Pilih satu atau beberapa di atas, atau tulis sendiri") : (isEn() ? "Your answer (optional)" : "Jawaban kamu (opsional)")) + '" />' +
      '</div>';
    }).join("");

    // Klik opsi: multi-select — tiap opsi bisa dipilih bersamaan, klik ulang =
    // batal. Input teks di-isi gabungan semua opsi terpilih (dipisah ", "), dan
    // user tetap boleh mengetik/menambah jawaban sendiri.
    norm.forEach((it, i) => {
      const input = wrap.querySelector("#clarifyA" + i);
      const group = wrap.querySelector('.clarify-opts[data-q="' + i + '"]');
      if (!group) return;
      const buttons = group.querySelectorAll(".clarify-opt");
      const syncInputFromButtons = () => {
        if (!input) return;
        const picked = Array.from(buttons)
          .filter((b) => b.classList.contains("active"))
          .map((b) => b.textContent);
        input.value = picked.join(", ");
      };
      buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
          btn.classList.toggle("active");
          syncInputFromButtons();
        });
      });
      // Kalau user mengetik manual, sinkronkan highlight: opsi aktif bila teksnya
      // muncul sebagai salah satu bagian (dipisah koma) dari isian.
      if (input) {
        input.addEventListener("input", () => {
          const tokens = input.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
          buttons.forEach((b) => b.classList.toggle("active", tokens.includes(b.textContent.trim().toLowerCase())));
        });
      }
    });
    $("clarifyTitle").textContent = isEn() ? "The AI needs a bit more info" : "AI butuh sedikit info tambahan";
    $("clarifyDesc").textContent = isEn()
      ? "Answer these so your PRD is more accurate — you can pick more than one option per question, or skip any."
      : "Jawab pertanyaan berikut agar PRD-nya lebih akurat — boleh pilih lebih dari satu opsi tiap pertanyaan, atau dilewati.";
    $("clarifyContinueBtn").innerHTML = '<i class="ph ph-arrow-right"></i> ' + (isEn() ? "Continue to PRD" : "Lanjut Buat PRD");
    $("clarifySkipBtn").textContent = isEn() ? "Skip" : "Lewati";
    $("clarifyPanel").hidden = false;
    $("clarifyPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function collectClarifyAnswers() {
    clarifyQA = [];
    document.querySelectorAll(".clarify-input").forEach((inp) => {
      const a = inp.value.trim();
      if (a) clarifyQA.push({ q: inp.dataset.q, a });
    });
  }

  async function startClarify() {
    $("clarifyPanel").hidden = true;
    refinePending = null;
    clarifyQA = [];
    const btn = $("genBtn");
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-circle-notch" style="display:inline-block;animation:demo-spin .8s linear infinite"></i> ' + (isEn() ? "Analyzing your brief..." : "Menganalisis kebutuhan...");
    try {
      const res = await fetch("/api/ai/prd-clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: buildAiPrompt(), lang: $("fBahasa").value })
      });
      const data = await res.json();
      if (data.code === "NEED_LOGIN") {
        me = null; renderAuthState();
        location.href = "login.html?next=%2Fprd.html";
        return;
      }
      if (data.code === "PRD_QUOTA_USED") {
        await refreshMe();
        setGenLoading(false);
        showError(data.error + " Beli paket di halaman harga untuk tambah kuota.");
        return;
      }
      if (res.ok && data.ok && data.needMoreInfo && data.questions && data.questions.length) {
        setGenLoading(false);
        renderClarifyPanel(data.questions);
        return;
      }
    } catch (err) {
      // Abaikan — lanjut generate langsung.
    }
    await runPrdGeneration();
  }

  $("genBtn").addEventListener("click", async () => {
    $("prdError").hidden = true;
    if (!$("fNama").value.trim()) return showError(STR[$("fBahasa").value].errNama);
    if (!$("fPrompt").value.trim()) return showError(STR[$("fBahasa").value].errPrompt);
    if (!me) {
      location.href = "login.html?next=%2Fprd.html";
      return;
    }
    startClarify();
  });

  $("clarifyContinueBtn").addEventListener("click", () => {
    collectClarifyAnswers();
    $("clarifyPanel").hidden = true;
    if (refinePending) {
      const opts = refinePending;
      refinePending = null;
      runRefine({ mode: opts.mode, section: opts.section, feedback: opts.feedback, answers: clarifyQA });
      return;
    }
    runPrdGeneration();
  });

  $("clarifySkipBtn").addEventListener("click", () => {
    clarifyQA = [];
    $("clarifyPanel").hidden = true;
    if (refinePending) {
      const opts = refinePending;
      refinePending = null;
      // Lewati klarifikasi: minta AI perbaiki apa adanya.
      runRefine({ mode: opts.mode, section: opts.section, feedback: opts.feedback });
      return;
    }
    runPrdGeneration();
  });

  $("downloadBtn").addEventListener("click", () => {
    if (!me || !(me.unlimited || me.dev || me.packageActive)) return;
    const blob = new Blob(["\ufeff" + currentMd], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "PRD.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  $("copyPrdBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(currentMd);
      $("copyPrdBtn").innerHTML = '<i class="ph ph-check"></i> Tersalin';
      setTimeout(() => { $("copyPrdBtn").innerHTML = '<i class="ph ph-copy-simple"></i> Salin'; }, 1800);
    } catch {}
  });
})();
