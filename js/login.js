(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const next = params.get("next") || "index.html";
  let authMode = params.get("mode") === "register" ? "register" : "login";

  const authError = $("authError");
  const form = $("loginForm");
  const submitBtn = $("authSubmit");

  function friendly(err) {
    if (location.protocol === "file:") {
      return "Kamu membuka file ini langsung. Jalankan backend dulu (npm start di folder backend), lalu buka lewat http://localhost:3000/login.html";
    }
    if (err.message === "Failed to fetch" || err.message === "Load failed") {
      return "Tidak bisa terhubung ke server. Pastikan backend berjalan: buka folder backend, jalankan npm start, lalu akses lewat http://localhost:3000";
    }
    return err.message;
  }

  function renderMode() {
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.auth === authMode));
    $("formTitle").textContent = authMode === "login" ? "Masuk" : "Daftar";
    $("formSub").textContent = authMode === "login"
      ? "Masuk untuk melanjutkan ke Noisy Verse"
      : "Buat akun — langsung dapat 1x reverse + 1x PRD gratis";
    $("submitLabel").textContent = authMode === "login" ? "Masuk" : "Daftar Sekarang";
    $("switchText").innerHTML = authMode === "login"
      ? 'Belum punya akun? <a href="#" id="switchLink">Daftar gratis</a>'
      : 'Sudah punya akun? <a href="#" id="switchLink">Masuk di sini</a>';
    $("switchLink").addEventListener("click", (e) => {
      e.preventDefault();
      authMode = authMode === "login" ? "register" : "login";
      renderMode();
    });
    authError.hidden = true;
  }

  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      authMode = tab.dataset.auth;
      renderMode();
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("authUsername").value.trim();
    const password = $("authPassword").value;
    authError.hidden = true;
    submitBtn.disabled = true;
    try {
      const res = await fetch("/api/auth/" + authMode, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Gagal.");
      location.href = next;
    } catch (err) {
      authError.textContent = friendly(err);
      authError.hidden = false;
      submitBtn.disabled = false;
    }
  });

  (async () => {
    if (location.protocol === "file:") {
      authError.textContent = "Kamu membuka file ini langsung. Jalankan backend (npm start di folder backend) lalu buka lewat http://localhost:3000/login.html";
      authError.hidden = false;
      return;
    }
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        if (data.ok) location.href = next;
      }
    } catch {}
  })();

  renderMode();
})();
