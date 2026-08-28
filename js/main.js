(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- CINEMATIC 3D AURORA (WebGL shader) ---------- */
  const aurora = document.getElementById("aurora");
  if (aurora && !reduceMotion && (() => {
    try {
      return !!document.createElement("canvas").getContext("webgl");
    } catch (e) { return false; }
  })()) {
    const gl = aurora.getContext("webgl", { antialias: false, alpha: false });

    const vsrc = `
      attribute vec2 aPos;
      varying vec2 vUv;
      void main() {
        vUv = aPos * 0.5 + 0.5;
        gl_Position = vec4(aPos, 0.0, 1.0);
      }
    `;

    const fsrc = `
      precision highp float;
      uniform float uTime;
      uniform vec2 uRes;
      uniform vec2 uMouse;
      varying vec2 vUv;

      float hash(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float amp = 0.55;
        mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
        for (int i = 0; i < 5; i++) {
          v += amp * noise(p);
          p = rot * p * 2.02;
          amp *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 uv = vUv;
        float aspect = uRes.x / uRes.y;
        vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

        float t = uTime * 0.055;

        // parallax depth layers driven by mouse
        vec2 m = uMouse;
        vec2 pl = p * (1.0 + length(m) * 0.15) - m * 0.12;

        // domain-warped liquid flow
        vec2 q = vec2(
          fbm(pl * 1.6 + vec2(0.0, t)),
          fbm(pl * 1.6 + vec2(5.2, 1.3) - t * 0.8)
        );
        vec2 r = vec2(
          fbm(pl * 2.1 + 3.2 * q + vec2(1.7, 9.2) + t * 1.2),
          fbm(pl * 2.1 + 3.2 * q + vec2(8.3, 2.8) - t * 0.9)
        );
        float f = fbm(pl * 1.8 + 3.0 * r);

        // palette: deep navy -> violet -> soft lavender highlights
        vec3 base = vec3(0.039, 0.039, 0.071);
        vec3 deep = vec3(0.145, 0.075, 0.353);
        vec3 mid  = vec3(0.353, 0.204, 0.788);
        vec3 glow = vec3(0.655, 0.545, 0.980);
        vec3 warm = vec3(0.851, 0.275, 0.937);

        float f1 = clamp(f * f * 2.4, 0.0, 1.0);
        float f2 = clamp(length(q) * 0.75, 0.0, 1.0);
        float f3 = clamp(r.x * 1.35 - 0.45, 0.0, 1.0);

        vec3 col = base;
        col = mix(col, deep, f1);
        col = mix(col, mid, smoothstep(0.25, 0.95, f2) * f1);
        col = mix(col, warm, pow(f3, 3.0) * 0.30);
        col += glow * pow(clamp(f2 * f1 * 1.6, 0.0, 1.0), 3.0) * 0.35;

        // slow drifting light sweep
        float sweep = sin(uv.x * 2.2 + t * 2.4 + sin(t * 0.7)) * 0.5 + 0.5;
        col += glow * sweep * sweep * 0.045;

        // cinematic vignette + top darkening for readability
        float vig = smoothstep(1.25, 0.32, length((uv - 0.5) * vec2(aspect * 0.85, 1.05)));
        col *= vig;
        col *= 1.0 - uv.y * 0.18;

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsrc));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsrc));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uMouse = gl.getUniformLocation(prog, "uMouse");

    let w, h;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * 0.75;
      w = window.innerWidth;
      h = window.innerHeight;
      aurora.width = Math.floor(w * dpr);
      aurora.height = Math.floor(h * dpr);
      gl.viewport(0, 0, aurora.width, aurora.height);
      gl.uniform2f(uRes, w, h);
    };
    resize();
    window.addEventListener("resize", resize);

    let mx = 0, my = 0, tmx = 0, tmy = 0;
    window.addEventListener("pointermove", (e) => {
      tmx = (e.clientX / window.innerWidth - 0.5) * 2;
      tmy = -(e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });

    let last = performance.now();
    const loop = (now) => {
      mx += (tmx - mx) * 0.03;
      my += (tmy - my) * 0.03;
      if (now - last >= 1000 / 60) {
        last = now;
        gl.uniform1f(uTime, now * 0.001);
        gl.uniform2f(uMouse, mx, my);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } else if (aurora) {
    aurora.style.background =
      "radial-gradient(ellipse 80% 65% at 72% -8%, rgba(109,40,217,0.35), transparent), " +
      "radial-gradient(ellipse 70% 55% at 18% 105%, rgba(91,33,182,0.28), transparent), #0a0a12";
  }

  /* ---------- STARS ---------- */
  const starsCanvas = document.getElementById("stars");
  if (starsCanvas && !reduceMotion) {
    const sctx = starsCanvas.getContext("2d");
    let sw, sh, stars = [];

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sw = window.innerWidth;
      sh = window.innerHeight;
      starsCanvas.width = sw * dpr;
      starsCanvas.height = sh * dpr;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.floor((sw * sh) / 14000);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * sw,
        y: Math.random() * sh,
        r: Math.random() * 1.3 + 0.3,
        tw: Math.random() * Math.PI * 2,
        ts: 0.4 + Math.random() * 1.2
      }));
    };
    build();
    window.addEventListener("resize", build);

    let slast = performance.now();
    const sloop = (now) => {
      const dtSec = (now - slast) / 1000;
      if (dtSec >= 1 / 24) {
        slast = now;
        sctx.clearRect(0, 0, sw, sh);
        for (const s of stars) {
          s.tw += dtSec * s.ts;
          const alpha = 0.18 + Math.abs(Math.sin(s.tw)) * 0.5;
          sctx.beginPath();
          sctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          sctx.fillStyle = `rgba(220,214,255,${alpha})`;
          sctx.fill();
        }
      }
      requestAnimationFrame(sloop);
    };
    requestAnimationFrame(sloop);
  }

  /* ---------- NAV SCROLL STATE ---------- */
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- MOBILE MENU ---------- */
  const toggle = document.getElementById("menuToggle");
  const menu = document.getElementById("mobileMenu");
  if (toggle && menu) {
    toggle.addEventListener("click", () => {
      menu.classList.toggle("open");
      toggle.classList.toggle("open");
      toggle.setAttribute("aria-label", menu.classList.contains("open") ? "Tutup menu" : "Buka menu");
    });
    menu.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => {
        menu.classList.remove("open");
        toggle.classList.remove("open");
      })
    );
  }

  /* ---------- NAV AUTH STATE ---------- */
  (async () => {
    const loginBtn = document.querySelector(".nav-login");
    const ctaBtn = document.querySelector(".nav-cta");
    const profileMenu = document.getElementById("profileMenu");
    if (!loginBtn && !ctaBtn) return;

    let user = null;

    const fillProfileMenu = () => {
      if (!profileMenu || !user) return;
      $("pmAvatar").textContent = user.username.charAt(0).toUpperCase();
      $("pmName").textContent = user.username;
      $("pmRole").textContent = user.username === "noisy02" ? "Developer" : "Akun Noisy Verse";
      const adminLink = document.getElementById("pmAdmin");
      if (adminLink) adminLink.hidden = user.username !== "noisy02";
    };

    const closeMenu = () => { if (profileMenu) profileMenu.hidden = true; };

    if (loginBtn) {
      loginBtn.addEventListener("click", (e) => {
        if (!user) return;
        e.preventDefault();
        if (profileMenu) profileMenu.hidden = !profileMenu.hidden;
      });
    }

    document.addEventListener("click", (e) => {
      if (!profileMenu || profileMenu.hidden) return;
      if (e.target.closest("#profileMenu") || e.target.closest(".nav-login")) return;
      closeMenu();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });

    const pmLogout = document.getElementById("pmLogout");
    if (pmLogout) {
      pmLogout.addEventListener("click", async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        location.reload();
      });
    }

    const mobileLogout = document.getElementById("mobileLogout");
    if (mobileLogout) {
      mobileLogout.addEventListener("click", async (e) => {
        e.preventDefault();
        await fetch("/api/auth/logout", { method: "POST" });
        location.reload();
      });
    }

    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok || !data.user) return;
      user = data.user;

      if (loginBtn) {
        loginBtn.classList.add("is-user");
        loginBtn.setAttribute("href", "#");
        loginBtn.title = "Buka menu akun";
        loginBtn.innerHTML = '<span class="nav-avatar">' + user.username.charAt(0).toUpperCase() + '</span><span class="nav-username"></span><i class="ph ph-caret-down nav-caret"></i>';
        loginBtn.querySelector(".nav-username").textContent = user.username;
      }
      if (ctaBtn) {
        ctaBtn.innerHTML = '<i class="ph ph-magic-wand"></i> Reverse';
      }
      fillProfileMenu();
      if (mobileLogout) mobileLogout.hidden = false;
    } catch {}
  })();

  /* ---------- VISITOR STATS (realtime via Supabase) ---------- */
  (async () => {
    const chip = document.getElementById("visitorChip");
    const bigSection = document.getElementById("statistik");
    if (!chip && !bigSection) return;

    const el = (id) => document.getElementById(id);
    const setText = (id, val) => {
      const node = el(id);
      if (node && val !== undefined && val !== null) node.textContent = Number(val).toLocaleString("id-ID");
    };

    // Nilai terakhir yang diketahui; dipakai supaya animasi count-up di section
    // besar tetap mulai dari angka benar meski realtime sudah lebih dulu masuk.
    const latest = { total: 0, unique: 0, live: 0, reverses: 0, prd: 0 };
    let bigStatsPlayed = false;
    // Saat animasi count-up berjalan, jangan biarkan update realtime menimpa
    // angka di tengah animasi (nanti dipaint ulang setelah animasi selesai).
    let animating = false;

    const paintChip = () => {
      if (!chip) return;
      setText("vLive", latest.live);
      setText("vTotal", latest.total);
      chip.hidden = false;
    };

    const paintBigStats = () => {
      if (!bigStatsPlayed || animating) return;
      setText("bsVisits", latest.total);
      setText("bsUnique", latest.unique);
      setText("bsReverses", latest.reverses);
      setText("bsPrd", latest.prd);
      setText("bsLive", latest.live);
    };

    const applySnapshot = (s) => {
      if (!s) return;
      if (s.total !== undefined) latest.total = s.total;
      if (s.unique !== undefined) latest.unique = s.unique;
      if (s.live !== undefined) latest.live = s.live;
      if (s.reverses !== undefined) latest.reverses = s.reverses;
      if (s.prd !== undefined) latest.prd = s.prd;
      paintChip();
      paintBigStats();
    };

    // Bentuk baris site_stats (snake_case) -> bentuk internal.
    const fromRow = (row) => ({
      total: Number(row.total_visits) || 0,
      unique: Number(row.unique_visitors) || 0,
      live: Number(row.live_now) || 0,
      reverses: Number(row.reverses) || 0,
      prd: Number(row.prd) || 0
    });

    /* --- 1. Catat kunjungan, lalu ambil snapshot awal --- */
    try {
      await fetch("/api/track/visit", { method: "POST" });
    } catch {}

    const fetchSnapshot = async () => {
      try {
        const res = await fetch("/api/stats/public");
        const data = await res.json();
        if (!data.ok) return;
        applySnapshot({
          total: data.totalVisits,
          unique: data.uniqueVisitors,
          live: data.liveNow,
          reverses: data.reverses,
          prd: data.prd
        });
      } catch {}
    };
    await fetchSnapshot();

    /* --- 2. Heartbeat: jaga status "online" tetap akurat --- */
    const heartbeat = () => {
      fetch("/api/track/heartbeat", { method: "POST", keepalive: true }).catch(() => {});
    };
    setInterval(heartbeat, 60000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") heartbeat();
    });

    /* --- 3. Langganan realtime ke baris site_stats --- */
    let realtimeLive = false;
    try {
      const cfgRes = await fetch("/api/stats/realtime-config");
      const cfg = await cfgRes.json();
      if (cfg.ok && cfg.enabled) {
        const { createClient } = await import(
          "https://esm.sh/@supabase/supabase-js@2.112.4"
        );
        const sb = createClient(cfg.url, cfg.key, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
        sb.channel("site-stats")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "site_stats" },
            (payload) => {
              if (payload.new) applySnapshot(fromRow(payload.new));
            }
          )
          .subscribe((status) => {
            realtimeLive = status === "SUBSCRIBED";
          });
      }
    } catch {
      realtimeLive = false;
    }

    /* --- 4. Fallback polling bila realtime tidak tersedia --- */
    setInterval(() => {
      if (!realtimeLive) fetchSnapshot();
    }, 30000);

    /* --- 5. Section statistik besar: animasi count-up saat masuk viewport --- */
    if (bigSection) {
      const countUp = (node, target) =>
        new Promise((resolve) => {
          const dur = 1400;
          const start = performance.now();
          const step = (now) => {
            const p = Math.min((now - start) / dur, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            node.textContent = Math.round(target * eased).toLocaleString("id-ID");
            if (p < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        });
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !bigStatsPlayed) {
              bigStatsPlayed = true;
              animating = true;
              io.disconnect();
              const map = {
                bsVisits: latest.total,
                bsUnique: latest.unique,
                bsReverses: latest.reverses,
                bsPrd: latest.prd
              };
              const runs = [];
              for (const [id, val] of Object.entries(map)) {
                const node = el(id);
                if (node) runs.push(countUp(node, val || 0));
              }
              setText("bsLive", latest.live);
              // Setelah animasi selesai, sinkronkan lagi ke angka terbaru
              // (bisa saja sudah berubah lewat realtime saat animasi berjalan).
              Promise.all(runs).then(() => {
                animating = false;
                paintBigStats();
              });
            }
          }
        },
        { threshold: 0.3 }
      );
      io.observe(bigSection);
    }
  })();

  /* ---------- DYNAMIC PRICING ---------- */
  (async () => {
    const grid = document.getElementById("pricingGrid");
    if (!grid) return;
    let packages = null;
    let me = null;
    try {
      const [pRes, mRes] = await Promise.allSettled([
        fetch("/api/packages").then((r) => r.json()),
        fetch("/api/auth/me").then((r) => r.json())
      ]);
      if (pRes.status === "fulfilled" && pRes.value.ok) packages = pRes.value.packages;
      if (mRes.status === "fulfilled" && mRes.value.ok) me = mRes.value.user;
    } catch {}
    if (!packages || !packages.length) return;

    grid.innerHTML = "";
    for (const pkg of packages) {
      const card = document.createElement("article");
      card.className = "price-card reveal visible" + (pkg.featured ? " featured" : "");

      const flag = pkg.featured
        ? '<span class="price-flag"><i class="ph-fill ph-crown-simple"></i> Terlaris</span>'
        : "";

      const priceOld = pkg.priceOld
        ? '<span class="price-old">' + escapeHtml(pkg.priceOld) + "</span>"
        : "";
      const priceValue = pkg.price === "Rp0" ? "Gratis" : escapeHtml(pkg.price);
      const duration = pkg.durationDays ? '<em>/ ' + pkg.durationDays + " hari</em>" : "";

      const benefits = (pkg.benefits || [])
        .map((b) => '<li><i class="ph ph-check"></i> ' + escapeHtml(b) + "</li>")
        .join("");

      let cta;
      if (me && (me.unlimited || me.dev)) {
        cta = '<button class="btn btn-ghost btn-block" disabled><i class="ph-fill ph-shield-star"></i> Akun Developer ∞</button>';
      } else if (me && me.packageActive) {
        cta = me.packageType === pkg.id
          ? '<button class="btn btn-success btn-block" disabled><i class="ph-fill ph-check-circle"></i> Sudah dibeli</button>'
          : '<button class="btn btn-ghost btn-block" disabled><i class="ph ph-lock-simple"></i> Paket aktif</button>';
      } else if (pkg.purchasable === false || pkg.price === "Rp0") {
        cta = '<a href="coba.html" class="btn btn-ghost btn-block">Mulai Gratis</a>';
      } else {
        cta = '<a href="bayar.html?paket=' + encodeURIComponent(pkg.id) + '" class="btn ' + (pkg.featured ? "btn-primary" : "btn-ghost") + ' btn-block">Beli Sekarang</a>';
      }

      card.innerHTML =
        flag +
        "<h3>" + escapeHtml(pkg.name) + "</h3>" +
        '<div class="price">' + priceOld + '<span class="price-value">' + priceValue + "</span>" + duration + "</div>" +
        "<ul>" + benefits + "</ul>" +
        cta;
      grid.appendChild(card);
    }
  })();

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = String(str == null ? "" : str);
    return d.innerHTML;
  }

  /* ---------- SCROLL REVEAL ---------- */
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    let batchIndex = 0;
    let currentParent = null;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target;
          const parent = el.parentElement;
          if (parent !== currentParent) { currentParent = parent; batchIndex = 0; }
          el.style.setProperty("--reveal-delay", `${Math.min(batchIndex * 90, 450)}ms`);
          batchIndex++;
          el.classList.add("visible");
          io.unobserve(el);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("visible"));
  }

  /* ---------- HERO ACTIVATION DEMO ---------- */
  const demoSteps = document.querySelectorAll(".demo-step");
  if (demoSteps.length) {
    const bar = document.querySelector(".demo-progress-bar");
    const status = document.querySelector(".demo-status");
    const messages = [
      "Menganalisis URL target",
      "Membaca struktur & design",
      "Menyusun prompt AI",
      "Prompt berhasil dibuat!"
    ];

    const setDone = (step) => {
      step.classList.remove("active");
      step.classList.add("done");
      step.querySelector(".step-state").innerHTML = '<i class="ph-fill ph-check"></i>';
    };
    const resetDemo = () => {
      demoSteps.forEach((s) => {
        s.classList.remove("active", "done");
        s.querySelector(".step-state").innerHTML = "";
      });
      status.classList.remove("success");
      if (bar) bar.style.width = "0%";
    };

    const finishAll = () => {
      demoSteps.forEach(setDone);
      if (bar) bar.style.width = "100%";
      setStatus(messages[3], true);
    };
    const setStatus = (text, success) => {
      status.classList.add("fade");
      setTimeout(() => {
        status.textContent = text;
        status.classList.toggle("success", !!success);
        status.classList.remove("fade");
      }, 250);
    };

    if (reduceMotion) {
      finishAll();
    } else {
      let phaseTimers = [];
      const clearTimers = () => { phaseTimers.forEach(clearTimeout); phaseTimers = []; };
      const at = (ms, fn) => phaseTimers.push(setTimeout(fn, ms));

      const runCycle = () => {
        clearTimers();
        resetDemo();

        const T1 = 400;
        const T2 = 2400;
        const T3 = 4400;
        const DONE = 6200;

        at(T1, () => {
          demoSteps[0].classList.add("active");
          setStatus(messages[0]);
          if ($bar) bar.style.width = "18%";
        });
        at(T2 - 200, () => setDone(demoSteps[0]));

        at(T2, () => {
          demoSteps[1].classList.add("active");
          setStatus(messages[1]);
          if (bar) bar.style.width = "52%";
        });
        at(T3 - 300, () => setDone(demoSteps[1]));

        at(T3, () => {
          demoSteps[2].classList.add("active");
          setStatus(messages[2]);
          if (bar) bar.style.width = "86%";
        });

        at(DONE, () => {
          setDone(demoSteps[2]);
          setStatus(messages[3], true);
          if (bar) bar.style.width = "100%";
        });

        at(DONE + 3400, runCycle);
      };

      const heroDemoEl = document.querySelector(".hero-demo");
      const demoObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              demoObserver.disconnect();
              runCycle();
            }
          }
        },
        { threshold: 0.25 }
      );
      demoObserver.observe(heroDemoEl);

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          clearTimers();
        } else {
          runCycle();
        }
      });
    }
  }

  /* ---------- FAQ ACCORDION (smooth open/close) ---------- */
  const faqItems = document.querySelectorAll(".faq-item");
  faqItems.forEach((item) => {
    const summary = item.querySelector("summary");
    const answer = item.querySelector(".faq-answer");
    if (!summary || !answer) return;

    const closeItem = () => {
      item.classList.remove("is-open");
      if (reduceMotion) { item.open = false; return; }
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        item.open = false;
        answer.removeEventListener("transitionend", onEnd);
      };
      const onEnd = (e) => { if (e.target === answer && e.propertyName === "grid-template-rows") finish(); };
      answer.addEventListener("transitionend", onEnd);
      // Fallback in case transitionend doesn't fire (e.g. tab hidden).
      setTimeout(finish, 500);
    };

    const openItem = () => {
      item.open = true; // render content first so it can animate in
      requestAnimationFrame(() => item.classList.add("is-open"));
    };

    summary.addEventListener("click", (e) => {
      e.preventDefault();
      if (item.open) closeItem();
      else openItem();
    });
  });
})();

