(function () {
  const host = document.getElementById("modelCatalogList");
  if (!host) return;

  function row(m) {
    const tags = [];
    if (m.on_chain) tags.push('<span class="badge on">on-chain</span>');
    else tags.push('<span class="badge off">off-chain</span>');
    if (m.byok) tags.push('<span class="badge soon">BYOK</span>');
    if (m.free_tier) tags.push('<span class="badge soon">free</span>');
    return (
      '<div class="model-row">' +
      '<code class="model-id">' +
      m.id +
      "</code>" +
      '<span class="model-own muted">' +
      m.owned_by +
      " · " +
      m.capability +
      "</span>" +
      tags.join(" ") +
      "</div>"
    );
  }

  async function load() {
    const url = window.TRP?.modelsListUrl?.() || "";
    if (!url) {
      host.textContent = "Router URL not configured.";
      return;
    }
    host.innerHTML = '<p class="muted">Loading catalog…</p>';
    try {
      const res = await fetch(url);
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error_type) {
        throw new Error(j.description || j.error || res.statusText);
      }
      const data = j.data || [];
      const chat = data.filter((m) => m.capability === "chat");
      const image = data.filter((m) => m.capability === "image");
      host.innerHTML =
        "<h4>Chat models</h4>" +
        chat.map(row).join("") +
        "<h4 style='margin-top:20px'>Image models</h4>" +
        image.map(row).join("") +
        "<p class='muted' style='margin-top:16px'>Use these ids in API calls. Anthropic models need BYOK on the router; Groq/OpenRouter routes need the relay configured.</p>";
    } catch (e) {
      host.textContent = "Could not load models: " + (e.message || e);
    }
  }

  load();
})();
