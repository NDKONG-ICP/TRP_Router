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

  window.TRP_AGE = {
    isAgeConfirmed,
    ensureAgeConfirmed,
  };
})();
