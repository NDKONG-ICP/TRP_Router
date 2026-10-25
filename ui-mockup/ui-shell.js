/** Tab views + mobile accordions. Preserves all inner element IDs. */
(function () {
  const VIEW_IDS = ["playground", "models", "wallet", "status", "admin", "docs"];

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $all(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function makeAccordion(title, mobileOpen) {
    const details = document.createElement("details");
    details.className = "acc-tile";
    if (mobileOpen) details.dataset.accMobileOpen = "true";
    else details.dataset.accDefault = "open";
    const summary = document.createElement("summary");
    summary.className = "acc-summary";
    summary.innerHTML =
      '<span class="acc-title">' +
      title +
      '</span><span class="acc-chev" aria-hidden="true"></span>';
    const body = document.createElement("div");
    body.className = "acc-body";
    details.appendChild(summary);
    details.appendChild(body);
    return { details, body };
  }

  function wrapSectionContent(sec, title, mobileOpen) {
    if (!sec || sec.dataset.accWrapped) return;
    const head = $(".sec-head", sec);
    const nodes = [];
    let n = head ? head.nextElementSibling : sec.firstElementChild;
    while (n) {
      nodes.push(n);
      n = n.nextElementSibling;
    }
    if (!nodes.length) return;
    const acc = makeAccordion(title, !!mobileOpen);
    nodes.forEach(function (node) {
      acc.body.appendChild(node);
    });
    sec.appendChild(acc.details);
    sec.dataset.accWrapped = "1";
  }

  function wrapPanelInAccordion(panel, title, opts) {
    if (!panel || panel.closest("details.acc-tile")) return null;
    const acc = makeAccordion(title, !!(opts && opts.mobileOpen));
    if (opts && opts.defaultOpen) acc.details.dataset.accDefault = "open";
    panel.replaceWith(acc.details);
    acc.body.appendChild(panel);
    return acc.details;
  }

  function initPlaygroundAccordions() {
    const consoleEl = $("#playground .console");
    if (!consoleEl || consoleEl.dataset.accWrapped) return;
    const panels = $all(":scope > .panel", consoleEl);
    if (panels.length < 2) return;
    const titles = ["Generate · Raven Diffusion", "On-chain chat"];
    panels.forEach(function (panel, i) {
      wrapPanelInAccordion(panel, titles[i], {
        defaultOpen: i === 0,
        mobileOpen: i === 0,
      });
    });
    consoleEl.classList.add("acc-stack");
    consoleEl.dataset.accWrapped = "1";
  }

  function initModelsAccordion() {
    const sec = $("#models");
    const panel = sec && $(".panel", sec);
    if (!panel || panel.closest("details.acc-tile")) return;
    const head = $(".sec-head", sec);
    wrapPanelInAccordion(panel, "Model catalog", { defaultOpen: true, mobileOpen: false });
    if (head) head.classList.add("acc-sec-head");
  }

  function initWalletAccordions() {
    const root = $(".wallet-panel");
    if (!root || root.dataset.accWrapped) return;

    const row = $(".wallet-row", root);
    const bal = $(".wallet-balances", root);
    if (row && bal) {
      const acc = makeAccordion("Account & balances", true);
      acc.body.appendChild(row);
      acc.body.appendChild(bal);
      root.insertBefore(acc.details, root.firstChild);
    }

    $all("h4", root).slice().forEach(function (h4) {
      const title = h4.textContent.trim();
      // Collect this section's content: following siblings until the next h4.
      // Stop at any already-built accordion so a later section can't swallow an
      // earlier one (that nesting put Buy credits inside the Your-NFTs tile).
      const nodes = [];
      let n = h4.nextElementSibling;
      while (n && n.tagName !== "H4" && !n.classList.contains("acc-tile")) {
        nodes.push(n);
        n = n.nextElementSibling;
      }
      const acc = makeAccordion(title, false);
      const lt = title.toLowerCase();
      if (lt.indexOf("nft") >= 0) {
        delete acc.details.dataset.accDefault;
        acc.details.dataset.accMobileOpen = "false";
      } else if (lt.indexOf("buy generation") >= 0) {
        // Keep the credits shop open by default (incl. mobile) so it's easy to find.
        acc.details.dataset.accDefault = "open";
        acc.details.dataset.accMobileOpen = "true";
      }
      // Place the accordion where the h4 was so sections keep their order (instead
      // of appending to the end, which let the last section absorb the rest).
      h4.replaceWith(acc.details);
      nodes.forEach(function (node) {
        acc.body.appendChild(node);
      });
    });

    root.dataset.accWrapped = "1";
  }

  function initStatusAccordion() {
    const sec = $("#status");
    const panel = sec && sec.querySelector(".panel");
    if (!panel || panel.closest("details.acc-tile")) return;
    wrapPanelInAccordion(panel, "Provider health & failover demo", {
      defaultOpen: true,
      mobileOpen: false,
    });
  }

  function initDocsAccordions() {
    [
      ["#docs", "Developer quickstart"],
      ["#build", "Architecture diagram"],
      ["#holders", "Holder tiers"],
      ["#proof", "On-chain verification"],
    ].forEach(function (pair) {
      const sec = $(pair[0]);
      if (sec) $(".sec-head", sec)?.classList.add("acc-sec-head");
      wrapSectionContent(sec, pair[1], false);
    });
  }

  function applyAccordionOpenState() {
    const mobile = window.matchMedia("(max-width: 720px)").matches;
    $all("details.acc-tile").forEach(function (d) {
      if (d.dataset.accDefault === "open" && !mobile) {
        d.open = true;
        return;
      }
      if (mobile) {
        d.open = d.dataset.accMobileOpen === "true";
      } else {
        d.open = true;
      }
    });
  }

  function markViews() {
    const map = {
      playground: ["#playground"],
      models: ["#models"],
      wallet: ["#wallet"],
      status: ["#status"],
      admin: ["#admin"],
      docs: ["#docs", "#build", "#holders", "#proof"],
    };
    Object.keys(map).forEach(function (view) {
      map[view].forEach(function (sel) {
        const el = $(sel);
        if (!el) return;
        el.classList.add("app-view");
        el.dataset.view = view;
      });
    });
  }

  function setActiveView(view) {
    if (VIEW_IDS.indexOf(view) < 0) view = "playground";
    $all(".app-view").forEach(function (el) {
      el.hidden = el.dataset.view !== view;
    });
    $all(".app-tab").forEach(function (btn) {
      const on = btn.dataset.view === view;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    const hero = $("#hero");
    if (hero) hero.hidden = view !== "playground";
    if (location.hash.replace("#", "") !== view) {
      history.replaceState(null, "", "#" + view);
    }
    if (view === "admin" && window.TRP_ADMIN && window.TRP_ADMIN.onViewVisible) {
      window.TRP_ADMIN.onViewVisible();
    } else if (window.TRP_ADMIN && window.TRP_ADMIN.onViewHidden) {
      window.TRP_ADMIN.onViewHidden();
    }
  }

  function initTabs() {
    const bar = $("#appTabs");
    if (!bar) return;
    bar.addEventListener("click", function (e) {
      const btn = e.target.closest(".app-tab");
      if (!btn || !btn.dataset.view) return;
      e.preventDefault();
      setActiveView(btn.dataset.view);
    });
    $all('.nav-links a[data-view], a[href^="#"]').forEach(function (a) {
      const v = a.dataset.view || (a.getAttribute("href") || "").replace("#", "");
      if (VIEW_IDS.indexOf(v) >= 0) {
        a.addEventListener("click", function (ev) {
          ev.preventDefault();
          setActiveView(v);
        });
      }
    });
    const initial = VIEW_IDS.indexOf(location.hash.replace("#", "")) >= 0
      ? location.hash.replace("#", "")
      : "playground";
    setActiveView(initial);
    window.addEventListener("hashchange", function () {
      const v = location.hash.replace("#", "");
      if (VIEW_IDS.indexOf(v) >= 0) setActiveView(v);
    });
  }

  function boot() {
    markViews();
    initPlaygroundAccordions();
    initModelsAccordion();
    initWalletAccordions();
    initStatusAccordion();
    initDocsAccordions();
    applyAccordionOpenState();
    window
      .matchMedia("(max-width: 720px)")
      .addEventListener("change", applyAccordionOpenState);
    initTabs();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.TRP_SHELL = { setActiveView };
})();
