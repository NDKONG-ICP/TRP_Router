/** Lightweight notice: no tracking cookies; esm.sh loads @dfinity libraries only. */
(function () {
  const KEY = "trp_privacy_notice_dismissed";

  function dismissed() {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function init() {
    if (dismissed()) return;
    const bar = document.createElement("div");
    bar.className = "trp-privacy-bar";
    bar.setAttribute("role", "status");
    bar.innerHTML =
      '<p>This site uses <strong>no</strong> third-party analytics, session replay, or tracking cookies. ' +
      'We load <code>@dfinity/*</code> libraries from <code>esm.sh</code> so Internet Identity works. ' +
      '<a href="privacy.html">Privacy Policy</a></p>' +
      '<button type="button" class="btn ghost mini" id="trpPrivacyDismiss">Dismiss</button>';
    document.body.appendChild(bar);
    bar.querySelector("#trpPrivacyDismiss").addEventListener("click", function () {
      try {
        localStorage.setItem(KEY, "1");
      } catch (_) {
        /* ignore */
      }
      bar.remove();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
