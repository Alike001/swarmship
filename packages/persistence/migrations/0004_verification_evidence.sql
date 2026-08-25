ALTER TABLE releases
  ADD COLUMN verification_evidence jsonb;

ALTER TABLE releases
  ADD CONSTRAINT releases_verification_evidence_object
    CHECK (
      verification_evidence IS NULL
      OR jsonb_typeof(verification_evidence) = 'object'
    );
