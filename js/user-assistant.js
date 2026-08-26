(() => {
  "use strict";

  if (location.protocol === "file:") return;

  const fab = document.createElement("button");
  fab.className = "ai-fab ai-fab-user";
  fab.type = "button";
  fab.setAttribute("aria-label", "Buka AI Assistant");
  fab.innerHTML = '<i class="ph-fill ph-sparkle"></i>';

  const chat = document.createElement("div");
  chat.className = "ai-chat ai-chat-user";
  chat.hidden = true;
  chat.innerHTML =
    '<div class="ai-chat-head">' +
      '<span><i class="ph-fill ph-sparkle"></i> Noisy Assistant</span>' +
      '<button type="button" class="ai-close" aria-label="Tutup">&times;</button>' +
    "</div>" +
    '<div class="ai-msgs">' +
      '<div class="ai-msg bot">Halo! 👋 Aku asisten virtual Noisy Verse. Mau tahu apa hari ini?</div>' +
      '<div class="ai-chips">' +
        '<button type="button" data-q="Bagaimana cara beli paket premium?">🛒 Cara beli paket</button>' +
        '<button type="button" data-q="Apa benefit paket premium dan unlimited?">✨ Benefit paket</button>' +
        '<button type="button" data-q="Bagaimana cara pakai generator PRD?">📄 Cara pakai PRD</button>' +
      "</div>" +
    "</div>" +
    '<form class="ai-chat-input" autocomplete="off">' +
      '<div class="ai-input-wrap">' +
        '<i class="ph-fill ph-sparkle ai-input-icon"></i>' +
        '<input type="text" placeholder="Hai! Mau tanya apa hari ini?" />' +
        '<button class="ai-send" type="submit" aria-label="Kirim"><i class="ph-fill ph-paper-plane-tilt"></i></button>' +
      "</div>" +
    "</form>";

  document.body.appendChild(fab);
  document.body.appendChild(chat);

  const msgs = chat.querySelector(".ai-msgs");
  const input = chat.querySelector("input");
  const form = chat.querySelector("form");

  fab.addEventListener("click", () => {
    chat.hidden = !chat.hidden;
    if (!chat.hidden) input.focus();
  });
  chat.querySelector(".ai-close").addEventListener("click", () => { chat.hidden = true; });

  msgs.addEventListener("click", (e) => {
    const chip = e.target.closest(".ai-chips button");
    if (!chip) return;
    input.value = chip.dataset.q;
    form.requestSubmit();
  });

  function addChips() {
    if (msgs.querySelector(".ai-chips")) return;
    msgs.insertAdjacentHTML("beforeend",
      '<div class="ai-chips">' +
        '<button type="button" data-q="Bagaimana cara beli paket premium?">🛒 Cara beli paket</button>' +
        '<button type="button" data-q="Apa benefit paket premium dan unlimited?">✨ Benefit paket</button>' +
        '<button type="button" data-q="Bagaimana cara pakai generator PRD?">📄 Cara pakai PRD</button>' +
      "</div>");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    msgs.insertAdjacentHTML("beforeend", '<div class="ai-msg user">' + q.replace(/</g, "&lt;") + "</div>");
    input.value = "";
    msgs.insertAdjacentHTML("beforeend", '<div class="ai-msg bot typing"><i class="ph ph-circle-notch" style="animation:demo-spin .8s linear infinite;display:inline-block"></i> Mengetik...</div>');
    msgs.scrollTop = msgs.scrollHeight;
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: q })
      });
      const data = await res.json();
      msgs.lastElementChild.remove();
      if (!res.ok || !data.ok) throw new Error(data.error || "Gagal menjawab.");
      msgs.insertAdjacentHTML("beforeend", '<div class="ai-msg bot">' + String(data.reply).replace(/</g, "&lt;").replace(/\n/g, "<br>") + "</div>");
      addChips();
    } catch (err) {
      msgs.lastElementChild.remove();
      const m = err.message === "Failed to fetch" || err.message === "Load failed"
        ? "Server sedang tidak bisa dihubungi. Coba lagi sebentar ya."
        : "⚠ " + err.message;
      msgs.insertAdjacentHTML("beforeend", '<div class="ai-msg bot error">' + m + "</div>");
    }
    msgs.scrollTop = msgs.scrollHeight;
  });
})();
