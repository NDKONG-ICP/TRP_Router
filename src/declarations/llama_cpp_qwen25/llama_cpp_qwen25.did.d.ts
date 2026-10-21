import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

/**
 * -----------------------------------------------------
 * Access level
 * 0 = only controllers
 * 1 = all except anonymous
 */
export interface AccessInputRecord { 'level' : number }
export interface AccessRecord { 'explanation' : string, 'level' : number }
export type AccessRecordResult = { 'Ok' : AccessRecord } |
  { 'Err' : ApiError };
/**
 * -----------------------------------------------------
 * Admin RBAC Types (match PoAIW structure, use existing ApiError)
 * -----------------------------------------------------
 */
export type AdminRole = { 'AdminQuery' : null } |
  { 'AdminUpdate' : null };
export interface AdminRoleAssignment {
  'principal' : string,
  'assignedAt' : bigint,
  'assignedBy' : string,
  'note' : string,
  'role' : AdminRole,
}
/**
 * Uses EXISTING ApiError type (NOT modified)
 */
export type AdminRoleAssignmentResult = { 'Ok' : AdminRoleAssignment } |
  { 'Err' : ApiError };
/**
 * Uses EXISTING ApiError type (NOT modified)
 */
export type AdminRoleAssignmentsResult = { 'Ok' : Array<AdminRoleAssignment> } |
  { 'Err' : ApiError };
/**
 * -----------------------------------------
 */
export type ApiError = { 'StatusCode' : number } |
  { 'Other' : string };
export interface AssignAdminRoleInputRecord {
  'principal' : string,
  'note' : string,
  'role' : AdminRole,
}
export interface CacheCleanupActionRecord {
  'ok' : boolean,
  'is_running' : boolean,
}
export interface CacheCleanupConfigInput {
  'ttl_seconds' : [] | [bigint],
  /**
   * Each opt: null = no change.
   * period_seconds : opt 0 silently rejected (preserves prior).
   * ttl_seconds    : opt 0 valid ("delete everything older than 0 ns").
   * max_files_per_run : opt 0 clamped to floor (1).
   * max_decision_states : opt 0 = no limit (default 256, ~20 MB each).
   * The config and whether the timer runs survive an upgrade.
   */
  'period_seconds' : [] | [bigint],
  'max_decision_states' : [] | [bigint],
  'max_files_per_run' : [] | [bigint],
}
export interface CacheCleanupConfigRecord {
  'ttl_seconds' : bigint,
  'period_seconds' : bigint,
  'max_decision_states' : [] | [bigint],
  'max_files_per_run' : bigint,
  'is_running' : boolean,
}
export type CacheCleanupConfigResult = { 'Ok' : CacheCleanupConfigRecord } |
  { 'Err' : ApiError };
/**
 * -----------------------------------------------------
 * Recurring prompt-cache cleanup timer
 */
export type CacheCleanupResult = { 'Ok' : CacheCleanupActionRecord } |
  { 'Err' : ApiError };
export interface CacheCleanupStatsRecord {
  'files_deleted' : bigint,
  'ttl_seconds' : bigint,
  /**
   * host-clock timestamp via IC_API::time(); reporting only
   */
  'period_seconds' : bigint,
  'files_examined' : bigint,
  'runs' : bigint,
  'files_failed' : bigint,
  'last_run_ns' : bigint,
  'max_decision_states' : [] | [bigint],
  'max_files_per_run' : bigint,
  'is_running' : boolean,
}
export type CacheCleanupStatsResult = { 'Ok' : CacheCleanupStatsRecord } |
  { 'Err' : ApiError };
/**
 * -----------------------------------------------------
 */
export interface CopyPromptCacheInputRecord { 'to' : string, 'from' : string }
/**
 * -----------------------------------------------------
 * Recurring cycle-balance monitor
 */
