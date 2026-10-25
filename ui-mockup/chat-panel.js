(function () {
  const chatEl = document.getElementById("chat");
  const askBtn = document.getElementById("askBtn");
  const chatIn = document.getElementById("chatIn");
  const modelSel = document.getElementById("chatModel");
  const chatMeta = document.getElementById("chatModelMeta");
  if (!chatEl || !askBtn) return;

  const DEFAULT_MODEL = "trp/onchain-qwen-0.5b";
  let models = [];

  function addMsg(cls, txt) {
    const d = document.createElement("div");
    d.className = "msg " + cls;
    d.textContent = txt;
    chatEl.appendChild(d);
    chatEl.scrollTop = chatEl.scrollHeight;
    return d;
  }

  function addAssistantStreaming(text) {
    const d = addMsg("a", "");
    const parts = text.split(/(\s+)/);
    let i = 0;
    (function tick() {
      if (i < parts.length) {
        d.textContent += parts[i++];
        chatEl.scrollTop = chatEl.scrollHeight;
        setTimeout(tick, 28);
      }
    })();
  }

  function groupLabel(m) {
    if (m.on_chain) return "On-chain";
    if (m.owned_by === "anthropic") return "Anthropic (BYOK)";
    if (m.owned_by === "groq") return "OpenAI / Groq";
    if (m.owned_by === "openrouter") return "OpenRouter";
    if (m.owned_by === "google") return "Google";
    if (m.owned_by === "cloudflare") return "Cloudflare";
    return m.owned_by || "Other";
  }

  function fillModelSelect(list) {
    if (!modelSel) return;
    modelSel.innerHTML = "";
    const chatModels = list.filter((m) => m.capability === "chat");
    const groups = new Map();
    chatModels.forEach((m) => {
      const g = groupLabel(m);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(m);
    });
    for (const [label, items] of groups) {
      const og = document.createElement("optgroup");
      og.label = label;
      items.forEach((m) => {
        const o = document.createElement("option");
        o.value = m.id;
        let suffix = "";
        if (m.on_chain) suffix = " · on-chain";
        else if (m.byok) suffix = " · BYOK";
        else if (m.free_tier) suffix = " · free tier";
        o.textContent = m.id + suffix;
        og.appendChild(o);
      });
      modelSel.appendChild(og);
    }
    if (!modelSel.value) modelSel.value = DEFAULT_MODEL;
    updateMeta();
  }

  function updateMeta() {
    if (!chatMeta || !modelSel) return;
    const m = models.find((x) => x.id === modelSel.value);
    if (!m) {
      chatMeta.textContent = "Select a model";
      return;
    }
    const bits = [m.owned_by];
    if (m.on_chain) bits.push("runs in-canister");
    if (m.byok) bits.push("requires your Anthropic API key on the router");
    if (m.free_tier) bits.push("free tier");
    chatMeta.textContent = bits.join(" · ");
  }

  async function loadModels() {
    const url = window.TRP?.modelsListUrl?.() || "";
    if (!url) {
      if (chatMeta) chatMeta.textContent = "Missing router URL in config.js";
      return;
    }
    try {
      const res = await fetch(url);
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error_type) {
        throw new Error(j.description || j.error || res.statusText || "models fetch failed");
      }
      models = (j.data || []).map((m) => ({
        id: m.id,
        owned_by: m.owned_by,
        capability: m.capability || "chat",
        on_chain: !!m.on_chain,
        byok: !!m.byok,
        free_tier: !!m.free_tier,
      }));
      fillModelSelect(models);
      if (chatMeta && models.length) {
        chatMeta.textContent =
          models.filter((m) => m.capability === "chat").length +
          " chat models loaded from router";
      }
    } catch (e) {
      if (modelSel) {
        modelSel.innerHTML =
          '<option value="' + DEFAULT_MODEL + '">' + DEFAULT_MODEL + " (fallback)</option>";
      }
      if (chatMeta) {
        chatMeta.textContent = "Could not load catalog: " + (e.message || e);
      }
    }
  }

  async function runChat() {
    const q = (chatIn && chatIn.value.trim()) || "Hello";
    const model = (modelSel && modelSel.value) || DEFAULT_MODEL;
    const postBase = window.TRP?.routerPostUrl?.() || "";
    if (!postBase) {
      addMsg("err", "Missing router URL in config.js");
      return;
    }
    chatEl.innerHTML = "";
    addMsg("u", q);
    askBtn.disabled = true;
    const thinking = addMsg("a", "…");
    try {
      const doFetch =
        window.TRP && window.TRP.routerFetch
          ? window.TRP.routerFetch.bind(window.TRP)
          : function (path, init) {
              return fetch(postBase + path, init);
            };
      const res = await doFetch("/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...window.TRP.routerAuthHeaders(),
        },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: "user", content: q }],
        }),
      });
      const j = await res.json().catch(() => ({}));
      thinking.remove();
      if (!res.ok) {
        addMsg("err", j.error || res.statusText || "Chat failed");
        return;
      }
      const text =
        j.choices?.[0]?.message?.content ||
        j.choices?.[0]?.text ||
        "(empty response)";
      addAssistantStreaming(text);
      const badge = document.querySelector(".onchain-badge");
      if (badge) {
        const onChain = model.startsWith("trp/onchain-");
        badge.hidden = !onChain;
      }
    } catch (e) {
      thinking.remove();
      addMsg("err", String(e.message || e));
    } finally {
      askBtn.disabled = false;
    }
  }

  modelSel?.addEventListener("change", updateMeta);
  askBtn.addEventListener("click", runChat);
  chatIn?.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      runChat();
    }
  });
  loadModels().then(function () {
    chatEl.innerHTML = "";
    addMsg(
      "a",
      "Live router chat — pick a model and ask. On-chain Qwen runs in-canister; Anthropic/Groq need router relay + keys.",
    );
  });
})();
