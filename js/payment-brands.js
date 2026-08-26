/* Shared payment-brand registry — used by bayar.js (customer) & admin.html (admin).
   Maps a payment method name to its local logo file in assets/payments/. */
(function (global) {
  "use strict";

  // slug -> logo file bundled in assets/payments/
  var LOGO_FILES = {
    qris: "qris.svg",
    bca: "bca.svg",
    bri: "bri.svg",
    bni: "bni.svg",
    mandiri: "mandiri.svg",
    dana: "dana.svg",
    ovo: "ovo.svg",
    gopay: "gopay.svg",
    seabank: "seabank.svg",
    shopeepay: "shopeepay.svg"
  };

  // brand accent color used for the fallback chip (when no logo matches)
  var BRAND_COLOR = {
    qris: "#8b5cf6", bca: "#0060af", bri: "#00529c", bni: "#f15a22",
    mandiri: "#003d79", dana: "#118eea", ovo: "#4c2a86", gopay: "#00aa13",
    seabank: "#ff5a1f", shopeepay: "#ee4d2d"
  };

  // name/keyword -> slug (first match wins; order matters)
  var MATCHERS = [
    [/shopee\s*pay|shopeepay/i, "shopeepay"],
    [/sea\s*bank|seabank/i, "seabank"],
    [/\bqris\b/i, "qris"],
    [/central\s*asia|\bbca\b/i, "bca"],
    [/rakyat\s*indonesia|\bbri\b/i, "bri"],
    [/negara\s*indonesia|\bbni\b/i, "bni"],
    [/mandiri/i, "mandiri"],
    [/\bdana\b/i, "dana"],
    [/gojek|go-?pay|gopay/i, "gopay"],
    [/\bovo\b/i, "ovo"]
  ];

  function slugFor(name) {
    var n = String(name == null ? "" : name);
    for (var i = 0; i < MATCHERS.length; i++) {
      if (MATCHERS[i][0].test(n)) return MATCHERS[i][1];
    }
    return null;
  }

  function esc(str) {
    var d = document.createElement("div");
    d.textContent = String(str == null ? "" : str);
    return d.innerHTML;
  }

  // Returns HTML for a logo tile. size: "sm" (table thumb) | "md" (card) | "chip" (strip)
  function logoHtml(name, size) {
    var slug = slugFor(name);
    var cls = "pay-logo" + (size ? " pay-logo-" + size : "");
    if (slug && LOGO_FILES[slug]) {
      return '<span class="' + cls + '">' +
        '<img src="assets/payments/' + LOGO_FILES[slug] + '" alt="' + esc(name) + '" loading="lazy" />' +
        "</span>";
    }
    // fallback: brand-colored chip with short label (first 2 letters)
    var color = (slug && BRAND_COLOR[slug]) || "var(--accent-strong)";
    var label = esc(String(name || "?").replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "?");
    return '<span class="' + cls + ' pay-logo-fallback" style="--chip:' + color + '">' + label + "</span>";
  }

  global.PaymentBrands = { slugFor: slugFor, logoHtml: logoHtml, LOGO_FILES: LOGO_FILES };
})(window);