export interface CycleBalanceRecord {
  /**
   * the live canister cycle balance (128-bit)
   */
  'updated_at_ns' : bigint,
  'cycle_balance' : bigint,
}
export type CycleBalanceRecordResult = { 'Ok' : CycleBalanceRecord } |
  { 'Err' : ApiError };
export interface DecisionInputRecord {
  /**
   * kev: store the caller's states below this sub-directory, e.g. one per end
   * user of a gateway. 1-63 characters of a-z, 0-9 and -. null = no sub-directory
   */
  'scope' : [] | [string],
  'state' : { 'Json' : string } |
    { 'Text' : string },
  /**
   * Json is parsed, so the template sees structure
   */
  'questions' : Array<
    { 'id' : string, 'kind' : DecisionKind, 'instructions' : string }
  >,
  /**
   * choice: one row per option; score: one row per level, in order (2..10);
   * noul: optional rows with key "true" / "false". description "" = none
   */
  'options' : Array<
    { 'key' : string, 'description' : string, 'question_id' : string }
  >,
}
/**
 * -----------------------------------------------------
 * Decision models (System One): see README-decision-models.md
 * Flat tables (icpp-pro decodes a vec record as a record of vecs), linked by
 * question id. Rows keep the request order.
 */
export type DecisionKind = { 'noul' : null } |
  { 'score' : null } |
  { 'choice' : null };
export interface DecisionOutputRecord {
  'probabilities' : Array<
    { 'key' : string, 'probability' : number, 'question_id' : string }
  >,
  'state_tokens_remaining' : [] | [bigint],
  /**
   * tokens evaluated in THIS call
   */
  'pending' : Array<string>,
  'state_key' : [] | [string],
  /**
   * every question answered so far: this call and earlier calls of the same request
   * choice: choice + confidence; score: score (expected level index) + confidence;
   * noul: yes (probability of yes). Unused fields are "" / 0.0
   */
  'answers' : Array<
    {
      'id' : string,
      'yes' : number,
      'kind' : DecisionKind,
      'score' : number,
      'choice' : string,
      'confidence' : number,
    }
  >,
  /**
   * kev: the name of the stored state (pin_decision_state)
   */
  'instructions' : [] | [bigint],
  'input_tokens' : bigint,
  /**
   * question ids not answered yet: re-send the same request
   * kev models (e.g. Kev-0.8B) store the state per caller, ingesting it over calls:
   * its size in tokens, and how many are not stored yet (0 = stored). null for laya
   */
  'state_tokens' : [] | [bigint],
}
export interface DecisionPinInputRecord {
  'until_ns' : bigint,
  /**
   * "" = the states of requests without a scope
   */
  'state_key' : string,
  'scope' : string,
}
export type DecisionResult = { 'Ok' : DecisionOutputRecord } |
  { 'Err' : ApiError };
export interface DecisionUnpinInputRecord {
  'state_key' : string,
  'scope' : string,
}
/**
 * -----------------------------------------------------
 */
export interface DirContentInputRecord {
  'dir' : string,
  'max_entries' : bigint,
}
export type DirContentRecordResult = { 'Ok' : DirContentVec } |
  { 'Err' : ApiError };
export type DirContentVec = Array<FileEntry>;
/**
 * -----------------------------------------------------
 */
export interface DownloadPromptCacheInputRecord {
  'offset' : bigint,
  'promptcache' : string,
  'chunksize' : bigint,
}
/**
 * -----------------------------------------------------
 */
export interface FileDetailsInputRecord { 'filename' : string }
export interface FileDetailsRecord {
  'filename' : string,
  'filesize' : bigint,
  /**
   * the total filesize in bytes
   */
  'filesha256' : string,
}
export type FileDetailsRecordResult = { 'Ok' : FileDetailsRecord } |
  { 'Err' : ApiError };
/**
 * -----------------------------------------------------
 */
