export const idlFactory = ({ IDL }) => {
  const BeginArgs = IDL.Record({
    'height' : IDL.Nat32,
    'seed' : IDL.Nat64,
    'steps' : IDL.Nat32,
    'prompt' : IDL.Text,
    'width' : IDL.Nat32,
  });
  const BeginResult = IDL.Variant({ 'ok' : IDL.Nat64, 'err' : IDL.Text });
  const FinishResult = IDL.Variant({
    'ok' : IDL.Record({ 'png_sha256' : IDL.Text, 'bytes_len' : IDL.Nat64 }),
    'err' : IDL.Text,
  });
  const BuildPhase = IDL.Variant({
    'c3_model_ready' : IDL.Null,
    'c4_inference_pending' : IDL.Null,
    'c1_toolchain' : IDL.Null,
    'c2_wasm_blocked' : IDL.Null,
    'c5_ready' : IDL.Null,
  });
  const Status = IDL.Record({
    'wasm_linked' : IDL.Bool,
    'message' : IDL.Text,
    'sd_cpp_commit' : IDL.Text,
    'phase' : BuildPhase,
    'model_sha256' : IDL.Opt(IDL.Text),
  });
  const StepResult = IDL.Variant({
    'ok' : IDL.Record({
      'instructions' : IDL.Nat64,
      'step_index' : IDL.Nat32,
      'wall_ms' : IDL.Nat64,
    }),
    'err' : IDL.Text,
  });
  return IDL.Service({
    'begin' : IDL.Func([BeginArgs], [BeginResult], []),
    'finish' : IDL.Func([], [FinishResult], []),
    'get_png' : IDL.Func(
        [],
        [IDL.Variant({ 'ok' : IDL.Vec(IDL.Nat8), 'err' : IDL.Text })],
        ['query'],
      ),
    'last_timings' : IDL.Func(
        [],
        [
          IDL.Record({
            'update_calls' : IDL.Vec(IDL.Nat32),
            'instructions' : IDL.Vec(IDL.Nat64),
            'stage' : IDL.Vec(IDL.Text),
            'wall_ms' : IDL.Vec(IDL.Nat64),
          }),
        ],
        ['query'],
      ),
    'status' : IDL.Func([], [Status], ['query']),
    'step' : IDL.Func([IDL.Nat32], [StepResult], []),
    'taesd_bytes_loaded' : IDL.Func([], [IDL.Nat64], ['query']),
    'upload_taesd_chunk' : IDL.Func(
        [IDL.Record({ 'chunk' : IDL.Vec(IDL.Nat8), 'offset' : IDL.Nat64 })],
        [IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text })],
        [],
      ),
    'upload_weights_chunk' : IDL.Func(
        [IDL.Record({ 'chunk' : IDL.Vec(IDL.Nat8), 'offset' : IDL.Nat64 })],
        [IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text })],
        [],
      ),
    'weights_bytes_loaded' : IDL.Func([], [IDL.Nat64], ['query']),
  });
};
export const init = ({ IDL }) => { return []; };
