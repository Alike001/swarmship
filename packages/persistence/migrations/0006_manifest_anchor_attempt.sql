ALTER TABLE releases
  ADD COLUMN manifest_anchor_attempt jsonb;

ALTER TABLE releases
  ADD CONSTRAINT releases_manifest_anchor_attempt_object
    CHECK (
      manifest_anchor_attempt IS NULL
      OR jsonb_typeof(manifest_anchor_attempt) = 'object'
    );