export interface FileDownloadInputRecord {
  'offset' : bigint,
  'filename' : string,
  'chunksize' : bigint,
}
export interface FileDownloadRecord {
  /**
   * the chunk starts here (bytes from beginning)
   */
  'done' : boolean,
  'chunk' : Uint8Array | number[],
  /**
   * the total filesize in bytes
   */
  'offset' : bigint,
  /**
   * the chunksize in bytes
   */
  'filesize' : bigint,
  /**
   * the chunk read from the file, as a vec of bytes
   */
  'chunksize' : bigint,
}
export type FileDownloadRecordResult = { 'Ok' : FileDownloadRecord } |
  { 'Err' : ApiError };
export interface FileEntry { 'filename' : string, 'filetype' : string }
/**
 * -----------------------------------------------------
 */
export interface FileUploadInputRecord {
  'chunk' : Uint8Array | number[],
  /**
   * the chunksize (allowing sanity check)
   */
  'offset' : bigint,
  'filename' : string,
  /**
   * the chunk being uploaded, as a vec of bytes
   */
  'chunksize' : bigint,
}
export interface FileUploadRecord {
  'filename' : string,
  /**
   * the total filesize in bytes
   */
  'filesize' : bigint,
  /**
   * the total filesize in bytes after writing chunk at offset
   */
  'filesha256' : string,
}
export type FileUploadRecordResult = { 'Ok' : FileUploadRecord } |
  { 'Err' : ApiError };
/**
 * -----------------------------------------------------
 */
export interface FilesystemFileSizeInputRecord { 'filename' : string }
export interface FilesystemFileSizeRecord {
  /**
   * the total filesize in bytes
   */
  'msg' : string,
  'filename' : string,
  'filesize' : bigint,
  'exists' : boolean,
}
export type FilesystemFileSizeRecordResult = {
    'Ok' : FilesystemFileSizeRecord
  } |
  { 'Err' : ApiError };
/**
 * -----------------------------------------------------
 */
export interface FilesystemRemoveInputRecord { 'filename' : string }
export interface FilesystemRemoveRecord {
  'msg' : string,
  'filename' : string,
  'exists' : boolean,
  'removed' : boolean,
}
export type FilesystemRemoveRecordResult = { 'Ok' : FilesystemRemoveRecord } |
  { 'Err' : ApiError };
/**
 * -----------------------------------------------------
 */
export interface FilesystemTimestampInputRecord { 'filename' : string }
export interface FilesystemTimestampRecord {
  /**
   * the file creation age in seconds
   */
  'msg' : string,
  'timestamp_ns' : bigint,
  'filename' : string,
  'exists' : boolean,
  /**
   * the file creation timestamp in nanoseconds
   */
  'age_seconds' : bigint,
}
export type FilesystemTimestampRecordResult = {
    'Ok' : FilesystemTimestampRecord
  } |
  { 'Err' : ApiError };
export interface GetChatsRecord {
  'chats' : Array<{ 'chat' : string, 'timestamp' : string }>,
}
/**
 * -----------------------------------------------------
 */
export type GetChatsRecordResult = { 'Ok' : GetChatsRecord } |
  { 'Err' : ApiError };
export interface InputRecord { 'args' : Array<string> }
/**
 * to avoid hitting the IC's instructions limit
 * 0 = no limit (default)
 */
export interface MaxTokensRecord {
  'max_tokens_query' : bigint,
  'max_tokens_update' : bigint,
}
/**
 * -----------------------------------------------------
 * Memory-status report (non-anonymous callers)
 */
export interface MemoryStatusRecord {
  'wasm_heap_bytes' : bigint,
  /**
   * wasm linear-memory high-water-mark (approaches wasm_memory_limit)
   */
  'stable_bytes' : bigint,
}
export type MemoryStatusRecordResult = {
    /**
     * includes access-denied for anonymous callers
     */
    'Ok' : MemoryStatusRecord
  } |
  { 'Err' : ApiError };
export type OutputRecordResult = { 'Ok' : RunOutputRecord } |
  { 'Err' : RunOutputRecord };
