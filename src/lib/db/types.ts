// Ainbox DB types — keep in sync with supabase/migrations/0001_init.sql.
// PRD anchors: §4.1, §4.2, §4.3, §6.1.
//
// These are hand-written for now. Once the Supabase project is up,
// `supabase gen types typescript --linked` will replace this file
// with a fully generated `Database` interface (see follow-up ticket).

export type Provider = 'gmail' | 'outlook';

export type KbItemType =
  | 'faq'
  | 'policy'
  | 'pricing'
  | 'preference'
  | 'contact'
  | 'signature'
  | 'tone-sample';

export type DraftStatus = 'pending' | 'approved' | 'sent' | 'rejected';

/** oauth_tokens — primary key (user_id, provider). */
export interface OAuthToken {
  user_id: string;
  provider: Provider;
  /** Application-encrypted (AES-GCM via Supabase Vault). Never plaintext. */
  encrypted_refresh_token: string;
  /** Optional cached access token (encrypted). Minted on demand otherwise. */
  access_token_encrypted: string | null;
  expires_at: string | null;
  scope: string | null;
  created_at: string;
  updated_at: string;
}

/** email_messages — body stored as bytea (encrypted). */
export interface EmailMessage {
  id: string;
  user_id: string;
  provider: Provider;
  external_message_id: string;
  thread_id: string | null;
  sender_email: string | null;
  /** sha256 hash, never raw subject. */
  subject_hash: string | null;
  /** AES-GCM ciphertext bytes. */
  body_encrypted: Uint8Array | null;
  body_iv: Uint8Array | null;
  length_chars: number | null;
  received_at: string | null;
  category: string | null;
  classified_at: string | null;
  /** numeric(3,2) — 0.00 to 1.00. */
  confidence: number | null;
  is_outbound: boolean;
}

/** email_sync_state — primary key (user_id, provider). */
export interface EmailSyncState {
  user_id: string;
  provider: Provider;
  /** Outlook delta token. */
  delta_token: string | null;
  /** Gmail history id. */
  history_id: string | null;
  last_synced_at: string | null;
}

/** kb_items — vector dimension locked at 1024 (Ollama bge-m3). */
export interface KbItem {
  id: string;
  user_id: string;
  type: KbItemType;
  content: string;
  source_email_id: string | null;
  confidence: number | null;
  human_verified: boolean;
  /** vector(1024) — represented as number[] over the wire. */
  embedding: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface Draft {
  id: string;
  user_id: string;
  in_reply_to: string | null;
  body: string;
  confidence: number | null;
  category: string | null;
  status: DraftStatus;
  provider_draft_id: string | null;
  scheduled_send_at: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface AutomationConfig {
  user_id: string;
  category: string | null;
  auto_send: boolean;
  /** numeric(3,2), check >= 0.85 enforced in DB. */
  threshold: number;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  event_type: string;
  target_id: string | null;
  model: string | null;
  confidence: number | null;
  kb_items_used: string[] | null;
  details_json: Record<string, unknown> | null;
  created_at: string;
}

/** Convenience aggregate type, mirroring `Database['public']['Tables']`. */
export interface AinboxTables {
  oauth_tokens: OAuthToken;
  email_messages: EmailMessage;
  email_sync_state: EmailSyncState;
  kb_items: KbItem;
  drafts: Draft;
  automation_config: AutomationConfig;
  audit_log: AuditLog;
}

/** Names of every tenant-scoped table — exhaustive list for contract tests. */
export const TENANT_TABLES: ReadonlyArray<keyof AinboxTables> = [
  'oauth_tokens',
  'email_messages',
  'email_sync_state',
  'kb_items',
  'drafts',
  'automation_config',
  'audit_log',
] as const;

/** Hard floor for auto-send threshold (PRD §4.4 / mission §9.2). */
export const AUTO_SEND_MIN_THRESHOLD = 0.85;
