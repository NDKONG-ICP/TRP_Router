# DFINITY support — mismatched cycles wallet top-up (recovery request)

Copy the sections below into the [IC developer forum](https://forum.dfinity.org/) (Support), Discord `#support`, or your DFINITY support channel. Adjust the **Contact** block if needed.

---

## Subject

**Recovery request: ICP ledger top-up to CMC with wrong subaccount — `notify_top_up` failed for cycles wallet `daf6l-jyaaa-aaaao-a4nba-cai` (~7.29 ICP)**

---

## Summary

I am a controller of cycles wallet canister **`daf6l-jyaaa-aaaao-a4nba-cai`**. An automated script moved **~7.2898 ICP** from the wallet’s ICP ledger deposit account to the Cycles Minting Canister (CMC) using memo **`1347768404`** (top-up), but used an **incorrect CMC subaccount encoding**. A subsequent **`notify_top_up`** for canister `daf6l` **failed** because the destination account in the ledger block does not match the account CMC expects for that canister.

The ICP is no longer on the wallet deposit address, was **not** minted as cycles on the wallet (~0.12 TC remains), and was **not** transferred to my personal account. I am requesting help to **either mint the corresponding cycles to `daf6l` or refund the ICP** to my preferred account (below).

---

## What I am asking for

Please advise whether this top-up can be **reconciled** (standard path: complete **`notify_top_up`** for the block below, crediting cycles to **`daf6l-jyaaa-aaaao-a4nba-cai`**) or **refunded** as ICP to:

| Field | Value |
|--------|--------|
| **Preferred refund account (AccountIdentifier)** | `96b4895dd43cf26c06afd877fa9fc7989de42b325c3918f355d028f80d22e97c` |
| **Owner principal (Internet Identity)** | `ucw6l-apn5m-ycnrv-s7xtt-lvchu-jz5f3-3oeq7-ttuhk-rjvjp-sdnbj-lqe` |

Either outcome restores funds I control; I did **not** intend to send ICP to an unreconciled CMC subaccount.

---

## Affected canister and controllers

| Item | Value |
|------|--------|
| **Cycles wallet canister** | `daf6l-jyaaa-aaaao-a4nba-cai` |
| **Controllers** | `gqkko-43bbx-nwsp4-it2rg-pc2dy-w2pt2-fa5om-4y6es-oyhz2-5i5oh-5ae`, `ucw6l-apn5m-ycnrv-s7xtt-lvchu-jz5f3-3oeq7-ttuhk-rjvjp-sdnbj-lqe` |
| **Wallet ICP deposit account** (before incident) | `e2ab1f988d6061a6faa170724035a01b4499c2c19b43690cc80f76b2d7ba0f6a` |
| **CMC canister** | `rkp4c-7iaaa-aaaaa-aaaca-cai` |
| **ICP ledger canister** | `ryjl3-tyaaa-aaaaa-aaaba-cai` |

---

## Ledger transaction (failed top-up)

| Field | Value |
|--------|--------|
| **Block height / index** | **39627835** |
| **Transaction hash** | `d8cb0cdc6e0401a1c52f03b1bf60cc14d01ce2565194c1247c750090f5c97347` |
| **From account** | `e2ab1f988d6061a6faa170724035a01b4499c2c19b43690cc80f76b2d7ba0f6a` (wallet deposit) |
| **To account (actual in block)** | `eab58cddbde8ffd07535add4b6746ae48f81cfc66b63dd8eb1e0e9c9990a743e` |
| **Amount** | **728980000** e8s (**7.28980000 ICP**), fee **10000** e8s |
| **Memo** | **1347768404** (`TOP_UP` / cycles minting) |

Public ledger API (example):

`https://ledger-api.internetcomputer.org/accounts/e2ab1f988d6061a6faa170724035a01b4499c2c19b43690cc80f76b2d7ba0f6a/transactions?limit=5`

---

## Why `notify_top_up` failed

After the transfer, **`wallet_call` → CMC `notify_top_up`** with:

- `canister_id` = `daf6l-jyaaa-aaaao-a4nba-cai`
- `block_index` = **39627835**

returned an error equivalent to:

> Destination account in the block (`eab58c…`) different than in the notification (`0a00…` / expected TPUP subaccount for `daf6l`).

For canister **`daf6l-jyaaa-aaaao-a4nba-cai`**, the CMC top-up **AccountIdentifier** derived from the standard subaccount encoding (`0x0a` + canister id in subaccount) is:

**`45005a3aa2757f5e0926fb6c3235a00681373b318d6f2784e36b75bf16fd6562`**

The erroneous transfer instead sent ICP to:

**`eab58cddbde8ffd07535add4b6746ae48f81cfc66b63dd8eb1e0e9c9990a743e`**

(produced by placing raw principal bytes at the start of a 32-byte subaccount without the `0x0a` prefix convention.)

---

## Current balances (after incident)

| Location | Approximate balance |
|----------|---------------------|
| Wallet deposit `e2ab…` | ~**0 ICP** (dust) |
| Wallet cycle balance (`daf6l`) | ~**0.12 TC** (not ~7 TC) |
| II account `96b4895d…` | ~**0.02 ICP** (includes a separate ~0.01 ICP withdraw, block **39627866**) |

The **~7.29 ICP** from block **39627835** is the amount I need recovered or credited.

---

## Contact / verification

- **Name / handle:** _[your name or forum username]_
- **Preferred contact:** _[email or forum DM]_
- I can sign a message or perform a controller-only action on `daf6l` to prove control if required.

---

## Background (for context only)

I intended to either convert wallet-deposit ICP to cycles or withdraw to my II ledger account. A local Node script (`convert-wallet-icp-mainnet.mjs`) performed the TPUP **ledger transfer** with incorrect CMC addressing; I am not asking to reverse unrelated transactions.

Thank you for any guidance on reconciling this top-up or recovering the ICP.