/**
 * -----------------------------------------------------
 */
export interface PromptCacheDetailsInputRecord { 'promptcache' : string }
export interface RunOutputRecord {
  /**
   * Exact token accounting, populated only on a run_update / run_query success
   * record; `opt` so other OutputRecordResult producers (errors, new_chat,
   * load_model, ...) may omit them (they decode as null). See the "Exact
   * token accounting" note in the README run_update section.
   */
  'n_prompt_tokens' : [] | [bigint],
  'output' : string,
  'n_tokens_generated' : [] | [bigint],
  'conversation' : string,
  'error' : string,
  'n_prompt_tokens_remaining' : [] | [bigint],
  'n_prompt_tokens_cached' : [] | [bigint],
  'status_code' : StatusCode,
  'prompt_remaining' : string,
  'generated_eog' : boolean,
  /**
   * run_update_full only: true when the response was cut short (the canister
   * is stopping, or the chunk cap was reached). Continue it with run_update.
   */
  'partial' : [] | [boolean],
  'n_prompt_tokens_decoded' : [] | [bigint],
}
/**
 * Always return a single record wrapped in a variant
 */
export type StatusCode = number;
export interface StatusCodeRecord { 'status_code' : number }
/**
 * HTTPS status code wrapped in a Record wrapped in a Result
 */
export type StatusCodeRecordResult = { 'Ok' : StatusCodeRecord } |
  { 'Err' : ApiError };
/**
 * Uses EXISTING ApiError type (NOT modified)
 */
export type TextResult = { 'Ok' : string } |
  { 'Err' : ApiError };
/**
 * -----------------------------------------------------
 */
export interface UploadPromptCacheInputRecord {
  'chunk' : Uint8Array | number[],
  'offset' : bigint,
  'promptcache' : string,
  'chunksize' : bigint,
}
/**
 * -----------------------------------------------------
 * The endpoint services of our canister
 */
