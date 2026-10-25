/** Admin metrics tab — client-side II allowlist is UX only, not security. */
(function () {
  const AGENT_VER = "2.4.1";
  const agentUrl =
    "https://esm.sh/@dfinity/agent@" + AGENT_VER;
  const candidUrl =
    "https://esm.sh/@dfinity/candid@" + AGENT_VER;
  const CHART_URL =
    "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";

  /** UX gate only — real admin checks must use an on-chain is_admin query later. */
  const ADMIN_PRINCIPALS = new Set([
    "ucw6l-apn5m-ycnrv-s7xtt-lvchu-jz5f3-3oeq7-ttuhk-rjvjp-sdnbj-lqe",
    "72w3b-oy3is-urqu2-sjyxa-oh5nc-lfs2i-p3mzm-tq3j5-pokxx-hc7ym-wqe",
  ]);

  const cfg = () => window.TRP?.cfg?.() || window.TRP_PLAYGROUND || {};
  const routerId = () => cfg().routerCanisterId || "5723t-oaaaa-aaaao-bbquq-cai";
  const meterId = () => cfg().trpMeterCanisterId || "6gk2j-eiaaa-aaaao-bbq5a-cai";
  const diffusionId = () =>
    cfg().diffusionCanisterId || "7chv3-5iaaa-aaaao-bbq3a-cai";

  const gateEl = document.getElementById("adminGate");
  const dashEl = document.getElementById("adminDashboard");
  const healthEl = document.getElementById("adminHealthList");

  let pollTimer = null;
  let chartJsPromise = null;
  let genChart = null;
  let cycChart = null;
  const history = [];

  function routerIdl({ IDL }) {
    return IDL.Service({
      generation_stats: IDL.Func(
        [],
        [
          IDL.Record({
            total_generations: IDL.Nat64,
            cycles_per_image: IDL.Nat64,
            cycles_burned_est: IDL.Nat,
          }),
        ],
        ["query"],
      ),
    });
  }

  function meterIdl({ IDL }) {
    return IDL.Service({
      meter_status: IDL.Func(
        [],
        [
          IDL.Record({
            free_budget_tc_remaining: IDL.Nat64,
            global_free_spent_tc: IDL.Nat64,
          }),
        ],
        ["query"],
      ),
      credit_balance: IDL.Func([], [IDL.Nat], ["query"]),
    });
  }

  async function anonActor(idlFactory, canisterId) {
    const { HttpAgent, Actor } = await import(agentUrl);
    const { IDL } = await import(candidUrl);
    const agent = await HttpAgent.create({ host: "https://icp-api.io" });
    return Actor.createActor(idlFactory, { agent, canisterId });
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function loadChartJs() {
    if (chartJsPromise) return chartJsPromise;
    chartJsPromise = new Promise(function (resolve, reject) {
      if (window.Chart) {
        resolve(window.Chart);
        return;
      }
      const s = document.createElement("script");
      s.src = CHART_URL;
      s.async = true;
      s.onload = function () {
        resolve(window.Chart);
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return chartJsPromise;
  }

  function chartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? false
        : { duration: 400 },
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: {
          display: true,
          ticks: { color: "#776a94", font: { size: 10 } },
          grid: { color: "rgba(168,133,255,.12)" },
        },
      },
      elements: {
        line: { tension: 0.35, borderWidth: 2 },
        point: { radius: 0, hitRadius: 8 },
      },
    };
  }

  async function ensureCharts() {
    const Chart = await loadChartJs();
    Chart.defaults.color = "#a498c0";
    Chart.defaults.borderColor = "rgba(168,133,255,.16)";
    const genCtx = document.getElementById("adminGenChart");
    const cycCtx = document.getElementById("adminCycChart");
    if (genCtx && !genChart) {
      genChart = new Chart(genCtx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              data: [],
              borderColor: "#f6cc5b",
              backgroundColor: "rgba(246,204,91,.12)",
              fill: true,
            },
          ],
        },
        options: chartOptions(),
      });
    }
    if (cycCtx && !cycChart) {
      cycChart = new Chart(cycCtx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              data: [],
              borderColor: "#a855f7",
              backgroundColor: "rgba(168,85,247,.15)",
              fill: true,
            },
          ],
        },
        options: chartOptions(),
      });
    }
  }

  function pushHistory(gen, tc) {
    const t = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    history.push({ t, gen, tc });
    if (history.length > 40) history.shift();
    if (genChart && cycChart) {
      genChart.data.labels = history.map(function (h) {
        return h.t;
      });
      genChart.data.datasets[0].data = history.map(function (h) {
        return h.gen;
      });
      cycChart.data.labels = history.map(function (h) {
        return h.t;
      });
      cycChart.data.datasets[0].data = history.map(function (h) {
        return h.tc;
      });
      genChart.update();
      cycChart.update();
    }
  }

  async function fetchRouterStatus() {
    const base = window.TRP?.routerQueryBase?.() || "";
    const url = (base || "https://5723t-oaaaa-aaaao-bbquq-cai.raw.icp0.io") + "/v1/status";
    const res = await fetch(url);
    if (!res.ok) throw new Error("status " + res.status);
    return res.json();
  }

  function renderHealth(st, err) {
    if (!healthEl) return;
    if (err) {
      healthEl.innerHTML =
        '<p class="mono err">Router status unavailable: ' +
        String(err.message || err) +
        "</p>";
      return;
    }
    const rows = (st.providers || [])
      .map(function (p) {
        const ok = p.healthy && !p.circuit_open;
        return (
          '<div class="admin-health-row">' +
          '<span class="nm">' +
          p.name +
          "</span>" +
          '<span class="badge ' +
          (ok ? "ok" : "warn") +
          '">' +
          (ok ? "healthy" : p.circuit_open ? "circuit open" : "degraded") +
          "</span></div>"
        );
      })
      .join("");
    healthEl.innerHTML =
      rows +
      '<div class="admin-health-row"><span class="nm">on-chain models</span><span class="badge ' +
      (st.onchain_models_ready ? "ok" : "warn") +
      '">' +
      (st.onchain_models_ready ? "ready" : "not ready") +
      '</span></div><div class="admin-health-row"><span class="nm">diffusion canister</span><span class="mono muted">' +
      diffusionId() +
      '</span></div><div class="admin-health-row"><span class="nm">payments</span><span class="badge ' +
      (st.payments_enabled ? "ok" : "muted") +
      '">' +
      (st.payments_enabled ? "enabled" : "off") +
      "</span></div>";
  }

  async function refreshMetrics() {
    if (!dashEl || dashEl.hasAttribute("hidden")) return;
    try {
      const router = await anonActor(routerIdl, routerId());
      const meter = await anonActor(meterIdl, meterId());
      const [stats, mstat, credits] = await Promise.all([
        router.generation_stats(),
        meter.meter_status(),
        meter.credit_balance(),
      ]);
      const gen = Number(stats.total_generations);
      const tc = Number(stats.cycles_burned_est) / 1e12;
      setText("adminGenTotal", gen.toLocaleString("en-US"));
      setText("adminCyclesTotal", "≈ " + tc.toFixed(3) + " TC");
      setText(
        "adminMeterBudget",
        Number(mstat.free_budget_tc_remaining).toLocaleString("en-US") + " TC",
      );
      setText(
        "adminMeterSpent",
        Number(mstat.global_free_spent_tc).toLocaleString("en-US") + " TC",
      );
      setText("adminMeterCredits", credits.toString());
      await ensureCharts();
      pushHistory(gen, tc);
      try {
        const st = await fetchRouterStatus();
        renderHealth(st, null);
      } catch (e) {
        renderHealth(null, e);
      }
    } catch (e) {
      setText("adminGenTotal", "—");
      if (healthEl)
        healthEl.innerHTML =
          '<p class="mono err">' + String(e.message || e) + "</p>";
    }
  }

  async function showDashboard() {
    if (gateEl) gateEl.hidden = true;
    if (dashEl) dashEl.removeAttribute("hidden");
    await refreshMetrics();
  }

  function showGate(message) {
    if (dashEl) dashEl.setAttribute("hidden", "");
    if (gateEl) {
      gateEl.hidden = false;
      const msg = gateEl.querySelector(".admin-gate-msg");
      if (msg) msg.textContent = message;
    }
  }

  async function checkAccess() {
    try {
      await window.TRP.ensureII();
      const { principal } = window.TRP.getII();
      if (!principal) {
        showGate("Sign in with Internet Identity to open the admin panel.");
        return;
      }
      if (!ADMIN_PRINCIPALS.has(principal)) {
        showGate("This principal is not on the admin allowlist.");
        return;
      }
      await showDashboard();
    } catch (e) {
      showGate(String(e.message || e));
    }
  }

  function onViewVisible() {
    checkAccess();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshMetrics, 15000);
  }

  function onViewHidden() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  document.getElementById("adminSignIn")?.addEventListener("click", checkAccess);
  document.getElementById("adminRefresh")?.addEventListener("click", refreshMetrics);

  window.TRP_ADMIN = { onViewVisible, onViewHidden, checkAccess };
})();
