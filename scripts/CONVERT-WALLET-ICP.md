# Convert ~7.3 ICP on the deploy cycles wallet (`daf6l-jyaaa-aaaao-a4nba-cai`)

## What those two balances mean

| Location | Value | Meaning |
|----------|--------|---------|
| **Ledger account** `e2ab1f988d6061a6faa170724035a01b4499c2c19b43690cc80f76b2d7ba0f6a` (`dfx ledger account-id --of-canister daf6l`) | ~**7.30 ICP** | ICP sitting on the wallet’s deposit address — **not spendable as cycles until converted** |
| **Wallet cycle balance** (`dfx wallet balance --network ic --identity ic_deploy_plain`) | ~**0.12–0.14 TC** | Cycles the wallet can already send with `wallet_send` / `dfx wallet send` |

`dfx ledger top-up daf6l --amount X` uses ICP from the **deploy identity’s default account** (`dfx ledger account-id --identity ic_deploy_plain` → `1d23c62f…`), **not** the 7.3 ICP on `e2ab…`.

## Option A — NNS (recommended if you use Internet Identity)

1. Open [NNS](https://nns.ic0.app/) signed in with a **controller** of `daf6l` (your II or secure deploy identity).
2. Go to **Cycles** / **Wallet** (or find canister `daf6l-jyaaa-aaaao-a4nba-cai`).
3. Use **Convert ICP to cycles** (wording may be “Top up” / “Convert balance”) for the **~7.29 ICP** shown on the wallet ledger account.
4. Confirm; wallet cycle balance should jump to several TC.

## Option B — dfx (after a tiny identity top-up)

The wallet must be able to run updates (not frozen). If `dfx wallet send` fails with **IC0504**, first mint a small amount of cycles into the wallet from the identity account:

1. Send **≥ 0.02 ICP** to account `1d23c62f3ce159b40d1825bbb2c3e78467e694567e980dc076b044c264713a8c` (principal `gqkko-43bbx-nwsp4-it2rg-pc2dy-w2pt2-fa5om-4y6es-oyhz2-5i5oh-5ae`).
2. Then:

```bash
export DFX_WARNING=-mainnet_plaintext_identity
export DFX_IDENTITY=ic_deploy_plain
dfx ledger top-up daf6l-jyaaa-aaaao-a4nba-cai --amount 0.02 --network ic
node scripts/convert-wallet-icp-mainnet.mjs
```

3. Verify:

```bash
dfx wallet balance --network ic
dfx ledger balance e2ab1f988d6061a6faa170724035a01b4499c2c19b43690cc80f76b2d7ba0f6a --network ic
```

The ledger balance should drop; wallet TC should increase by roughly **~7.3 TC** (minus fees).

## After conversion

- Top up diffusion: `dfx wallet send 7chv3-5iaaa-aaaao-bbq3a-cai 2000000000000 --network ic`
- Still **stop → start** `7chv3` in NNS if generate traps (IC0502).
