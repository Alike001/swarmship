ALTER TABLE releases
  ADD CONSTRAINT releases_manifest_approval_object
    CHECK (
      manifest_approval IS NULL
      OR jsonb_typeof(manifest_approval) = 'object'
    );
