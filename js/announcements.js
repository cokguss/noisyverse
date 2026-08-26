(() => {
  "use strict";

  if (location.protocol === "file:") return;
  if (location.pathname.startsWith("/admin")) return;

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = String(str == null ? "" : str);
    return d.innerHTML;
  }

  (async () => {
    let list = [];
    try {
      const res = await fetch("/api/announcements");
      const data = await res.json();
      if (!data.ok) return;
      list = data.announcements.filter((a) => a.active !== false);
    } catch {
      return;
    }
    if (!list.length) return;

    let dismissed = [];
    try { dismissed = JSON.parse(localStorage.getItem("nv_dismissed") || "[]"); } catch {}
    list = list.filter((a) => !dismissed.includes(a.id));
    if (!list.length) return;

    const el = document.createElement("div");
    el.className = "nv-announce nv-" + (list[0].type || "info");
    el.innerHTML =
      '<div class="nv-text"><i class="ph-fill ph-megaphone"></i><span class="nv-msg">' +
      escapeHtml(list[0].message) +
      "</span></div>" +
      '<button type="button" aria-label="Tutup notifikasi">&times;</button>';
    document.body.prepend(el);
    requestAnimationFrame(() => el.classList.add("show"));

    const close = () => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 400);
      document.body.classList.remove("nv-has-announce");
      try {
        const ids = list.map((a) => a.id);
        localStorage.setItem("nv_dismissed", JSON.stringify([...dismissed, ...ids].slice(-30)));
      } catch {}
    };
    el.querySelector("button").addEventListener("click", close);

    requestAnimationFrame(() => document.body.classList.add("nv-has-announce"));

    if (list.length > 1) {
      let idx = 0;
      const textEl = el.querySelector(".nv-text");
      setInterval(() => {
        el.classList.add("swap");
        setTimeout(() => {
          idx = (idx + 1) % list.length;
          const a = list[idx];
          el.className = "nv-announce nv-" + (a.type || "info") + " show";
          textEl.innerHTML =
            '<i class="ph-fill ph-megaphone"></i><span class="nv-msg">' + escapeHtml(a.message) + "</span>";
          el.classList.remove("swap");
        }, 380);
      }, 6000);
    }
  })();
})();
