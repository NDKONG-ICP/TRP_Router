/** Shared playground config, router headers, II session, prompt→seed helper. */
(function () {
  const cfg = () => window.TRP_PLAYGROUND || {};

  function routerPostBase() {
    const u = cfg().routerPostUrl || "";
    return u.replace(/\/v1\/?$/, "");
  }

  /** GET /v1/models is a canister query; icp0.io returns 503 — use raw.icp0.io. */
  function routerQueryBase() {
    const host = routerPostBase();
    if (!host) return "";
    return host.replace(/\.icp0\.io\b/, ".raw.icp0.io");
  }

  function modelsListUrl() {
    return routerQueryBase() + "/v1/models";
  }

  function routerAuthHeaders() {
    const key = cfg().apiKey || "";
    if (!key) return {};
    return { "x-oc-api-key": key };
  }

  /** FNV-1a → stable positive seed for a prompt string. */
  function promptSeed(text) {
    let h = 2166136261 >>> 0;
    const s = (text || "").trim();
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return (h % 2147483000) + 1;
  }

  let authClient = null;
  let authIdentity = null;
  let iiPrincipal = null;

  async function ensureII() {
    if (authIdentity && iiPrincipal) {
      return { authClient, authIdentity, principal: iiPrincipal };
    }
    const { AuthClient } = await import(
      "https://esm.sh/@dfinity/auth-client@2.4.1"
    );
    authClient = await AuthClient.create();
    if (!(await authClient.isAuthenticated())) {
      await new Promise(function (resolve, reject) {
        authClient.login({
          identityProvider: cfg().iiUrl || "https://identity.ic0.app",
          onSuccess: resolve,
          onError: reject,
        });
      });
    }
    authIdentity = authClient.getIdentity();
    iiPrincipal = authIdentity.getPrincipal().toText();
    return { authClient, authIdentity, principal: iiPrincipal };
  }

  async function restoreII() {
    try {
      const { AuthClient } = await import(
        "https://esm.sh/@dfinity/auth-client@2.4.1"
      );
      authClient = await AuthClient.create();
      if (await authClient.isAuthenticated()) {
        authIdentity = authClient.getIdentity();
        iiPrincipal = authIdentity.getPrincipal().toText();
        return iiPrincipal;
      }
    } catch (e) {
      /* optional */
    }
    return null;
  }

  function getII() {
    return { authClient, authIdentity, principal: iiPrincipal };
  }

  window.TRP = {
    cfg,
    routerPostBase,
    routerQueryBase,
    modelsListUrl,
    routerAuthHeaders,
    promptSeed,
    ensureII,
    restoreII,
    getII,
  };
})();
