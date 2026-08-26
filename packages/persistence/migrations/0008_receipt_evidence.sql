ALTER TABLE releases
  ADD COLUMN receipt_evidence jsonb;

ALTER TABLE releases
  ADD CONSTRAINT releases_receipt_evidence_object
    CHECK (
      receipt_evidence IS NULL
      OR jsonb_typeof(receipt_evidence) = 'object'
    );

ALTER TABLE releases
  ADD COLUMN receipt_anchor_attempt jsonb;

ALTER TABLE releases
  ADD CONSTRAINT releases_receipt_anchor_attempt_object
    CHECK (
      receipt_anchor_attempt IS NULL
      OR jsonb_typeof(receipt_anchor_attempt) = 'object'
    );
