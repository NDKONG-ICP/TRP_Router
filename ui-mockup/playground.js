(function () {
  const cfg = window.TRP_PLAYGROUND || {};
  const postBase = cfg.routerPostUrl || "";
  const apiKey = cfg.apiKey || "";
  const diffusionId = cfg.diffusionCanisterId || "7chv3-5iaaa-aaaao-bbq3a-cai";
  const moduleSha = cfg.diffusionModuleSha || "2cb663998b68a49039f4882075c5d94f71a6d7a186f4dfc788d47a5c6bdb816a";

  let iiPrincipal = null;

  function authHeader() {
    if (iiPrincipal) return { Authorization: "Bearer ii:" + iiPrincipal };
    if (apiKey) return { Authorization: "Bearer " + apiKey };
    return {};
  }

  function setProgress(text, pct) {
    const el = document.getElementById("genProgress");
    const bar = document.getElementById("genBar");
    if (el) el.textContent = text;
    if (bar) bar.style.width = (pct != null ? pct : 8) + "%";
  }

  function trustLine(sha) {
    const line = document.getElementById("trustLine");
    const cmd = document.getElementById("verifyCmd");
    const shortSha = sha ? sha.slice(0, 12) + "…" + sha.slice(-8) : "—";
    if (line) {
      line.innerHTML =
        "canister <span class=\"mono\">" +
        diffusionId +
        "</span> · module <span class=\"mono\">" +
        moduleSha.slice(0, 8) +
        "…</span> · SHA <span class=\"mono ok\">" +
        shortSha +
        '</span> · deterministic <span class="ok">✓</span>';
    }
    if (cmd) {
      cmd.textContent =
        "dfx canister info " +
        diffusionId +
        " --network ic   # module hash should match " +
        moduleSha.slice(0, 16) +
        "…";
    }
  }

  async function generateImage() {
    const promptEl = document.getElementById("imgPrompt");
    const seedEl = document.getElementById("imgSeed");
    const btn = document.getElementById("genBtn");
    const img = document.getElementById("imgOut");
    if (!postBase) {
      alert("Missing TRP_PLAYGROUND.routerPostUrl in config.js");
      return;
    }
    const prompt = (promptEl && promptEl.value.trim()) || "a raven on gold";
    const seedRaw = seedEl && seedEl.value.trim();
    const seed = seedRaw ? Number(seedRaw) : 4242;
    btn.disabled = true;
    setProgress("Calling router · raven-diffusion (~30s on-chain)…", 12);
    const t0 = Date.now();
    const tick = setInterval(function () {
      const s = Math.min(88, 12 + Math.floor((Date.now() - t0) / 800));
      setProgress("Generating on-chain… " + Math.round((Date.now() - t0) / 1000) + "s", s);
    }, 500);
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
        throw new Error(j.error || res.statusText || "generate failed");
      }
      const row = (j.data && j.data[0]) || {};
      const b64 = row.b64_json;
      const sha = row.sha256 || "";
      if (!b64) throw new Error("missing b64_json in response");
      if (img) {
        img.src = "data:image/png;base64," + b64;
        img.style.display = "block";
      }
      const canvas = document.getElementById("imgC");
      if (canvas) canvas.style.display = "none";
      document.getElementById("servedBy").textContent = "served by pathc · fully on-chain";
      document.getElementById("blobUrl").textContent = "sha256 " + (sha.slice(0, 16) + "…");
      trustLine(sha);
      setProgress("Done · " + Math.round((Date.now() - t0) / 1000) + "s", 100);
    } catch (e) {
      setProgress(String(e.message || e), 0);
      alert(String(e.message || e));
    } finally {
      clearInterval(tick);
      btn.disabled = false;
    }
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
      alert("Internet Identity sign-in failed: " + (e.message || e));
    }
  }

  document.getElementById("genBtn")?.addEventListener("click", generateImage);
  document.getElementById("iiBtn")?.addEventListener("click", signInII);
  trustLine("");
})();
