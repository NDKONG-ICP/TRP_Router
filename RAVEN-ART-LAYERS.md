# Raven on-chain art — trait layer hunt (2026-10-21)

## Goal

Layered PNGs (background / body / eyes / accessories / etc.) in `blob_store`, composited on-chain into `trp/onchain-raven-art`.

## Repos searched

| Location | Finding |
|----------|---------|
| `Raven DAPP/public`, `src/frontend/public` | SVG UI assets only (no trait stacks) |
| `Raven DAPP/CHANGES.md` / Sk8Punks | **888 composite JPEGs on IPFS**; metadata is image-only — **no trait properties** in EXT |
| `IC SPICY MAIN` | No `*trait*` / `nft_assets_src` paths found |
| Docs references (`nft_assets_src`, `art-src`, `nft_collection`) | **Not present** in current workspace trees |

## Shipped placeholder

`router_canister/src/raven_art.rs` — procedural 64×64 PNG from prompt seed (band “layers” + silhouette). Provider id: `raven-onchain-compositor`.

## Art needed for production compositor

Provide per-layer PNGs (same canvas size, alpha):

1. `background/` — at least 4 variants  
2. `body/` — at least 4  
3. `eyes/` — at least 4  
4. `beak/` or `mask/` — at least 2  
5. `accessory/` — optional  

Upload script (future): `scripts/upload-raven-layers.mjs` → `blob_store`, stable layer index in router.

## PepperHead / Bonsai / AXIOM

Not found as layered sources in this checkout; if layers live in another repo or drive, add paths here and re-run upload.
