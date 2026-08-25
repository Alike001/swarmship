ALTER TABLE releases
  ADD CONSTRAINT releases_build_evidence_object
    CHECK (build_evidence IS NULL OR jsonb_typeof(build_evidence) = 'object');
