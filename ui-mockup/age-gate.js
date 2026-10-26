/** COPPA-style 13+ gate before Internet Identity sign-in. No DOB collected. */
(function () {
  const STORAGE_KEY = "trp_age_ok";

  function isAgeConfirmed() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function persistAgeConfirmed() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch (_) {
      /* private mode — session only */
    }
  }

  /**
   * @returns {Promise<boolean>} true if user confirmed 13+; false if cancelled / under 13
   */
  function ensureAgeConfirmed() {
    if (isAgeConfirmed()) return Promise.resolve(true);

    return new Promise(function (resolve) {
      const overlay = document.createElement("div");
      overlay.className = "trp-age-overlay";
      overlay.setAttribute("role", "presentation");

      const dialog = document.createElement("div");
      dialog.className = "trp-age-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "trpAgeTitle");
      dialog.setAttribute("aria-describedby", "trpAgeDesc");

      dialog.innerHTML =
        '<h2 id="trpAgeTitle">Age confirmation</h2>' +
        '<p id="trpAgeDesc">You must be <strong>13 or older</strong> to use The Raven Project.</p>' +
        '<p class="trp-age-note">We do not ask for your date of birth. This is a one-time confirmation on this device.</p>' +
        '<div class="trp-age-actions">' +
        '<button type="button" class="btn primary mini" id="trpAgeConfirm">I am 13 or older</button>' +
        '<button type="button" class="btn ghost mini" id="trpAgeCancel">I&rsquo;m under 13 / Cancel</button>' +
        '</div>';

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      document.body.classList.add("trp-age-open");

      const focusables = dialog.querySelectorAll("button");
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      function cleanup() {
        document.removeEventListener("keydown", onKey);
        document.body.classList.remove("trp-age-open");
        overlay.remove();
      }

      function confirm() {
        persistAgeConfirmed();
        cleanup();
        resolve(true);
      }

      function cancel() {
        cleanup();
        resolve(false);
      }

      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
          return;
        }
        if (e.key === "Tab" && focusables.length) {
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }

      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) cancel();
      });
      dialog.querySelector("#trpAgeConfirm").addEventListener("click", confirm);
      dialog.querySelector("#trpAgeCancel").addEventListener("click", cancel);
      document.addEventListener("keydown", onKey);
      first.focus();
    });
  }

  // Block screen shown when someone declines / indicates under 13 on first visit.
  function showUnderageBlock() {
    if (document.querySelector(".trp-age-block")) return;
    const block = document.createElement("div");
    block.className = "trp-age-overlay trp-age-block";
    block.setAttribute("role", "presentation");
    block.innerHTML =
      '<div class="trp-age-dialog" role="dialog" aria-modal="true" aria-labelledby="trpAgeBlockTitle">' +
      '<h2 id="trpAgeBlockTitle">Come back when you’re 13</h2>' +
      "<p>You must be <strong>13 or older</strong> to use The Raven Project.</p>" +
      '<div class="trp-age-actions">' +
      '<button type="button" class="btn primary mini" id="trpAgeRetry">I am 13 or older</button>' +
      "</div></div>";
    document.body.appendChild(block);
    document.body.classList.add("trp-age-open");
    const retry = block.querySelector("#trpAgeRetry");
    retry.addEventListener("click", function () {
      persistAgeConfirmed();
      document.body.classList.remove("trp-age-open");
      block.remove();
    });
    retry.focus();
  }

  // First-visit gate: prompt once before any use (covers anonymous generation,
  // not just Internet Identity sign-in). One-time per device via localStorage.
  function runFirstVisitGate() {
    if (isAgeConfirmed()) return;
    ensureAgeConfirmed().then(function (ok) {
      if (!ok) showUnderageBlock();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runFirstVisitGate);
  } else {
    runFirstVisitGate();
  }

  window.TRP_AGE = {
    isAgeConfirmed,
    ensureAgeConfirmed,
  };
})();
