/* Themed dropdown: mempercantik <select> native tanpa mengubah logika form.
   Select asli tetap ada (disembunyikan) sebagai sumber value + event 'change'. */
(() => {
  "use strict";

  let openInstance = null;

  function closeOpen() {
    if (openInstance) openInstance.close();
  }

  document.addEventListener("click", closeOpen);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOpen();
  });

  function enhance(select) {
    if (select.dataset.nvEnhanced === "1") return;
    select.dataset.nvEnhanced = "1";

    const wrap = document.createElement("div");
    wrap.className = "nv-select";
    // Varian compact untuk dropdown admin (pas di baris tabel/grid).
    if (select.classList.contains("admin-select")) wrap.classList.add("nv-select--inline");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "nv-select-trigger try-input";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.innerHTML =
      '<span class="nv-select-value"></span><i class="ph ph-caret-down nv-select-caret" aria-hidden="true"></i>';

    const list = document.createElement("ul");
    list.className = "nv-select-list";
    list.setAttribute("role", "listbox");

    const valueEl = trigger.querySelector(".nv-select-value");

    function syncFromSelect() {
      const opt = select.options[select.selectedIndex];
      valueEl.textContent = opt ? opt.textContent : "";
      list.querySelectorAll(".nv-select-option").forEach((li) => {
        li.classList.toggle("active", li.dataset.value === select.value);
      });
      // Cerminkan status disabled dari select asli (mis. saat edit metode pembayaran).
      trigger.disabled = select.disabled;
      wrap.classList.toggle("nv-select--disabled", select.disabled);
      if (select.disabled) inst.close();
    }
    function buildOptions() {
      list.innerHTML = "";
      Array.from(select.options).forEach((opt, i) => {
        const li = document.createElement("li");
        li.className = "nv-select-option";
        li.setAttribute("role", "option");
        li.dataset.value = opt.value;
        li.dataset.index = String(i);
        li.textContent = opt.textContent;
        li.addEventListener("click", (e) => {
          e.stopPropagation();
          if (select.value !== opt.value || select.selectedIndex !== i) {
            select.selectedIndex = i;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
          syncFromSelect();
          inst.close();
        });
        list.appendChild(li);
      });
    }

    const inst = {
      open() {
        closeOpen();
        buildOptions();
        syncFromSelect();
        // Portal: keluarkan list dari ancestor yang meng-clip (overflow/backdrop-filter),
        // supaya seluruh opsi terlihat penuh (tidak terpotong walau di dalam kartu/tabel).
        document.body.appendChild(list);
        list.classList.add("nv-select-list--portal");
        wrap.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
        openInstance = inst;
        positionList();
        window.addEventListener("scroll", onReposition, true);
        window.addEventListener("resize", onReposition);
        const active = list.querySelector(".nv-select-option.active");
        if (active) active.scrollIntoView({ block: "nearest" });
      },
      close() {
        window.removeEventListener("scroll", onReposition, true);
        window.removeEventListener("resize", onReposition);
        wrap.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
        list.classList.remove("nv-select-list--portal");
        list.removeAttribute("style");
        if (list.parentNode !== wrap) wrap.appendChild(list);
        if (openInstance === inst) openInstance = null;
      },
      toggle() { wrap.classList.contains("open") ? inst.close() : inst.open(); },
    };

    function onReposition() {
      if (openInstance === inst) positionList();
    }

    function positionList() {
      const r = trigger.getBoundingClientRect();
      const gap = 8;
      const cap = 320;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const spaceBelow = vh - r.bottom - gap;
      const spaceAbove = r.top - gap;
      const flipUp = spaceBelow < 180 && spaceAbove > spaceBelow;

      const isInline = wrap.classList.contains("nv-select--inline");
      let width = isInline ? Math.max(r.width, 240) : r.width;
      const maxRight = vw - 12;
      let left = r.left;
      if (left + width > maxRight) left = Math.max(12, maxRight - width);

      const maxH = Math.max(140, Math.min(cap, flipUp ? spaceAbove : spaceBelow));

      list.style.position = "fixed";
      list.style.left = Math.round(left) + "px";
      list.style.right = "auto";
      list.style.width = Math.round(width) + "px";
      list.style.minWidth = Math.round(width) + "px";
      list.style.maxHeight = maxH + "px";
      if (flipUp) {
        list.style.top = "auto";
        list.style.bottom = Math.round(vh - r.top + gap) + "px";
      } else {
        list.style.top = Math.round(r.bottom + gap) + "px";
        list.style.bottom = "auto";
      }
    }
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      inst.toggle();
    });

    trigger.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!wrap.classList.contains("open")) return inst.open();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        let idx = select.selectedIndex + dir;
        idx = Math.max(0, Math.min(select.options.length - 1, idx));
        select.selectedIndex = idx;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        syncFromSelect();
        const li = list.querySelector('.nv-select-option[data-index="' + idx + '"]');
        if (li) li.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        inst.toggle();
      }
    });

    list.addEventListener("click", (e) => e.stopPropagation());

    // Susun DOM: wrapper menggantikan posisi select, select disembunyikan di dalamnya.
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    wrap.appendChild(trigger);
    wrap.appendChild(list);
    select.classList.add("nv-select-native");
    select.setAttribute("tabindex", "-1");
    select.setAttribute("aria-hidden", "true");

    // Kalau kode lain mengubah value select secara programatik.
    select.addEventListener("change", syncFromSelect);

    buildOptions();
    syncFromSelect();
  }

  function enhanceAll() {
    document.querySelectorAll("select.try-input, select.admin-select").forEach(enhance);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhanceAll);
  } else {
    enhanceAll();
  }

  window.nvSelectEnhance = enhanceAll;
})();
