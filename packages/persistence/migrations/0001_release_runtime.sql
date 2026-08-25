CREATE TABLE releases (
  id uuid PRIMARY KEY,
  public_id text NOT NULL UNIQUE CHECK (length(public_id) BETWEEN 8 AND 80),
  original_request text NOT NULL CHECK (length(original_request) BETWEEN 1 AND 4000),
  state text NOT NULL DEFAULT 'created' CHECK (state IN (
    'created', 'needs_input', 'specified', 'building', 'verification_failed',
    'awaiting_approval', 'approved', 'anchoring_manifest',
    'approved_not_deployed', 'deploying', 'deployed_unverified',
    'anchoring_receipt', 'verified', 'failed', 'reconciliation_required'
  )),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  reconciliation_kind text CHECK (reconciliation_kind IN (
    'manifest_anchor', 'deployment', 'receipt_anchor'
  )),
  build_evidence jsonb,
  manifest_approval jsonb,
  safe_error jsonb,
  lease_owner text CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 120),
  lease_token uuid,
  lease_expires_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (state = 'reconciliation_required' AND reconciliation_kind IS NOT NULL)
    OR (state <> 'reconciliation_required' AND reconciliation_kind IS NULL)
  ),
  CHECK (
    (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX releases_claimable_idx
  ON releases (next_attempt_at, created_at)
  WHERE state NOT IN ('verified', 'failed');

CREATE TABLE release_transitions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  version_before integer NOT NULL CHECK (version_before >= 0),
  version_after integer NOT NULL CHECK (version_after = version_before + 1),
  actor text NOT NULL CHECK (actor IN (
    'specification', 'build', 'verification', 'deployment', 'witness', 'user', 'system'
  )),
  event text NOT NULL CHECK (length(event) BETWEEN 3 AND 80),
  from_state text NOT NULL,
  to_state text NOT NULL,
  evidence_ref text NOT NULL CHECK (evidence_ref ~ '^0x[0-9a-f]{64}$'),
  effects jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(effects) = 'array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (release_id, version_after)
);

CREATE TABLE chain_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id uuid REFERENCES releases(id) ON DELETE SET NULL,
  chain_id integer NOT NULL CHECK (chain_id > 0),
  block_number bigint NOT NULL CHECK (block_number >= 0),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer NOT NULL CHECK (log_index >= 0),
  contract_address text NOT NULL CHECK (contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  event_name text NOT NULL CHECK (length(event_name) BETWEEN 1 AND 100),
  decoded_fields jsonb NOT NULL CHECK (jsonb_typeof(decoded_fields) = 'object'),
  confirmation_state text NOT NULL CHECK (confirmation_state IN ('observed', 'confirmed', 'orphaned')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (chain_id, transaction_hash, log_index)
);

CREATE TABLE idempotency_keys (
  caller_scope text NOT NULL CHECK (length(caller_scope) BETWEEN 1 AND 120),
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
  operation text NOT NULL CHECK (length(operation) BETWEEN 1 AND 80),
  request_hash text NOT NULL CHECK (request_hash ~ '^0x[0-9a-f]{64}$'),
  release_id uuid NOT NULL REFERENCES releases(id) DEFERRABLE INITIALLY DEFERRED,
  saved_response jsonb NOT NULL CHECK (jsonb_typeof(saved_response) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (caller_scope, key, operation)
);