export interface _SERVICE {
  /**
   * Admin RBAC Management (Controller-only)
   */
  'assignAdminRole' : ActorMethod<
    [AssignAdminRoleInputRecord],
    AdminRoleAssignmentResult
  >,
  'cache_cleanup_now' : ActorMethod<[], CacheCleanupStatsResult>,
  /**
   * Recurring prompt-cache cleanup timer (admin-only)
   */
  'cache_cleanup_start_timer' : ActorMethod<[], CacheCleanupResult>,
  'cache_cleanup_stop_timer' : ActorMethod<[], CacheCleanupResult>,
  /**
   * Chats retrieval
   */
  'chats_pause' : ActorMethod<[], StatusCodeRecordResult>,
  'chats_resume' : ActorMethod<[], StatusCodeRecordResult>,
  'check_access' : ActorMethod<[], StatusCodeRecordResult>,
  'copy_prompt_cache' : ActorMethod<
    [CopyPromptCacheInputRecord],
    StatusCodeRecordResult
  >,
  /**
   * Recurring cycle-balance monitor (admin-only)
   */
  'cycle_balance_start_timer' : ActorMethod<[], StatusCodeRecordResult>,
  'cycle_balance_stop_timer' : ActorMethod<[], StatusCodeRecordResult>,
  'download_prompt_cache_chunk' : ActorMethod<
    [DownloadPromptCacheInputRecord],
    FileDownloadRecordResult
  >,
  /**
   * upload, download & removal of files
   */
  'file_download_chunk' : ActorMethod<
    [FileDownloadInputRecord],
    FileDownloadRecordResult
  >,
  'file_upload_chunk' : ActorMethod<
    [FileUploadInputRecord],
    FileUploadRecordResult
  >,
  'filesystem_file_size' : ActorMethod<
    [FilesystemFileSizeInputRecord],
    FilesystemFileSizeRecordResult
  >,
  /**
   * Files - general utility endpoints exposing std::filesystem functions
   */
  'filesystem_remove' : ActorMethod<
    [FilesystemRemoveInputRecord],
    FilesystemRemoveRecordResult
  >,
  'getAdminRoles' : ActorMethod<[], AdminRoleAssignmentsResult>,
  'get_access' : ActorMethod<[], AccessRecordResult>,
  'get_cache_cleanup_stats' : ActorMethod<[], CacheCleanupStatsResult>,
  'get_chats' : ActorMethod<[], GetChatsRecordResult>,
  'get_creation_timestamp_ns' : ActorMethod<
    [FilesystemTimestampInputRecord],
    FilesystemTimestampRecordResult
  >,
  'get_cycle_balance' : ActorMethod<[], CycleBalanceRecordResult>,
  'get_max_tokens' : ActorMethod<[], MaxTokensRecord>,
  /**
   * Memory-status report (non-anonymous callers)
   */
  'get_memory_status' : ActorMethod<[], MemoryStatusRecordResult>,
  /**
   * canister
   */
  'health' : ActorMethod<[], StatusCodeRecordResult>,
  /**
   * model endpoints
   */
  'load_model' : ActorMethod<[InputRecord], OutputRecordResult>,
  'log_pause' : ActorMethod<[], StatusCodeRecordResult>,
  'log_resume' : ActorMethod<[], StatusCodeRecordResult>,
  /**
   * Inference endpoints
   */
  'new_chat' : ActorMethod<[InputRecord], OutputRecordResult>,
  /**
   * all of the caller's files of a scope
   */
  'pin_decision_state' : ActorMethod<
    [DecisionPinInputRecord],
    StatusCodeRecordResult
  >,
  'ready' : ActorMethod<[], StatusCodeRecordResult>,
  'recursive_dir_content_query' : ActorMethod<
    [DirContentInputRecord],
    DirContentRecordResult
  >,
  'recursive_dir_content_update' : ActorMethod<
    [DirContentInputRecord],
    DirContentRecordResult
  >,
  /**
   * the whole request in one call (self-call yields)
   */
  'remove_decision_scope' : ActorMethod<[string], StatusCodeRecordResult>,
  /**
   * Logging endpoints
   */
  'remove_log_file' : ActorMethod<[InputRecord], OutputRecordResult>,
  /**
   * Prompt cache endpoints
   */
  'remove_prompt_cache' : ActorMethod<[InputRecord], OutputRecordResult>,
  'revokeAdminRole' : ActorMethod<[string], TextResult>,
  /**
   * the whole response in one call (self-call yields)
   */
  'run_decision' : ActorMethod<[DecisionInputRecord], DecisionResult>,
  'run_decision_full' : ActorMethod<[DecisionInputRecord], DecisionResult>,
  'run_query' : ActorMethod<[InputRecord], OutputRecordResult>,
  'run_update' : ActorMethod<[InputRecord], OutputRecordResult>,
  'run_update_full' : ActorMethod<[InputRecord], OutputRecordResult>,
  /**
   * Access level
   */
  'set_access' : ActorMethod<[AccessInputRecord], AccessRecordResult>,
  'set_cache_cleanup_config' : ActorMethod<
    [CacheCleanupConfigInput],
    CacheCleanupConfigResult
  >,
  'set_max_tokens' : ActorMethod<[MaxTokensRecord], StatusCodeRecordResult>,
  'unpin_decision_state' : ActorMethod<
    [DecisionUnpinInputRecord],
    StatusCodeRecordResult
  >,
  'upload_prompt_cache_chunk' : ActorMethod<
    [UploadPromptCacheInputRecord],
    FileUploadRecordResult
  >,
  'uploaded_file_details' : ActorMethod<
    [FileDetailsInputRecord],
    FileDetailsRecordResult
  >,
  'uploaded_prompt_cache_details' : ActorMethod<
    [PromptCacheDetailsInputRecord],
    FileDetailsRecordResult
  >,
  /**
   * Other admin endpoints
   */
  'whoami' : ActorMethod<[], string>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
