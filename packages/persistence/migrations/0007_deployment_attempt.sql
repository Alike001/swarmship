ALTER TABLE releases
  ADD COLUMN deployment_attempt jsonb;

ALTER TABLE releases
  ADD CONSTRAINT releases_deployment_attempt_object
    CHECK (
      deployment_attempt IS NULL
      OR jsonb_typeof(deployment_attempt) = 'object'
    );
