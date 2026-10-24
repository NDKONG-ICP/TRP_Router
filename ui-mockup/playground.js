(function () {
  const cfg = window.TRP_PLAYGROUND || {};
  const postBase = cfg.routerPostUrl || "";
  const apiKey = cfg.apiKey || "";
  const diffusionId = cfg.diffusionCanisterId || "7chv3-5iaaa-aaaao-bbq3a-cai";
  const moduleSha =
    cfg.diffusionModuleSha ||
    "2cb663998b68a49039f4882075c5d94f71a6d7a186f4dfc788d47a5c6bdb816a";

  let iiPrincipal = null;
  let lastRun = { prompt: "", seed: 4242, sha: "" };
  let running = false;

  const EXAMPLE_PROMPTS = [
    "a black raven on a branch, silhouette, minimal",
    "gold quill pen on obsidian, high contrast, icon",
    "raven silhouette against a violet nebula, tiny 64px aesthetic",
    "minimal line art: raven head profile, single stroke",
  ];

  function authHeader() {
    if (iiPrincipal) return { Authorization: "Bearer ii:" + iiPrincipal };
    if (apiKey) return { Authorization: "Bearer " + apiKey };
    return {};
  }

  function verifyCommand() {
    return (
      "dfx canister info " +
      diffusionId +
      " --network ic\n# expect module hash 0x" +
      moduleSha
    );
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
    if (!postBase) {
      showError("Missing router URL in config.js");
      return;
    }
    if (running) return;

    const prompt =
      (opts && opts.prompt) ||
      (promptEl && promptEl.value.trim()) ||
      "a raven on gold";
    const seedRaw = seedEl && seedEl.value.trim();
    const seed =
      opts && opts.seed != null
        ? opts.seed
        : seedRaw
          ? Number(seedRaw)
          : 4242;

    if (promptEl) promptEl.value = prompt;
    if (seedEl) seedEl.value = String(seed);

    running = true;
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
      const res = await fetch(postBase + "/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader(),
        },
        body: JSON.stringify({
          model: "raven-diffusion",
          prompt,
          seed,
        }),
      });
      const j = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        throw new Error(j.error || res.statusText || "Generate failed");
      }
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
        "pathc diffusion · fully on-chain · " + elapsed + "s";
      document.getElementById("blobUrl").textContent = sha.slice(0, 20) + "…";

      let matchNote = "";
      if (lastRun.sha && lastRun.sha === sha && lastRun.seed === seed) {
        matchNote = "Regenerate matched prior SHA (determinism proof)";
      }
      lastRun = { prompt, seed, sha };
      trustLine(sha, matchNote);

      const regen = document.getElementById("regenBtn");
      if (regen) regen.hidden = false;

      setProgress("Complete · " + elapsed + "s on-chain", 100, false);
    } catch (e) {
      const msg = String(e.message || e);
      setProgress("Failed · " + msg, 0, true);
      showError(msg);
    } finally {
      clearInterval(tick);
      running = false;
      setButtonsDisabled(false);
    }
  }

  function regenerateSameSeed() {
    if (!lastRun.prompt) return;
    generateImage({ prompt: lastRun.prompt, seed: lastRun.seed });
  }

  async function signInII() {
    const btn = document.getElementById("iiBtn");
    try {
      const { AuthClient } = await import(
        "https://cdn.jsdelivr.net/npm/@dfinity/auth-client/+esm"
      );
      const client = await AuthClient.create();
      await new Promise(function (resolve, reject) {
        client.login({
          identityProvider: "https://identity.ic0.app",
          onSuccess: resolve,
          onError: reject,
        });
      });
      iiPrincipal = client.getIdentity().getPrincipal().toText();
      if (btn) btn.textContent = "II · " + iiPrincipal.slice(0, 5) + "…";
    } catch (e) {
      showError("Internet Identity: " + (e.message || e));
    }
  }

  function mountExamples() {
    const host = document.getElementById("examplePrompts");
    if (!host) return;
    EXAMPLE_PROMPTS.forEach(function (text) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pill example";
      b.textContent = text.length > 42 ? text.slice(0, 40) + "…" : text;
      b.title = text;
      b.addEventListener("click", function () {
        const el = document.getElementById("imgPrompt");
        if (el) el.value = text;
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

  mountExamples();
  trustLine("");
  const regen = document.getElementById("regenBtn");
  if (regen) regen.hidden = true;
  const retry = document.getElementById("retryBtn");
  if (retry) retry.hidden = true;
})();
