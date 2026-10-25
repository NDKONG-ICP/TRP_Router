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
  const payId = () => cfg().trpPayCanisterId || "ujwwi-hiaaa-aaaao-bbrha-cai";

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
      router_status: IDL.Func(
        [],
        [
          IDL.Record({
            providers: IDL.Vec(
              IDL.Record({
                name: IDL.Text,
                healthy: IDL.Bool,
                last_error: IDL.Opt(IDL.Text),
                circuit_open: IDL.Bool,
              }),
            ),
            payments_enabled: IDL.Bool,
            onchain_models_ready: IDL.Bool,
          }),
        ],
        ["query"],
      ),
      get_trp_pay: IDL.Func([], [IDL.Opt(IDL.Principal)], ["query"]),
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
      credit_balance: IDL.Func([], [IDL.Nat], ["query"]), // on-chain nat, not nat64
    });
  }

  async function anonActor(idlFactory, canisterId) {
    const { HttpAgent, Actor } = await import(agentUrl);
    await import(candidUrl);
    const agent = await HttpAgent.create({ host: "https://icp-api.io" });
    return Actor.createActor(idlFactory, { agent, canisterId });
  }

  async function adminPayActor() {
    const { HttpAgent, Actor } = await import(agentUrl);
    const { IDL } = await import(candidUrl);
    const { Principal } = await import(
      "https://esm.sh/@dfinity/principal@" + AGENT_VER
    );
    await window.TRP.ensureII();
    const { authIdentity } = window.TRP.getII();
    const agent = await HttpAgent.create({
      host: "https://icp-api.io",
      identity: authIdentity,
    });
    const NatResult = IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text });
    const OkErr = function (t) {
      return IDL.Variant({ Ok: t, Err: IDL.Text });
    };
    const idl = ({ IDL: I }) =>
      I.Service({
        get_config: I.Func(
          [],
          [
            I.Record({
              payments_enabled: I.Bool,
              treasury: I.Principal,
              cycles_slice_e8s: I.Nat64,
            }),
          ],
          ["query"],
        ),
        get_convert_config: I.Func(
          [],
          [
            I.Record({
              auto_convert_enabled: I.Bool,
              slippage_bps: I.Nat32,
              liquidity_share_bps: I.Nat32,
              liquidity_add_enabled: I.Bool,
              trp_liquidity_pool: I.Principal,
            }),
          ],
          ["query"],
        ),
        set_config: I.Func(
          [
            I.Record({
              payments_enabled: I.Opt(I.Bool),
              icp_ledger: I.Opt(I.Principal),
              treasury: I.Opt(I.Principal),
              diffusion_canister: I.Opt(I.Principal),
              cmc: I.Opt(I.Principal),
              router: I.Opt(I.Principal),
              cycles_slice_e8s: I.Opt(I.Nat64),
              auto_convert_enabled: I.Opt(I.Bool),
              slippage_bps: I.Opt(I.Nat32),
              liquidity_share_bps: I.Opt(I.Nat32),
              liquidity_add_enabled: I.Opt(I.Bool),
              trp_liquidity_pool: I.Opt(I.Principal),
            }),
          ],
          [OkErr(I.Null)],
          [],
        ),
        admin_list_pending: I.Func(
          [I.Nat32],
          [
            OkErr(
              I.Vec(
                I.Record({
                  id: I.Nat64,
                  user: I.Principal,
                  token_ledger: I.Principal,
                  pool: I.Principal,
                  token_amount: I.Nat,
                  pack_index: I.Nat32,
                  icp_e8s: I.Nat64,
                  credits: I.Nat64,
                  status: I.Variant({
                    Pending: I.Null,
                    Converted: I.Null,
                    Refunded: I.Null,
                    Failed: I.Null,
                  }),
                  last_error: I.Text,
                  at_ns: I.Nat64,
                }),
              ),
            ),
          ],
          ["query"],
        ),
        admin_retry_conversion: I.Func([I.Nat64], [OkErr(I.Null)], []),
        admin_refund_pending: I.Func([I.Nat64], [OkErr(I.Null)], []),
        admin_treasury_view: I.Func(
          [],
          [
            OkErr(
              I.Record({
                payments_enabled: I.Bool,
                treasury: I.Principal,
                pay_canister_icp_e8s: I.Nat64,
                cycles_slice_e8s: I.Nat64,
              }),
            ),
          ],
          [],
        ),
        admin_list_credit_balances: I.Func(
          [I.Nat32],
          [OkErr(I.Vec(I.Record({ user: I.Principal, credits: I.Nat64 })))],
          ["query"],
        ),
        admin_list_recent_purchases: I.Func(
          [I.Nat32],
          [
            OkErr(
              I.Vec(
                I.Record({
                  id: I.Nat64,
                  user: I.Principal,
                  pack_index: I.Nat32,
                  icp_e8s: I.Nat64,
                  credits: I.Nat64,
                  at_ns: I.Nat64,
                }),
              ),
            ),
          ],
          ["query"],
        ),
        sweep_to_treasury: I.Func([], [NatResult], []),
        admin_refund_icp: I.Func([I.Principal, I.Nat64], [NatResult], []),
        admin_grant_credits: I.Func([I.Principal, I.Nat64], [NatResult], []),
        admin_set_treasury: I.Func([I.Principal], [OkErr(I.Null)], []),
        admin_treasury_icp_balance_e8s: I.Func(
          [],
          [OkErr(I.Nat64)],
          [],
        ),
      });
    return {
      actor: Actor.createActor(idl, { agent, canisterId: payId() }),
      Principal,
    };
  }

  function setPayStatus(msg) {
    const el = document.getElementById("adminPayStatus");
    if (el) el.textContent = msg || "";
  }

  function renderCreditList(rows) {
    const el = document.getElementById("adminCreditList");
    if (!el) return;
    if (!rows || !rows.length) {
      el.innerHTML = "<p>No credit balances yet.</p>";
      return;
    }
    el.innerHTML = rows
      .map(function (r) {
        return (
          '<div class="admin-table-row">' +
          r.user.toText() +
          " · <strong>" +
          r.credits +
          "</strong> credits</div>"
        );
      })
      .join("");
  }

  function renderPurchaseList(rows) {
    const el = document.getElementById("adminPurchaseList");
    if (!el) return;
    if (!rows || !rows.length) {
      el.innerHTML = "<p>No purchases logged yet (upgraded canister).</p>";
      return;
    }
    el.innerHTML = rows
      .map(function (r) {
        const icp = (Number(r.icp_e8s) / 1e8).toFixed(4);
        return (
          '<div class="admin-table-row">#' +
          r.id +
          " · " +
          r.user.toText() +
          " · " +
          icp +
          " ICP → " +
          r.credits +
          " cr</div>"
        );
      })
      .join("");
  }

  async function refreshPayments() {
    try {
      const { actor } = await adminPayActor();
      const [viewRes, balRes, purRes, convCfg, pendRes] = await Promise.all([
        actor.admin_treasury_view(),
        actor.admin_list_credit_balances(100),
        actor.admin_list_recent_purchases(50),
        actor.get_convert_config().catch(function () {
          return null;
        }),
        actor.admin_list_pending(20).catch(function () {
          return { Err: "unsupported" };
        }),
      ]);
      if ("Err" in viewRes) throw new Error(viewRes.Err);
      const v = viewRes.Ok;
      const toggle = document.getElementById("adminPaymentsToggle");
      if (toggle) {
        toggle.textContent = v.payments_enabled ? "ON" : "OFF";
        toggle.setAttribute("aria-pressed", v.payments_enabled ? "true" : "false");
      }
      setText(
        "adminPayCanisterIcp",
        (Number(v.pay_canister_icp_e8s) / 1e8).toFixed(6) + " ICP",
      );
      setText("adminCyclesSlice", String(v.cycles_slice_e8s));
      const tid = document.getElementById("adminTreasuryId");
      if (tid) tid.textContent = v.treasury.toText();
      try {
        const tb = await actor.admin_treasury_icp_balance_e8s();
        if ("Ok" in tb) {
          setText(
            "adminTreasuryIcp",
            (Number(tb.Ok) / 1e8).toFixed(6) + " ICP",
          );
        }
      } catch (e) {
        setText("adminTreasuryIcp", "—");
      }
      if ("Ok" in balRes) renderCreditList(balRes.Ok);
      if ("Ok" in purRes) renderPurchaseList(purRes.Ok);
      if (convCfg) {
        const ac = document.getElementById("adminAutoConvertToggle");
        if (ac) {
          ac.textContent = convCfg.auto_convert_enabled ? "ON" : "OFF";
          ac.setAttribute(
            "aria-pressed",
            convCfg.auto_convert_enabled ? "true" : "false",
          );
        }
        setText(
          "adminConvertMeta",
          "slippage " +
            convCfg.slippage_bps +
            " bps · LP share " +
            convCfg.liquidity_share_bps +
            " bps",
        );
      }
      if ("Ok" in pendRes) renderPendingList(pendRes.Ok, actor);
      setPayStatus("");
    } catch (e) {
      setPayStatus(String(e.message || e));
    }
  }

  function pendingStatusLabel(st) {
    if ("Pending" in st) return "pending";
    if ("Converted" in st) return "converted";
    if ("Refunded" in st) return "refunded";
    if ("Failed" in st) return "failed";
    return "?";
  }

  function renderPendingList(rows, actor) {
    const el = document.getElementById("adminPendingList");
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<p class="muted">No pending conversions.</p>';
      return;
    }
    el.innerHTML = "";
    rows.forEach(function (r) {
      const row = document.createElement("div");
      row.className = "admin-table-row";
      row.textContent =
        "#" +
        r.id +
        " " +
        pendingStatusLabel(r.status) +
        " · user " +
        r.user.toText().slice(0, 12) +
        "… · amt " +
        r.token_amount.toString();
      if (pendingStatusLabel(r.status) === "failed") {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "btn ghost mini";
        retry.textContent = "Retry";
        retry.style.marginLeft = "8px";
        retry.addEventListener("click", async function () {
          setPayStatus("Retrying #" + r.id + "…");
          try {
            const res = await actor.admin_retry_conversion(r.id);
            if ("Err" in res) throw new Error(res.Err);
            setPayStatus("Retry submitted for #" + r.id);
            await refreshPayments();
          } catch (e) {
            setPayStatus(String(e.message || e));
          }
        });
        row.appendChild(retry);
      }
      el.appendChild(row);
    });
  }

  async function toggleAutoConvert() {
    try {
      const { actor } = await adminPayActor();
      const cfgNow = await actor.get_convert_config();
      const next = !cfgNow.auto_convert_enabled;
      const res = await actor.set_config({ auto_convert_enabled: [next] });
      if ("Err" in res) throw new Error(res.Err);
      setPayStatus(
        next ? "Auto-convert enabled — test tiny amounts first." : "Auto-convert off (Phase A forward).",
      );
      await refreshPayments();
    } catch (e) {
      setPayStatus(String(e.message || e));
    }
  }

  async function togglePayments() {
    try {
      const { actor } = await adminPayActor();
      const cfgNow = await actor.get_config();
      const next = !cfgNow.payments_enabled;
      const res = await actor.set_config({ payments_enabled: [next] });
      if ("Err" in res) throw new Error(res.Err);
      setPayStatus(next ? "Payments enabled." : "Payments disabled.");
      await refreshPayments();
    } catch (e) {
      setPayStatus(String(e.message || e));
    }
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
    const router = await anonActor(routerIdl, routerId());
    const st = await router.router_status();
    let trpPayText = null;
    try {
      const pay = await router.get_trp_pay();
      if (pay && pay.length && pay[0]) trpPayText = pay[0].toText();
    } catch (e) {
      /* optional on older router wasm */
    }
    return {
      providers: st.providers,
      payments_enabled: st.payments_enabled,
      onchain_models_ready: st.onchain_models_ready,
      trp_pay: trpPayText,
    };
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
      '</span></div><div class="admin-health-row"><span class="nm">trp_pay (router)</span><span class="badge ' +
      (st.trp_pay ? "ok" : "warn") +
      '">' +
      (st.trp_pay || "not wired") +
      "</span></div>";
  }

  async function refreshMetrics() {
    if (!dashEl || dashEl.hasAttribute("hidden")) return;
    let gen = 0;
    let tc = 0;
    try {
      const router = await anonActor(routerIdl, routerId());
      const stats = await router.generation_stats();
      gen = Number(stats.total_generations);
      tc = Number(stats.cycles_burned_est) / 1e12;
      setText("adminGenTotal", gen.toLocaleString("en-US"));
      setText("adminCyclesTotal", "≈ " + tc.toFixed(3) + " TC");
      await ensureCharts();
      pushHistory(gen, tc);
    } catch (e) {
      setText("adminGenTotal", "—");
      setText("adminCyclesTotal", "—");
    }
    try {
      const meter = await anonActor(meterIdl, meterId());
      const [mstat, credits] = await Promise.all([
        meter.meter_status(),
        meter.credit_balance(),
      ]);
      setText(
        "adminMeterBudget",
        Number(mstat.free_budget_tc_remaining).toLocaleString("en-US") + " TC",
      );
      setText(
        "adminMeterSpent",
        Number(mstat.global_free_spent_tc).toLocaleString("en-US") + " TC",
      );
      setText(
        "adminMeterCredits",
        typeof credits === "bigint" ? credits.toString() : String(credits),
      );
    } catch (e) {
      setText("adminMeterBudget", "—");
      setText("adminMeterSpent", "—");
      setText("adminMeterCredits", "—");
    }
    try {
      const st = await fetchRouterStatus();
      renderHealth(st, null);
    } catch (e) {
      renderHealth(null, e);
    }
    await refreshPayments();
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
  document.getElementById("adminPaymentsToggle")?.addEventListener("click", togglePayments);
  document.getElementById("adminAutoConvertToggle")?.addEventListener("click", toggleAutoConvert);
  document.getElementById("adminRefreshPay")?.addEventListener("click", refreshPayments);
  document.getElementById("adminSweepTreasury")?.addEventListener("click", async function () {
    try {
      const { actor } = await adminPayActor();
      const res = await actor.sweep_to_treasury();
      if ("Err" in res) throw new Error(res.Err);
      setPayStatus("Swept " + res.Ok + " e8s to treasury.");
      await refreshPayments();
    } catch (e) {
      setPayStatus(String(e.message || e));
    }
  });
  document.getElementById("adminRefundBtn")?.addEventListener("click", async function () {
    try {
      const { actor, Principal } = await adminPayActor();
      const p = document.getElementById("adminRefundPrincipal")?.value?.trim();
      const icp = Number(document.getElementById("adminRefundIcp")?.value);
      if (!p || !icp) throw new Error("Principal and ICP amount required.");
      const e8s = BigInt(Math.round(icp * 1e8));
      const res = await actor.admin_refund_icp(Principal.fromText(p), e8s);
      if ("Err" in res) throw new Error(res.Err);
      setPayStatus("Refunded " + icp + " ICP to " + p);
      await refreshPayments();
    } catch (e) {
      setPayStatus(String(e.message || e));
    }
  });
  document.getElementById("adminTreasuryToII")?.addEventListener("click", async function () {
    try {
      const { actor, Principal } = await adminPayActor();
      const { principal } = window.TRP.getII();
      const res = await actor.admin_set_treasury(Principal.fromText(principal));
      if ("Err" in res) throw new Error(res.Err);
      setPayStatus("Treasury set to your II: " + principal);
      await refreshPayments();
    } catch (e) {
      setPayStatus(String(e.message || e));
    }
  });
  document.getElementById("adminTreasurySet")?.addEventListener("click", async function () {
    try {
      const { actor, Principal } = await adminPayActor();
      const p = document.getElementById("adminTreasuryInput")?.value?.trim();
      if (!p) throw new Error("Enter treasury principal.");
      const res = await actor.admin_set_treasury(Principal.fromText(p));
      if ("Err" in res) throw new Error(res.Err);
      setPayStatus("Treasury updated.");
      await refreshPayments();
    } catch (e) {
      setPayStatus(String(e.message || e));
    }
  });
  document.getElementById("adminGrantBtn")?.addEventListener("click", async function () {
    try {
      const { actor, Principal } = await adminPayActor();
      const p = document.getElementById("adminRefundPrincipal")?.value?.trim();
      const n = Number(document.getElementById("adminGrantCredits")?.value);
      if (!p || !n) throw new Error("Principal and credits required.");
      const res = await actor.admin_grant_credits(Principal.fromText(p), BigInt(n));
      if ("Err" in res) throw new Error(res.Err);
      setPayStatus("Granted " + n + " credits; balance " + res.Ok);
      await refreshPayments();
    } catch (e) {
      setPayStatus(String(e.message || e));
    }
  });

  window.TRP_ADMIN = { onViewVisible, onViewHidden, checkAccess };
})();
