(function () {
  const ICP_LEDGER = "ryjl3-tyaaa-aaaaa-aaaba-cai";
  const AGENT_VER = "2.4.1";
  const agentUrl =
    "https://esm.sh/@dfinity/agent@" + AGENT_VER;
  const candidUrl =
    "https://esm.sh/@dfinity/candid@" + AGENT_VER;
  const principalUrl =
    "https://esm.sh/@dfinity/principal@" + AGENT_VER;

  const cfg = () => window.TRP?.cfg?.() || {};
  const meterId = () => cfg().trpMeterCanisterId || "6gk2j-eiaaa-aaaao-bbq5a-cai";
  const nftId = () => cfg().ravenNftCanisterId || "62oay-tiaaa-aaaao-bbq7a-cai";

  const balEl = document.getElementById("walletIcpBalance");
  const meterEl = document.getElementById("walletMeterCredits");
  const prEl = document.getElementById("walletPrincipal");
  const sendStatus = document.getElementById("walletSendStatus");
  const depositStatus = document.getElementById("walletDepositStatus");
  const nftGrid = document.getElementById("walletNftGrid");
  const nftStatus = document.getElementById("walletNftStatus");

  function nftIdlFactory({ IDL }) {
    const Account = IDL.Record({
      owner: IDL.Principal,
      subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    });
    const Value = IDL.Rec();
    Value.fill(
      IDL.Variant({
        Nat: IDL.Nat,
        Int: IDL.Int,
        Text: IDL.Text,
        Blob: IDL.Vec(IDL.Nat8),
        Array: IDL.Vec(Value),
        Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)),
      }),
    );
    const TransferError = IDL.Variant({
      NonExistingTokenId: IDL.Null,
      InvalidRecipient: IDL.Null,
      Unauthorized: IDL.Null,
      TooOld: IDL.Null,
      CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
      Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
      GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
      GenericBatchError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
    });
    const TransferResult = IDL.Variant({ Ok: IDL.Nat, Err: TransferError });
    const TransferArg = IDL.Record({
      from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
      to: Account,
      token_id: IDL.Nat,
      memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
      created_at_time: IDL.Opt(IDL.Nat64),
    });
    return IDL.Service({
      icrc7_tokens_of: IDL.Func(
        [Account, IDL.Opt(IDL.Nat), IDL.Opt(IDL.Nat)],
        [IDL.Vec(IDL.Nat)],
        ["query"],
      ),
      icrc7_token_metadata: IDL.Func(
        [IDL.Vec(IDL.Nat)],
        [IDL.Vec(IDL.Opt(IDL.Vec(IDL.Tuple(IDL.Text, Value))))],
        ["query"],
      ),
      icrc7_transfer: IDL.Func([IDL.Vec(TransferArg)], [IDL.Vec(IDL.Opt(TransferResult))], []),
    });
  }

  function valueToString(v) {
    if (v == null) return "";
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "string") return v;
    if (v.Text != null) return v.Text;
    if (v.Nat != null) return v.Nat.toString();
    if (v.Int != null) return v.Int.toString();
    const key = Object.keys(v)[0];
    if (key && v[key] != null) return String(v[key]);
    return "";
  }

  function metaMap(opt) {
    const out = {};
    if (!opt || !opt.length || !opt[0]) return out;
    for (const pair of opt[0]) {
      const k = pair[0];
      const val = pair[1];
      out[k] = valueToString(val);
    }
    return out;
  }

  function shortSha(hex) {
    if (!hex || hex.length < 16) return hex || "—";
    return hex.slice(0, 8) + "…" + hex.slice(-6);
  }

  async function agentWithII() {
    const { HttpAgent } = await import(agentUrl);
    const { AuthClient } = await import(
      "https://esm.sh/@dfinity/auth-client@" + AGENT_VER + "?alias=@dfinity/candid:@dfinity/candid@" + AGENT_VER
    );
    let { authIdentity, principal } = window.TRP.getII();
    if (!authIdentity) {
      await window.TRP.ensureII();
      ({ authIdentity, principal } = window.TRP.getII());
    }
    const agent = await HttpAgent.create({ host: "https://icp-api.io", identity: authIdentity });
    return { agent, principal };
  }

  async function refreshBalances() {
    try {
      const { agent, principal } = await agentWithII();
      if (prEl) prEl.textContent = principal;

      const { AccountIdentifier, LedgerCanister } = await import(
        "https://esm.sh/@dfinity/ledger-icp@2.4.1"
      );
      const ledger = LedgerCanister.create({ agent, canisterId: ICP_LEDGER });
      const account = AccountIdentifier.fromPrincipal({
        principal: agent.getPrincipal(),
      });
      const bal = await ledger.accountBalance({ accountIdentifier: account });
      if (balEl) balEl.textContent = (Number(bal) / 1e8).toFixed(4) + " ICP";

      const { Actor } = await import(agentUrl);
      const { IDL } = await import(candidUrl);
      const meter = Actor.createActor(
        ({ IDL: I }) =>
          I.Service({
            credit_balance: I.Func([], [I.Nat], ["query"]),
          }),
        { agent, canisterId: meterId() },
      );
      const credits = await meter.credit_balance();
      if (meterEl) meterEl.textContent = credits.toString() + " credits (~T cycles)";
    } catch (e) {
      if (balEl) balEl.textContent = "—";
      if (meterEl) meterEl.textContent = "—";
      if (sendStatus) sendStatus.textContent = "Sign in with II to view balances.";
    }
  }

  async function loadNfts() {
    if (!nftGrid) return;
    const { principal } = window.TRP.getII();
    if (!principal) {
      nftGrid.innerHTML =
        '<p class="nft-empty muted">Sign in with Internet Identity to see your NFTs.</p>';
      if (nftStatus) nftStatus.textContent = "";
      return;
    }

    if (nftStatus) nftStatus.textContent = "Loading NFTs…";
    nftGrid.innerHTML = '<p class="nft-empty muted">Loading…</p>';

    try {
      const { agent } = await agentWithII();
      const { Actor } = await import(agentUrl);
      const { IDL } = await import(candidUrl);
      const { Principal } = await import(principalUrl);
      const actor = Actor.createActor(nftIdlFactory, {
        agent,
        canisterId: nftId(),
      });

      const account = {
        owner: Principal.fromText(principal),
        subaccount: [],
      };
      const tokenIds = await actor.icrc7_tokens_of(account, [], [100n]);
      if (!tokenIds.length) {
        nftGrid.innerHTML =
          '<p class="nft-empty">No NFTs yet — generate an image and mint it.</p>';
        if (nftStatus) nftStatus.textContent = "";
        return;
      }

      const metaVec = await actor.icrc7_token_metadata(tokenIds);
      nftGrid.innerHTML = "";
      const canister = nftId();

      tokenIds.forEach(function (id, i) {
        const m = metaMap(metaVec[i]);
        const tokenStr = id.toString();
        const imgUrl =
          "https://" + canister + ".raw.icp0.io/token/" + tokenStr + ".png";
        const prompt = m.prompt || m["icrc7:name"] || "Raven Diffusion";
        const seed = m.seed || "—";
        const sha = m.sha256 || "";

        const card = document.createElement("article");
        card.className = "nft-card";
        card.innerHTML =
          '<img src="' +
          imgUrl +
          '" alt="Raven Diffusion #' +
          tokenStr +
          '" width="128" height="128" loading="lazy">' +
          '<div class="nft-card-body">' +
          '<p class="nft-id mono">#' +
          tokenStr +
          "</p>" +
          '<p class="nft-prompt">' +
          escapeHtml(prompt) +
          "</p>" +
          '<p class="nft-meta mono">seed ' +
          escapeHtml(String(seed)) +
          " · " +
          escapeHtml(shortSha(sha)) +
          "</p>" +
          '<div class="nft-transfer">' +
          '<input type="text" class="nft-to" placeholder="Recipient II principal" aria-label="Recipient for token ' +
          tokenStr +
          '">' +
          '<button type="button" class="btn ghost mini nft-transfer-btn">Transfer</button>' +
          "</div>" +
          '<p class="nft-transfer-status mono muted"></p>' +
          "</div>";

        card.querySelector(".nft-transfer-btn")?.addEventListener("click", function () {
          transferNft(tokenStr, card);
        });
        nftGrid.appendChild(card);
      });
      if (nftStatus) nftStatus.textContent = tokenIds.length + " NFT(s) on-chain.";
    } catch (e) {
      nftGrid.innerHTML =
        '<p class="nft-empty err">Could not load NFTs: ' +
        escapeHtml(String(e.message || e)) +
        "</p>";
      if (nftStatus) nftStatus.textContent = "";
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function transferNft(tokenId, card) {
    const input = card.querySelector(".nft-to");
    const statusEl = card.querySelector(".nft-transfer-status");
    const toText = input?.value?.trim();
    if (!toText) {
      if (statusEl) statusEl.textContent = "Enter a recipient principal.";
      return;
    }
    const btn = card.querySelector(".nft-transfer-btn");
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = "Transferring…";
    try {
      const { agent } = await agentWithII();
      const { Actor } = await import(agentUrl);
      const { IDL } = await import(candidUrl);
      const { Principal } = await import(principalUrl);
      const actor = Actor.createActor(nftIdlFactory, {
        agent,
        canisterId: nftId(),
      });
      const results = await actor.icrc7_transfer([
        {
          from_subaccount: [],
          to: { owner: Principal.fromText(toText), subaccount: [] },
          token_id: BigInt(tokenId),
          memo: [],
          created_at_time: [],
        },
      ]);
      const opt = results[0];
      if (!opt || !opt.length) throw new Error("Empty transfer response");
      const inner = opt[0];
      if ("Err" in inner) {
        const err = inner.Err;
        const msg =
          err.GenericError?.message ||
          err.GenericBatchError?.message ||
          Object.keys(err)[0] ||
          "Transfer failed";
        throw new Error(msg);
      }
      if (statusEl) statusEl.textContent = "Transfer submitted.";
      await loadNfts();
    } catch (e) {
      if (statusEl) statusEl.textContent = String(e.message || e);
      if (btn) btn.disabled = false;
    }
  }

  async function sendIcp() {
    const to = document.getElementById("walletSendTo")?.value?.trim();
    const amt = document.getElementById("walletSendAmount")?.value?.trim();
    if (!to || !amt) return;
    if (sendStatus) sendStatus.textContent = "Sending…";
    try {
      const { agent } = await agentWithII();
      const { AccountIdentifier, LedgerCanister } = await import(
        "https://esm.sh/@dfinity/ledger-icp@2.4.1"
      );
      const { Principal } = await import(principalUrl);
      const ledger = LedgerCanister.create({ agent, canisterId: ICP_LEDGER });
      const e8s = BigInt(Math.round(parseFloat(amt) * 1e8));
      const dest = AccountIdentifier.fromPrincipal({
        principal: Principal.fromText(to),
      });
      await ledger.transfer({
        to: dest,
        amount: e8s,
        memo: 0n,
        fee: 10000n,
      });
      if (sendStatus) sendStatus.textContent = "Transfer submitted.";
      refreshBalances();
    } catch (e) {
      if (sendStatus) sendStatus.textContent = String(e.message || e);
    }
  }

  async function depositMeter() {
    const tc = document.getElementById("walletDepositTc")?.value?.trim();
    if (!tc) return;
    const cycles = BigInt(Math.round(parseFloat(tc) * 1e12));
    if (depositStatus) depositStatus.textContent = "Depositing cycles…";
    try {
      const { agent } = await agentWithII();
      const { Actor } = await import(agentUrl);
      const { IDL } = await import(candidUrl);
      const meter = Actor.createActor(
        ({ IDL: I }) =>
          I.Service({
            deposit_cycles: I.Func([], [I.Nat], []),
          }),
        { agent, canisterId: meterId() },
      );
      const accepted = await meter.deposit_cycles([], {
        callOptions: { cycles },
      });
      if (depositStatus)
        depositStatus.textContent =
          "Accepted " + accepted.toString() + " T cycles as meter credits.";
      refreshBalances();
    } catch (e) {
      if (depositStatus) depositStatus.textContent = String(e.message || e);
    }
  }

  async function refreshAll() {
    await refreshBalances();
    await loadNfts();
  }

  document.getElementById("walletSignIn")?.addEventListener("click", async () => {
    await window.TRP.ensureII();
    refreshAll();
  });
  document.getElementById("walletRefresh")?.addEventListener("click", refreshAll);
  document.getElementById("walletSendBtn")?.addEventListener("click", sendIcp);
  document.getElementById("walletDepositBtn")?.addEventListener("click", depositMeter);

  const meterLabel = document.getElementById("walletMeterId");
  if (meterLabel) meterLabel.textContent = meterId();

  window.TRP.restoreII().then(function (p) {
    if (p) refreshAll();
  });

  window.addEventListener("hashchange", function () {
    if (location.hash === "#wallet") {
      const s = window.TRP.getII && window.TRP.getII();
      if (s && s.principal) refreshAll();
    }
  });
})();
