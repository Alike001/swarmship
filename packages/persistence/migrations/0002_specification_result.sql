ALTER TABLE releases
  ADD COLUMN specification jsonb,
  ADD COLUMN specification_summary text,
  ADD COLUMN missing_fields jsonb;

ALTER TABLE releases
  ADD CONSTRAINT releases_specification_object
    CHECK (specification IS NULL OR jsonb_typeof(specification) = 'object'),
  ADD CONSTRAINT releases_specification_summary_length
    CHECK (
      specification_summary IS NULL
      OR length(specification_summary) BETWEEN 1 AND 600
    ),
  ADD CONSTRAINT releases_missing_fields_array
    CHECK (missing_fields IS NULL OR jsonb_typeof(missing_fields) = 'array');

ALTER TABLE release_transitions
  ADD COLUMN tool_name text,
  ADD COLUMN safe_summary text,
  ADD COLUMN deterministic_result jsonb;

ALTER TABLE release_transitions
  ADD CONSTRAINT release_transitions_tool_name_length
    CHECK (tool_name IS NULL OR length(tool_name) BETWEEN 1 AND 100),
  ADD CONSTRAINT release_transitions_safe_summary_length
    CHECK (safe_summary IS NULL OR length(safe_summary) BETWEEN 1 AND 600),
  ADD CONSTRAINT release_transitions_deterministic_result_object
    CHECK (
      deterministic_result IS NULL
      OR jsonb_typeof(deterministic_result) = 'object'
    );
