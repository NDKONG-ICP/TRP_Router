(function () {
  const cfg = window.TRP_PLAYGROUND || {};
  function postBase() {
    if (window.TRP && window.TRP.routerPostUrl) {
      const u = window.TRP.routerPostUrl();
      if (u) return u;
    }
    return (cfg.routerPostUrl || "").replace(/\.icp0\.io\b/, ".raw.icp0.io");
  }
  const apiKey = cfg.apiKey || "";
  const diffusionId = cfg.diffusionCanisterId || "7chv3-5iaaa-aaaao-bbq3a-cai";
  const moduleSha =
    cfg.diffusionModuleSha ||
    "d89a560af45e5a39b5e2ef1572152215b0c78c7690e3af997cb2ff780694c513";

  const nftCanisterId = cfg.ravenNftCanisterId || "62oay-tiaaa-aaaao-bbq7a-cai";

  let iiPrincipal = null;
  let authClient = null;
  let authIdentity = null;
  let lastRun = { prompt: "", seed: 4242, sha: "" };
  let lastImageBytes = null;
  let running = false;
  let minting = false;

  const EXAMPLE_PROMPTS = [
    "a black raven on a branch, silhouette, minimal",
    "gold quill pen on obsidian, high contrast, icon",
    "raven silhouette against a violet nebula, tiny 64px aesthetic",
    "minimal line art: raven head profile, single stroke",
  ];

  function routerAuthHeaders() {
    if (window.TRP && window.TRP.routerAuthHeaders) {
      return window.TRP.routerAuthHeaders();
    }
    if (!apiKey) return {};
    return { "x-oc-api-key": apiKey };
  }

  /** On-chain image gen via router update (avoids browser HTTP upgrade). */
  async function generateRavenViaRouter(prompt, seed) {
    const routerId =
      cfg.routerCanisterId ||
      (window.TRP && window.TRP.cfg && window.TRP.cfg().routerCanisterId);
    if (!routerId) throw new Error("Missing routerCanisterId in config.js");
    const AGENT_VER = "2.4.1";
    const { HttpAgent, Actor } = await import(
      "https://esm.sh/@dfinity/agent@" + AGENT_VER
    );
    const { IDL } = await import(
      "https://esm.sh/@dfinity/candid@" + AGENT_VER
    );
    const agent = await HttpAgent.create({ host: "https://icp-api.io" });
    const idlFactory = ({ IDL }) =>
      IDL.Service({
        playground_image_generate: IDL.Func(
          [IDL.Text, IDL.Text, IDL.Nat64],
          [IDL.Text],
          [],
        ),
      });
    const actor = Actor.createActor(idlFactory, { agent, canisterId: routerId });
    const auth = routerAuthHeaders()["x-oc-api-key"] || apiKey;
    if (!auth) {
      throw new Error("Sign in with Internet Identity or configure API key.");
    }
    const raw = await actor.playground_image_generate(
      auth,
      prompt,
      BigInt(seed),
    );
    const j = JSON.parse(raw);
    if (j.error) throw new Error(j.error);
    return j;
  }

  function seedForPrompt(prompt, opts) {
    if (opts && opts.seed != null) return opts.seed;
    const seedEl = document.getElementById("imgSeed");
    if (seedEl && seedEl.dataset.userEdited === "1" && seedEl.value.trim()) {
      return Number(seedEl.value.trim());
    }
    const s =
      window.TRP && window.TRP.promptSeed
        ? window.TRP.promptSeed(prompt)
        : 4242;
    if (seedEl) seedEl.value = String(s);
    return s;
  }

  function updateIIUI() {
    const btn = document.getElementById("iiBtn");
    const box = document.getElementById("iiPrincipalBox");
    const text = document.getElementById("iiPrincipalText");
    if (!iiPrincipal) {
      if (btn) btn.textContent = "Sign in · Internet Identity";
      if (box) box.hidden = true;
      return;
    }
    if (btn) btn.textContent = "Signed in · Internet Identity";
    if (box) box.hidden = false;
    if (text) text.textContent = iiPrincipal;
  }

  function verifyCommand() {
    return (
      "dfx canister info " +
      diffusionId +
      " --network ic\n# expect module hash 0x" +
      moduleSha
    );
  }

  function videoLoading(on) {
    const v = document.getElementById("imgLoading");
    if (!v) return;
    v.style.display = on ? "block" : "none";
    try { if (on) { v.currentTime = 0; v.play(); } else { v.pause(); } } catch (e) {}
  }

  function setProgress(text, pct, isError) {
    const el = document.getElementById("genProgress");
    const bar = document.getElementById("genBar");
    const wrap = document.getElementById("genProgressWrap");
    if (el) {
      el.textContent = text;
      el.classList.toggle("err", !!isError);
    }
    if (bar) bar.style.width = (pct != null ? pct : 8) + "%";
    if (wrap) wrap.classList.toggle("active", running);
  }

  function setButtonsDisabled(disabled) {
    ["genBtn", "regenBtn", "retryBtn"].forEach((id) => {
      const b = document.getElementById(id);
      if (b) b.disabled = disabled;
    });
  }

  function trustLine(sha, matchNote) {
    const line = document.getElementById("trustLine");
    const cmd = document.getElementById("verifyCmd");
    const shaEl = document.getElementById("trustSha");
    const fullSha = sha || "—";
    const shortSha =
      sha && sha.length > 24 ? sha.slice(0, 12) + "…" + sha.slice(-8) : fullSha;
    if (line) {
      line.innerHTML =
        '<div class="trust-row"><span class="k">canister</span><span class="v mono">' +
        diffusionId +
        '</span></div><div class="trust-row"><span class="k">module</span><span class="v mono">0x' +
        moduleSha.slice(0, 16) +
        "…</span></div>" +
        (shaEl
          ? ""
          : "") +
        '<div class="trust-row"><span class="k">SHA-256</span><span class="v mono ok" id="trustShaFull">' +
        fullSha +
        '</span></div><div class="trust-row"><span class="k">deterministic</span><span class="v ok">✓ same seed → same bytes</span></div>' +
        (matchNote
          ? '<div class="trust-row match"><span class="v ok">' + matchNote + "</span></div>"
          : "");
    }
    if (shaEl) shaEl.textContent = fullSha;
    const shaFull = document.getElementById("trustShaFull");
    if (shaFull && sha) shaFull.textContent = fullSha;
    if (cmd) cmd.textContent = verifyCommand();
    const copyBtn = document.getElementById("verifyCopy");
    if (copyBtn) copyBtn.dataset.copy = verifyCommand();
  }

  function showError(msg) {
    const box = document.getElementById("genError");
    if (box) {
      box.textContent = msg;
      box.hidden = false;
    }
    const retry = document.getElementById("retryBtn");
    if (retry) retry.hidden = false;
  }

  function clearError() {
    const box = document.getElementById("genError");
    if (box) {
      box.textContent = "";
      box.hidden = true;
    }
    const retry = document.getElementById("retryBtn");
    if (retry) retry.hidden = true;
  }

  async function generateImage(opts) {
    const promptEl = document.getElementById("imgPrompt");
    const seedEl = document.getElementById("imgSeed");
    const btn = document.getElementById("genBtn");
    const img = document.getElementById("imgOut");
    const dlStart = document.getElementById("dlBtn");
    if (dlStart) dlStart.hidden = true;
    const mintStart = document.getElementById("mintBtn");
    if (mintStart) mintStart.hidden = true;
    const mintOutStart = document.getElementById("mintResult");
    if (mintOutStart) mintOutStart.innerHTML = "";
    if (!postBase()) {
      showError("Missing router URL in config.js");
      return;
    }
    if (running) return;

    const prompt =
      (opts && opts.prompt) ||
      (promptEl && promptEl.value.trim()) ||
      "a raven on gold";
    const seed = seedForPrompt(prompt, opts);

    if (promptEl) promptEl.value = prompt;
    if (seedEl) seedEl.value = String(seed);

    running = true;
    var _lc = document.getElementById("imgC"); if (_lc) _lc.style.display = "none";
    if (img) img.style.display = "none";
    videoLoading(true);
    clearError();
    setButtonsDisabled(true);
    setProgress("Generating on-chain… connecting to router", 10, false);

    const t0 = Date.now();
    const tick = setInterval(function () {
      const elapsed = Math.round((Date.now() - t0) / 1000);
      const pct = Math.min(92, 10 + elapsed * 2.5);
      setProgress(
        "Generating on-chain… ~30s typical · elapsed " + elapsed + "s",
        pct,
        false,
      );
    }, 400);

    try {
      const j = await generateRavenViaRouter(prompt, seed);
      const row = (j.data && j.data[0]) || {};
      const b64 = row.b64_json;
      const sha = row.sha256 || "";
      if (!b64) throw new Error("Missing image in response");

      if (img) {
        img.src = "data:image/png;base64," + b64;
        img.style.display = "block";
      }
      const canvas = document.getElementById("imgC");
      if (canvas) canvas.style.display = "none";

      const elapsed = Math.round((Date.now() - t0) / 1000);
      document.getElementById("servedBy").textContent =
        "Raven Diffusion · fully on-chain · " + elapsed + "s";
      document.getElementById("blobUrl").textContent = sha.slice(0, 20) + "…";

      let matchNote = "";
      if (lastRun.sha && lastRun.sha === sha && lastRun.seed === seed) {
        matchNote = "Regenerate matched prior SHA (determinism proof)";
      }
      lastRun = { prompt, seed, sha };
      trustLine(sha, matchNote);

      const regen = document.getElementById("regenBtn");
      if (regen) regen.hidden = false;

      const dl = document.getElementById("dlBtn");
      if (dl) {
        dl.href = "data:image/png;base64," + b64;
        dl.download = "raven-diffusion-" + seed + "-" + sha.slice(0, 8) + ".png";
        dl.hidden = false;
      }

      lastImageBytes = b64ToBytes(b64);
      const mintBtn = document.getElementById("mintBtn");
      if (mintBtn) {
        mintBtn.hidden = false;
        mintBtn.disabled = false;
        mintBtn.textContent = "Mint as NFT";
      }
      const mintOut = document.getElementById("mintResult");
      if (mintOut) mintOut.innerHTML = "";

      setProgress("Complete · " + elapsed + "s on-chain", 100, false);
    } catch (e) {
      let msg = String(e.message || e);
      if (/failed to fetch|load failed/i.test(msg)) {
        msg =
          "Network error calling the router. Hard refresh; if signed in, confirm II session is active.";
      } else if (/trapped|IC0502|unreachable/i.test(msg)) {
        msg =
          "The diffusion canister (7chv3) is in a bad state and must be restarted by a controller (your Internet Identity). In NNS → Canisters → 7chv3-5iaaa-aaaao-bbq3a-cai: Stop, then Start. Then hard-refresh and try again.";
      } else if (/out of cycles|IC0207/i.test(msg)) {
        msg =
          "Diffusion canister needs cycles. Top up 7chv3-5iaaa-aaaao-bbq3a-cai via NNS or dfx canister deposit-cycles, then retry.";
      }
      setProgress("Failed · " + msg, 0, true);
      showError(msg);
    } finally {
      clearInterval(tick);
      running = false;
      setButtonsDisabled(false);
      videoLoading(false);
      var _fc = document.getElementById("imgC");
      var _fo = document.getElementById("imgOut");
      if (_fc && !(_fo && _fo.style.display === "block")) _fc.style.display = "block";
    }
  }

  function regenerateSameSeed() {
    if (!lastRun.prompt) return;
    generateImage({ prompt: lastRun.prompt, seed: lastRun.seed });
  }

  function syncIIFromCore() {
    if (!window.TRP || !window.TRP.getII) return;
    const s = window.TRP.getII();
    authClient = s.authClient;
    authIdentity = s.authIdentity;
    iiPrincipal = s.principal;
    updateIIUI();
  }

  async function signInII() {
    try {
      if (window.TRP && window.TRP.ensureII) {
        await window.TRP.ensureII();
        syncIIFromCore();
      }
    } catch (e) {
      showError("Internet Identity: " + (e.message || e));
    }
    return authIdentity;
  }

  async function ensureII() {
    if (authIdentity) return authIdentity;
    await signInII();
    return authIdentity;
  }

  async function sha256Hex(bytes) {
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function nftIdl({ IDL }) {
    const Account = IDL.Record({
      owner: IDL.Principal,
      subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    });
    const MintRequest = IDL.Record({
      prompt: IDL.Text,
      seed: IDL.Nat64,
      module_hash: IDL.Text,
      sha256: IDL.Text,
      image: IDL.Vec(IDL.Nat8),
      to: IDL.Opt(Account),
    });
    const MintResult = IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text });
    return IDL.Service({ mint: IDL.Func([MintRequest], [MintResult], []) });
  }

  async function mintNft() {
    if (minting) return;
    if (!lastRun.sha || !lastImageBytes) {
      showError("Generate an image first.");
      return;
    }
    const btn = document.getElementById("mintBtn");
    const out = document.getElementById("mintResult");
    minting = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Sign in to Internet Identity…";
    }
    try {
      const identity = await ensureII();
      if (!identity) throw new Error("Internet Identity sign-in required to mint.");
      if (btn) btn.textContent = "Minting on-chain…";
      const agentMod = await import(
        "https://esm.sh/@dfinity/agent@2.4.1"
      );
      const candidMod = await import(
        "https://esm.sh/@dfinity/candid@2.4.1"
      );
      const agent = await agentMod.HttpAgent.create({
        identity,
        host: "https://icp-api.io",
      });
      const actor = agentMod.Actor.createActor(nftIdl, {
        agent,
        canisterId: nftCanisterId,
      });
      const mintSha = await sha256Hex(lastImageBytes);
      const res = await actor.mint({
        prompt: lastRun.prompt,
        seed: BigInt(lastRun.seed),
        module_hash: moduleSha,
        sha256: mintSha,
        image: Array.from(lastImageBytes),
        to: [],
      });
      if ("Err" in res) throw new Error(res.Err);
      const tokenId = res.Ok.toString();
      const url =
        "https://" + nftCanisterId + ".raw.icp0.io/token/" + tokenId + ".png";
      if (out) {
        out.innerHTML =
          "Minted <strong>Raven Diffusion #" +
          tokenId +
          "</strong> — yours, transferable (ICRC-7) · " +
          '<a href="' +
          url +
          '" target="_blank" rel="noopener">view on-chain ↗</a>';
      }
      if (btn) {
        btn.textContent = "Minted ✓ #" + tokenId;
        btn.disabled = true;
      }
    } catch (e) {
      console.error("mint error:", e);
      const msg = String(
        (e && e.message) || (e && e.reject_message) || (e && e.detail) || e
      );
      if (out) out.innerHTML = '<span class="err">Mint failed: ' + msg + "</span>";
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Mint as NFT";
      }
    } finally {
      minting = false;
    }
  }

  function setActiveExamplePill(activeBtn) {
    document.querySelectorAll("#examplePrompts .pill.example").forEach(function (el) {
      el.classList.toggle("active", el === activeBtn);
    });
  }

  function mountExamples() {
    const host = document.getElementById("examplePrompts");
    if (!host) return;
    EXAMPLE_PROMPTS.forEach(function (text, index) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pill example";
      b.textContent = text.length > 42 ? text.slice(0, 40) + "…" : text;
      b.title = text + " · click to generate";
      b.addEventListener("click", function () {
        setActiveExamplePill(b);
        const tileSeed =
          window.TRP && window.TRP.promptSeed
            ? window.TRP.promptSeed(text)
            : 4242 + index * 1337;
        generateImage({ prompt: text, seed: tileSeed });
      });
      host.appendChild(b);
    });
  }

  document.getElementById("genBtn")?.addEventListener("click", function () {
    generateImage();
  });
  document.getElementById("retryBtn")?.addEventListener("click", function () {
    generateImage();
  });
  document.getElementById("regenBtn")?.addEventListener("click", regenerateSameSeed);
  document.getElementById("iiBtn")?.addEventListener("click", signInII);
  document.getElementById("copyIiPrincipal")?.addEventListener("click", async function () {
    if (!iiPrincipal) return;
    try {
      await navigator.clipboard.writeText(iiPrincipal);
      this.textContent = "Copied ✓";
      setTimeout(() => {
        this.textContent = "Copy principal";
      }, 1400);
    } catch (e) {
      /* ignore */
    }
  });
  document.getElementById("mintBtn")?.addEventListener("click", mintNft);
  document.getElementById("verifyCopy")?.addEventListener("click", async function () {
    const t = verifyCommand();
    try {
      await navigator.clipboard.writeText(t);
      this.textContent = "Copied ✓";
      setTimeout(() => {
        this.textContent = "Copy dfx verify command";
      }, 1400);
    } catch (e) {
      /* ignore */
    }
  });

  document.getElementById("imgSeed")?.addEventListener("input", function () {
    this.dataset.userEdited = "1";
  });
  document.getElementById("imgPrompt")?.addEventListener("input", function () {
    const seedEl = document.getElementById("imgSeed");
    if (seedEl && seedEl.dataset.userEdited !== "1" && window.TRP) {
      seedEl.value = String(window.TRP.promptSeed(this.value));
    }
  });

  (function initSeedFromPrompt() {
    const promptEl = document.getElementById("imgPrompt");
    const seedEl = document.getElementById("imgSeed");
    if (promptEl && seedEl && window.TRP && window.TRP.promptSeed) {
      seedEl.value = String(window.TRP.promptSeed(promptEl.value));
    }
  })();

  mountExamples();
  if (window.TRP && window.TRP.restoreII) {
    window.TRP.restoreII().then(function () {
      syncIIFromCore();
    });
  }
  trustLine("");
  const regen = document.getElementById("regenBtn");
  if (regen) regen.hidden = true;
  const retry = document.getElementById("retryBtn");
  if (retry) retry.hidden = true;
  const dl0 = document.getElementById("dlBtn");
  if (dl0) dl0.hidden = true;
  const mint0 = document.getElementById("mintBtn");
  if (mint0) mint0.hidden = true;
})();
