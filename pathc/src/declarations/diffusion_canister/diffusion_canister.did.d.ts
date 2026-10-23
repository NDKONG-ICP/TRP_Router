import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface BeginArgs {
  'debug_flags' : number,
  'height' : number,
  'seed' : bigint,
  'steps' : number,
  'prompt' : string,
  'width' : number,
}
export type BeginResult = { 'ok' : bigint } |
  { 'err' : string };
export type BuildPhase = { 'c3_model_ready' : null } |
  { 'c4_inference_pending' : null } |
  { 'c1_toolchain' : null } |
  { 'c2_wasm_blocked' : null } |
  { 'c5_ready' : null };
export type FinishResult = {
    'ok' : { 'png_sha256' : string, 'bytes_len' : bigint }
  } |
  { 'err' : string };
export interface StageTiming {
  'update_calls' : number,
  'instructions' : bigint,
  'stage' : string,
  'wall_ms' : bigint,
}
export interface Status {
  'wasm_linked' : boolean,
  'message' : string,
  'sd_cpp_commit' : string,
  'phase' : BuildPhase,
  'model_sha256' : [] | [string],
}
export type StepResult = {
    'ok' : {
      'generate_done' : boolean,
      'gguf_tensors' : number,
      'instructions' : bigint,
      'step_index' : number,
      'load_done' : boolean,
      'wall_ms' : bigint,
      'bytes_loaded' : bigint,
      'tensors_loaded_total' : number,
      'tensors_this_call' : number,
      'tensors_total' : number,
    }
  } |
  { 'err' : string };
export interface _SERVICE {
  'begin' : ActorMethod<[BeginArgs], BeginResult>,
  'finish' : ActorMethod<[], FinishResult>,
  'get_png' : ActorMethod<
    [],
    { 'ok' : Uint8Array | number[] } |
      { 'err' : string }
  >,
  'last_timings' : ActorMethod<
    [],
    {
      'update_calls' : Uint32Array | number[],
      'instructions' : BigUint64Array | bigint[],
      'stage' : Array<string>,
      'wall_ms' : BigUint64Array | bigint[],
    }
  >,
  'status' : ActorMethod<[], Status>,
  'step' : ActorMethod<[number], StepResult>,
  'taesd_bytes_loaded' : ActorMethod<[], bigint>,
  'upload_taesd_chunk' : ActorMethod<
    [{ 'chunk' : Uint8Array | number[], 'offset' : bigint }],
    { 'ok' : null } |
      { 'err' : string }
  >,
  'upload_weights_chunk' : ActorMethod<
    [{ 'chunk' : Uint8Array | number[], 'offset' : bigint }],
    { 'ok' : null } |
      { 'err' : string }
  >,
  'weights_bytes_loaded' : ActorMethod<[], bigint>,
  'weights_vfs_probe' : ActorMethod<
    [],
    { 'head_hex' : string, 'counter_bytes' : bigint, 'vfs_size' : bigint }
  >,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
