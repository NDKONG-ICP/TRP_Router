/** Live router generation_stats — anonymous query, ~15s poll, odometer UI. */
(function () {
  const POLL_MS = 15000;
  const AGENT_VER = "2.4.1";
  const agentUrl =
    "https://esm.sh/@dfinity/agent@" + AGENT_VER;
  const candidUrl =
    "https://esm.sh/@dfinity/candid@" + AGENT_VER;

  const genEl = () => document.getElementById("statGenCount");
  const cycEl = () => document.getElementById("statCyclesBurned");

  let displayedGen = null;
  let displayedTc = null;
  let animFrame = null;

  function routerId() {
    const c = window.TRP_PLAYGROUND || {};
    return c.routerCanisterId || "5723t-oaaaa-aaaao-bbquq-cai";
  }

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

  function tcFromCycles(n) {
    const tc = Number(n) / 1e12;
    if (!Number.isFinite(tc)) return "—";
    if (tc >= 100) return tc.toFixed(2);
    if (tc >= 1) return tc.toFixed(3);
    return tc.toFixed(3);
  }

  function formatGen(n) {
    return Number(n).toLocaleString("en-US");
  }

  function pulse(el) {
    if (!el) return;
    el.classList.remove("odometer-tick");
    void el.offsetWidth;
    el.classList.add("odometer-tick");
  }

  function animateValue(el, from, to, formatFn, durationMs, onDone) {
    if (animFrame) cancelAnimationFrame(animFrame);
    const start = performance.now();
    const f = from == null ? to : from;
    const delta = to - f;
    if (delta === 0) {
      el.textContent = formatFn(to);
      onDone && onDone();
      return;
    }
    function frame(now) {
      const t = Math.min(1, (now - start) / durationMs);
      const ease = 1 - Math.pow(1 - t, 3);
      const cur = f + delta * ease;
      el.textContent = formatFn(cur);
      if (t < 1) animFrame = requestAnimationFrame(frame);
      else {
        el.textContent = formatFn(to);
        pulse(el);
        onDone && onDone();
      }
    }
    animFrame = requestAnimationFrame(frame);
  }

  function renderStats(stats) {
    const g = genEl();
    const c = cycEl();
    if (!g || !c) return;
    const gen = Number(stats.total_generations);
    const tcNum = Number(stats.cycles_burned_est) / 1e12;

    animateValue(
      g,
      displayedGen,
      gen,
      function (v) {
        return formatGen(Math.round(v));
      },
      720,
      function () {
        displayedGen = gen;
      },
    );

    animateValue(
      c,
      displayedTc,
      tcNum,
      function (v) {
        return "≈ " + tcFromCycles(v * 1e12) + " TC";
      },
      820,
      function () {
        displayedTc = tcNum;
      },
    );
  }

  let actorPromise = null;
  async function getActor() {
    if (!actorPromise) {
      actorPromise = (async function () {
        const { HttpAgent, Actor } = await import(agentUrl);
        const { IDL } = await import(candidUrl);
        const agent = await HttpAgent.create({ host: "https://icp-api.io" });
        return Actor.createActor(routerIdl, {
          agent,
          canisterId: routerId(),
        });
      })();
    }
    return actorPromise;
  }

  async function poll() {
    try {
      const actor = await getActor();
      const stats = await actor.generation_stats();
      renderStats(stats);
      genEl()?.closest(".stat")?.classList.remove("stat-offline");
      cycEl()?.closest(".stat")?.classList.remove("stat-offline");
    } catch (e) {
      console.warn("generation_stats:", e);
      genEl()?.closest(".stat")?.classList.add("stat-offline");
      cycEl()?.closest(".stat")?.classList.add("stat-offline");
      if (displayedGen == null && genEl()) genEl().textContent = "—";
      if (displayedTc == null && cycEl()) cycEl().textContent = "—";
    }
  }

  poll();
  setInterval(poll, POLL_MS);
})();
