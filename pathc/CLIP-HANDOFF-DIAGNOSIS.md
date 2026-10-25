# Path C — CLIP→Denoise handoff: complete root-cause diagnosis (2026-10-23)

Status: **root cause fully identified; fix is architectural, not a one-liner.**

## Symptom
On-chain generate never leaves the Condition (CLIP) phase. The CLIP compute graph runs
and completes (`graph run complete cursor=972 n_nodes=973`), but the hidden-states output
is never delivered to the conditioner, so the pipeline either deadlocks or re-runs CLIP
forever. `enter Denoise` never logs.

## Root cause (confirmed by on-canister diagnostics)
The CLIP graph's final-result tensor comes back **`type=f32, buf=0, data=0`** after chunked
execution — it has no backend buffer and no data pointer. Following `view_src`/`src[0]`
(sd.cpp's own `ggml_graph_cut::cache_source_tensor` pattern) lands on another tensor that is
**also `buf=0/data=0`**. The computed data is not bound to ANY `compute_ctx` graph tensor.

Why: there are two compute paths in `GGMLRunner::execute_segment` (ggml_runner.cpp:1086):
- **Scheduler path** (`ggml_backend_sched_graph_compute`, lines 1095–1105): copies flagged
  outputs back to readable tensors, BUT computes the whole graph per call — it does **not**
  support mid-graph node-index resume.
- **Raw path** (`sd_backend_graph_compute_with_eval_callback`, lines 1118–1121): runs
  `ggml_backend_graph_compute_async` on node-range **views** (`sd_ggml_graph_view`), which
  supports the budget-pause/resume chunking — BUT bypasses the scheduler, so **no output
  copy-back**, and the final node's buffer is never materialized for readback.

On CPU/WASM `workspace_.scheduler()` is null (`needs_scheduler(graph)` is false for the
single-CPU-backend case), so execution takes the **raw path**. CLIP must chunk (70B+ instr >
40B cap), so it cannot use the scheduler path. Net: the only path that can chunk cannot
produce a readable output. `ggml_set_output()` on the result (ggml_runner.cpp:170) has no
effect here because copy-back only happens under the scheduler.

## What was tried (and why each didn't resolve it)
1. Stash at natural completion in the eval callback (ggml_extend_backend.cpp ~703) — stash now
   fires and finds the right tensor (`ne=78848` = 1024×77 hidden states) but can't read it.
2. Gate `condition_clip_graph_finished` on successful capture (pathc_icp_hooks.cpp ~117) —
   prevents permanent deadlock; now it retries instead of hanging. **Keep this.**
3. `ggml_set_output(result)` (ggml_runner.cpp:170) — no effect (copy-back is scheduler-only).
4. Follow `view_src`/`src[0]` to a backed tensor + read via `make_sd_tensor_from_ggml`
   (ggml_runner.cpp stash) — the resolved source is also `buf=0/data=0`, so still fails.

## Fix direction (for whoever continues)
The resumable **raw** path must materialize the final output so it can be read at completion.
Options, best-first:
1. **Extract from the gallocr/workspace buffer at completion.** In the raw path, after the
   final view computes (natural completion in `sd_backend_graph_compute_with_eval_callback`),
   the output data exists in the workspace compute buffer. Determine the output node's
   allocated offset/buffer within `workspace_` and copy `ggml_nbytes` out into the pending
   CLIP hidden — before `segment_end()`/teardown. This keeps chunking intact.
2. **Hybrid scheduler use.** Investigate whether `ggml_backend_sched_graph_compute` can be
   driven with the eval callback (it already gets `ggml_backend_sched_set_eval_callback` at
   ggml_runner.cpp:1098) to pause/resume by node — if the scheduler can resume a partial
   graph, route CLIP through it and get copy-back for free.
3. **Persistent output tensor outside gallocr.** Allocate the final-result tensor in a
   dedicated, non-reused backend buffer and add a `ggml_cpy` into it as the true last node, so
   it always has a stable, readable buffer regardless of path.

## Update — data-location eliminations (late session)
Probed every accessible handle to the computed CLIP output on the completing slice. ALL are
unbacked/absent:
- `named` result tensor: `buf=0 data=0 type=f32 ne=78848`
- `named`→`src[0]` (and view_src walk): `buf=0 data=0`
- `cache_.get(final_result_name)`: **null**; `cache_.outputs()`: **empty**
- `cut_cache_.get(final_result_name)`: **null**
- `read_graph_tensor(named)` and the `pathc_suspended_graph_` last-node fallback: both fail.

So the computed values (CPU did run the nodes) are not reachable through any standard handle.
**Leading hypothesis:** on each `step1` the CLIP graph is rebuilt with fresh tensor objects,
while the pinned "keep active allocation for resume" buffer belongs to the ORIGINAL graph's
tensors. The tensor read at completion is therefore a freshly-rebuilt, never-allocated object
(`data=0`), while the real data sits in the pinned gallocr buffer bound to the prior graph's
tensors. This is a resume/allocation-lifecycle issue, not a missing read path.

**Next concrete step (for fresh session or workspace author):** confirm whether the resumed
compute reuses the original allocated graph or rebuilds it; if it rebuilds, either (a) reuse the
original graph object across resume so the output tensor stays bound, or (b) on completion read
the output from the *originally allocated* graph's final node (the one the pinned buffer belongs
to), not from a freshly rebuilt `compute_ctx` tensor. Instrument `workspace_.allocate` call
sites to log whether allocate runs or is skipped on the completing resume slice.

## Banked / verified tonight
- Deadlock guard (retry instead of hang) — pathc_icp_hooks.cpp ~117.
- Local canister cycles topped up to ~101 TC (`dfx ledger fabricate-cycles`).
- Canister-trace stall watcher (phase-stagnation based).
- Diagnostic logging in the stash (`stash_clip_hidden: ... type/buf/data`, `resolved src=...`).

All edits are uncommitted in the working tree (vendor/ + src-icpp/). Local canister id this
session: `uxrrr-q7777-77774-qaaaq-cai`. No mainnet deploy attempted (gated on a correct
local image first).
