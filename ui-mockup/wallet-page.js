(function () {
  const ICP_LEDGER = "ryjl3-tyaaa-aaaaa-aaaba-cai";
  const AGENT_VER = "2.4.1";
  const agentUrl =
    "https://esm.sh/@dfinity/agent@" + AGENT_VER;
  const candidUrl =
    "https://esm.sh/@dfinity/candid@" + AGENT_VER;
  const principalUrl =
    "https://esm.sh/@dfinity/principal@" + AGENT_VER;

  const cfg = () => window.TRP?.cfg?.() || window.TRP_PLAYGROUND || {};
  const meterId = () => cfg().trpMeterCanisterId || "6gk2j-eiaaa-aaaao-bbq5a-cai";
  const nftId = () => cfg().ravenNftCanisterId || "62oay-tiaaa-aaaao-bbq7a-cai";
  const payId = () => cfg().trpPayCanisterId || "";

  /** Mainnet ICRC-1 ledgers (decimals fetched at runtime). */
  const WALLET_TOKENS = [
    { symbol: "ICP", id: ICP_LEDGER },
    { symbol: "ckBTC", id: "mxzaz-hqaaa-aaaar-qaada-cai" },
    { symbol: "ckETH", id: "ss2fx-dyaaa-aaaar-qacoq-cai" },
    { symbol: "ckUSD", id: "xevnm-gaaaa-aaaar-qafnq-cai", label: "ckUSDC" },
    { symbol: "ckSOL", id: "ls5lp-lqaaa-aaaar-qb5oa-cai" },
    { symbol: "$TRP", comingSoon: true },
  ];

  const tokenGrid = document.getElementById("walletTokenGrid");
  const meterEl = document.getElementById("walletMeterCredits");
  const prEl = document.getElementById("walletPrincipal");
  const sendTokenSelect = document.getElementById("walletSendToken");
  const sendAvailEl = document.getElementById("walletSendAvail");
  const sendAmountEl = document.getElementById("walletSendAmount");
  const sendStatus = document.getElementById("walletSendStatus");

  /** @type {Record<string, { id: string, decimals: number, balance: bigint, fee: bigint, formatted: string }>} */
  const walletTokenState = {};
  const depositStatus = document.getElementById("walletDepositStatus");
  const nftGrid = document.getElementById("walletNftGrid");
  const nftStatus = document.getElementById("walletNftStatus");
  const payCreditsEl = document.getElementById("walletPayCredits");
  const packList = document.getElementById("walletPackList");
  const buyStatus = document.getElementById("walletBuyStatus");

  function payIdlFactory({ IDL }) {
    const NatResult = IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text });
    return IDL.Service({
      quote: IDL.Func(
        [],
        [
          IDL.Vec(
            IDL.Record({
              index: IDL.Nat32,
              icp_e8s: IDL.Nat64,
              credits: IDL.Nat64,
            }),
          ),
        ],
        ["query"],
      ),
      credit_balance: IDL.Func([IDL.Principal], [IDL.Nat64], ["query"]),
      buy_credits: IDL.Func([IDL.Nat32], [NatResult], []),
    });
  }

  function icrc1LedgerIdl({ IDL }) {
    const Account = IDL.Record({
      owner: IDL.Principal,
      subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    });
    const TransferError = IDL.Variant({
      BadFee: IDL.Record({ expected_fee: IDL.Nat }),
      BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
      InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
      TooOld: IDL.Null,
      CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
      Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
      TemporarilyUnavailable: IDL.Null,
      GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
    });
    return IDL.Service({
      icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ["query"]),
      icrc1_decimals: IDL.Func([], [IDL.Nat8], ["query"]),
      icrc1_fee: IDL.Func([], [IDL.Nat], ["query"]),
      icrc1_transfer: IDL.Func(
        [
          IDL.Record({
            from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
            to: Account,
            amount: IDL.Nat,
            fee: IDL.Opt(IDL.Nat),
            memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
            created_at_time: IDL.Opt(IDL.Nat64),
          }),
        ],
        [IDL.Variant({ Ok: IDL.Nat, Err: TransferError })],
        [],
      ),
    });
  }

  function sendableTokens() {
    return WALLET_TOKENS.filter(function (t) {
      return !t.comingSoon && t.id;
    });
  }

  function initSendTokenSelect() {
    if (!sendTokenSelect) return;
    sendTokenSelect.innerHTML = "";
    sendableTokens().forEach(function (t) {
      const opt = document.createElement("option");
      opt.value = t.symbol;
      opt.textContent = t.label ? t.symbol + " (" + t.label + ")" : t.symbol;
      sendTokenSelect.appendChild(opt);
    });
  }

  function updateSendAvailUi() {
    if (!sendAvailEl || !sendTokenSelect) return;
    const sym = sendTokenSelect.value;
    const st = walletTokenState[sym];
    if (!st) {
      sendAvailEl.textContent = "Available —";
      return;
    }
    sendAvailEl.textContent =
      "Available " + st.formatted + " " + sym + " (fee " + formatTokenAmount(st.fee, st.decimals) + ")";
  }

  function maxSendAmountFor(sym) {
    const st = walletTokenState[sym];
    if (!st) return "";
    const sendable = st.balance > st.fee ? st.balance - st.fee : 0n;
    return formatTokenAmount(sendable, st.decimals);
  }

  function parseTokenAmount(text, decimals) {
    const raw = String(text).trim().replace(/,/g, "");
    if (!raw || !/^\d*\.?\d*$/.test(raw)) return null;
    const d = Number(decimals);
    const parts = raw.split(".");
    const whole = parts[0] === "" ? "0" : parts[0];
    let frac = parts[1] || "";
    if (frac.length > d) return null;
    frac = frac.padEnd(d, "0");
    const combined = (whole + frac).replace(/^0+(?=\d)/, "") || "0";
    try {
      return BigInt(combined);
    } catch (_) {
      return null;
    }
  }

  function transferErrMessage(err) {
    if (!err || typeof err !== "object") return "Transfer failed";
    if (err.InsufficientFunds) return "Insufficient balance for amount + fee.";
    if (err.BadFee) return "Wrong fee; expected " + String(err.BadFee.expected_fee);
    if (err.GenericError) return err.GenericError.message || "Transfer failed";
    const key = Object.keys(err)[0];
    return key || "Transfer failed";
  }

  function formatTokenAmount(raw, decimals) {
    const d = Number(decimals);
    const n = typeof raw === "bigint" ? raw : BigInt(raw);
    if (d <= 0) return n.toString();
    const neg = n < 0n;
    const abs = neg ? -n : n;
    const s = abs.toString().padStart(d + 1, "0");
    const whole = s.slice(0, -d) || "0";
    let frac = s.slice(-d);
    frac = frac.replace(/0+$/, "");
    const out = frac ? whole + "." + frac : whole;
    return (neg ? "-" : "") + out;
  }

  function renderTokenGrid(rows) {
    if (!tokenGrid) return;
    tokenGrid.innerHTML = "";
    rows.forEach(function (row) {
      const cell = document.createElement("div");
      cell.className = "wallet-token-cell" + (row.comingSoon ? " soon" : "");
      const sym = document.createElement("div");
      sym.className = "sym";
      sym.textContent = row.label || row.symbol;
      const val = document.createElement("div");
      val.className = "val";
      val.textContent = row.value;
      cell.appendChild(sym);
      cell.appendChild(val);
      tokenGrid.appendChild(cell);
    });
  }

  function ledgerIcrc2Idl({ IDL }) {
    const Account = IDL.Record({
      owner: IDL.Principal,
      subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    });
    const ApproveError = IDL.Variant({
      BadFee: IDL.Record({ expected_fee: IDL.Nat }),
      InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
      GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
    });
    return IDL.Service({
      icrc1_fee: IDL.Func([], [IDL.Nat], ["query"]),
      icrc2_approve: IDL.Func(
        [
          IDL.Record({
            from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
            spender: Account,
            amount: IDL.Nat,
            expires_at: IDL.Opt(IDL.Nat64),
            fee: IDL.Opt(IDL.Nat),
            memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
            created_at_time: IDL.Opt(IDL.Nat64),
          }),
        ],
        [IDL.Variant({ Ok: IDL.Nat, Err: ApproveError })],
        [],
      ),
    });
  }

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
    const loadingRows = WALLET_TOKENS.map(function (t) {
      return {
        symbol: t.symbol,
        label: t.label,
        comingSoon: t.comingSoon,
        value: t.comingSoon ? "Coming soon" : "…",
      };
    });
    renderTokenGrid(loadingRows);

    try {
      const { agent, principal } = await agentWithII();
      if (prEl) prEl.textContent = principal;
      if (sendStatus) sendStatus.textContent = "";

      const { Actor } = await import(agentUrl);
      const { IDL } = await import(candidUrl);
      const { Principal } = await import(principalUrl);
      const owner = Principal.fromText(principal);
      const account = { owner, subaccount: [] };

      Object.keys(walletTokenState).forEach(function (k) {
        delete walletTokenState[k];
      });

      const rows = await Promise.all(
        WALLET_TOKENS.map(async function (t) {
          if (t.comingSoon) {
            return {
              symbol: t.symbol,
              label: t.label,
              comingSoon: true,
              value: "Not available yet",
            };
          }
          try {
            const ledger = Actor.createActor(icrc1LedgerIdl, {
              agent,
              canisterId: t.id,
            });
            const [bal, decimals, fee] = await Promise.all([
              ledger.icrc1_balance_of(account),
              ledger.icrc1_decimals(),
              ledger.icrc1_fee(),
            ]);
            const dec = Number(decimals);
            const balBig = typeof bal === "bigint" ? bal : BigInt(bal);
            const feeBig = typeof fee === "bigint" ? fee : BigInt(fee);
            const formatted = formatTokenAmount(balBig, dec);
            walletTokenState[t.symbol] = {
              id: t.id,
              decimals: dec,
              balance: balBig,
              fee: feeBig,
              formatted,
            };
            return {
              symbol: t.symbol,
              label: t.label,
              value: formatted,
            };
          } catch (err) {
            return {
              symbol: t.symbol,
              label: t.label,
              value: "—",
            };
          }
        }),
      );
      renderTokenGrid(rows);
      updateSendAvailUi();

      const meter = Actor.createActor(
        ({ IDL: I }) =>
          I.Service({
            credit_balance_of: I.Func([I.Principal], [I.Nat], ["query"]),
            credit_balance: I.Func([], [I.Nat], ["query"]),
          }),
        { agent, canisterId: meterId() },
      );
      let meterCredits;
      try {
        meterCredits = await meter.credit_balance_of(owner);
      } catch (_) {
        meterCredits = await meter.credit_balance();
      }
      if (meterEl)
        meterEl.textContent =
          meterCredits.toString() + " credits (~T cycles)";
      await refreshPayCredits();
    } catch (e) {
      renderTokenGrid(
        WALLET_TOKENS.map(function (t) {
          return {
            symbol: t.symbol,
            label: t.label,
            comingSoon: t.comingSoon,
            value: t.comingSoon ? "Not available yet" : "—",
          };
        }),
      );
      if (meterEl) meterEl.textContent = "—";
      if (sendStatus)
        sendStatus.textContent =
          "Sign in with II to view balances." +
          (e && e.message ? " (" + e.message + ")" : "");
    }
  }

  async function refreshPayCredits() {
    if (!payCreditsEl) return;
    const pid = payId();
    if (!pid) {
      payCreditsEl.textContent = "—";
      return;
    }
    const { principal } = window.TRP.getII();
    if (!principal) {
      payCreditsEl.textContent = "—";
      return;
    }
    try {
      const { HttpAgent, Actor } = await import(agentUrl);
      const { IDL } = await import(candidUrl);
      const { Principal } = await import(principalUrl);
      const agent = await HttpAgent.create({ host: "https://icp-api.io" });
      const pay = Actor.createActor(payIdlFactory, { agent, canisterId: pid });
      const bal = await pay.credit_balance(Principal.fromText(principal));
      payCreditsEl.textContent = String(bal);
    } catch (e) {
      payCreditsEl.textContent = "—";
    }
  }

  async function loadPacks() {
    if (!packList) return;
    const pid = payId();
    if (!pid) {
      packList.innerHTML =
        '<p class="muted">Credits shop not configured (trpPayCanisterId).</p>';
      return;
    }
    try {
      const { HttpAgent, Actor } = await import(agentUrl);
      const { IDL } = await import(candidUrl);
      const agent = await HttpAgent.create({ host: "https://icp-api.io" });
      const pay = Actor.createActor(payIdlFactory, { agent, canisterId: pid });
      const packs = await pay.quote();
      packList.innerHTML = "";
      packs.forEach(function (p) {
        const row = document.createElement("div");
        row.className = "pack-row";
        const icp = (Number(p.icp_e8s) / 1e8).toFixed(2);
        row.innerHTML =
          '<div class="meta"><strong>' +
          p.credits +
          " credits</strong> · " +
          icp +
          " ICP</div>";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn primary mini";
        btn.textContent = "Buy";
        btn.addEventListener("click", function () {
          buyPack(Number(p.index), p);
        });
        row.appendChild(btn);
        packList.appendChild(row);
      });
    } catch (e) {
      packList.innerHTML =
        '<p class="nft-empty err">' + escapeHtml(String(e.message || e)) + "</p>";
    }
  }

  async function buyPack(packIndex, pack) {
    const pid = payId();
    if (!pid) return;
    if (buyStatus) buyStatus.textContent = "Sign in with Internet Identity…";
    try {
      await window.TRP.ensureII();
      const { agent } = await agentWithII();
      const { Actor } = await import(agentUrl);
      const { IDL } = await import(candidUrl);
      const { Principal } = await import(principalUrl);
      const ledger = Actor.createActor(ledgerIcrc2Idl, {
        agent,
        canisterId: ICP_LEDGER,
      });
      const fee = BigInt(await ledger.icrc1_fee());
      const approveAmt = BigInt(pack.icp_e8s) + fee;
      if (buyStatus) buyStatus.textContent = "Approving ICP on ledger…";
      const approveRes = await ledger.icrc2_approve({
        from_subaccount: [],
        spender: { owner: Principal.fromText(pid), subaccount: [] },
        amount: approveAmt,
        expires_at: [],
        fee: [],
        memo: [],
        created_at_time: [],
      });
      if ("Err" in approveRes) {
        throw new Error("Approve failed — check ICP balance on your II account.");
      }
      if (buyStatus) buyStatus.textContent = "Purchasing credits…";
      const pay = Actor.createActor(payIdlFactory, { agent, canisterId: pid });
      const res = await pay.buy_credits(packIndex);
      if ("Err" in res) throw new Error(res.Err);
      if (buyStatus)
        buyStatus.textContent = "Credits updated — balance " + res.Ok + ".";
      await refreshPayCredits();
      await refreshBalances();
    } catch (e) {
      if (buyStatus) buyStatus.textContent = String(e.message || e);
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

  async function sendToken() {
    const to = document.getElementById("walletSendTo")?.value?.trim();
    const amtText = sendAmountEl?.value?.trim();
    const sym = sendTokenSelect?.value;
    if (!to || !amtText || !sym) {
      if (sendStatus) sendStatus.textContent = "Choose a token, recipient, and amount.";
      return;
    }
    const st = walletTokenState[sym];
    if (!st) {
      if (sendStatus) sendStatus.textContent = "Refresh balances after signing in.";
      return;
    }
    const amount = parseTokenAmount(amtText, st.decimals);
    if (amount == null || amount <= 0n) {
      if (sendStatus) sendStatus.textContent = "Enter a valid amount.";
      return;
    }
    if (amount + st.fee > st.balance) {
      if (sendStatus) sendStatus.textContent = "Amount plus fee exceeds your balance.";
      return;
    }
    if (sendStatus) sendStatus.textContent = "Sending " + sym + "…";
    try {
      const { agent } = await agentWithII();
      const { Actor } = await import(agentUrl);
      const { Principal } = await import(principalUrl);
      const ledger = Actor.createActor(icrc1LedgerIdl, {
        agent,
        canisterId: st.id,
      });
      const res = await ledger.icrc1_transfer({
        from_subaccount: [],
        to: { owner: Principal.fromText(to), subaccount: [] },
        amount,
        fee: [],
        memo: [],
        created_at_time: [],
      });
      if ("Err" in res) throw new Error(transferErrMessage(res.Err));
      if (sendStatus)
        sendStatus.textContent =
          sym + " transfer submitted (block index " + res.Ok.toString() + ").";
      if (sendAmountEl) sendAmountEl.value = "";
      await refreshBalances();
    } catch (e) {
      if (sendStatus) sendStatus.textContent = String(e.message || e);
    }
  }

  function fillSendMax() {
    if (!sendTokenSelect || !sendAmountEl) return;
    sendAmountEl.value = maxSendAmountFor(sendTokenSelect.value);
  }

  async function copyWalletPrincipal() {
    const text = prEl?.textContent?.trim();
    if (!text || text === "—") {
      if (sendStatus) sendStatus.textContent = "Sign in to copy your principal.";
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (sendStatus) sendStatus.textContent = "Principal copied — use it to receive any ICRC token.";
    } catch (_) {
      if (sendStatus) sendStatus.textContent = "Could not copy; select the principal text manually.";
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
    await loadPacks();
    await refreshBalances();
    await loadNfts();
  }

  document.getElementById("walletSignIn")?.addEventListener("click", async () => {
    await window.TRP.ensureII();
    refreshAll();
  });
  document.getElementById("walletRefresh")?.addEventListener("click", refreshAll);
  document.getElementById("walletSendBtn")?.addEventListener("click", sendToken);
  document.getElementById("walletSendMax")?.addEventListener("click", fillSendMax);
  sendTokenSelect?.addEventListener("change", function () {
    updateSendAvailUi();
    if (sendAmountEl) sendAmountEl.value = "";
  });
  document.getElementById("walletCopyPrincipal")?.addEventListener("click", copyWalletPrincipal);
  document.getElementById("walletDepositBtn")?.addEventListener("click", depositMeter);

  initSendTokenSelect();

  const meterLabel = document.getElementById("walletMeterId");
  if (meterLabel) meterLabel.textContent = meterId();

  loadPacks();

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
