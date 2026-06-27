exports.up = (pgm) => {
  pgm.sql(`ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'extracting'`);
  pgm.sql(`ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'embedding'`);
  pgm.sql(`ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'generating-script'`);
  pgm.sql(`ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'generating-audio'`);
};

exports.down = (pgm) => {
  // PostgreSQL does not support removing enum values without recreating the type.
  // Drop and recreate with original values only.
  pgm.sql(`
    ALTER TABLE jobs ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE jobs ALTER COLUMN status TYPE text USING status::text;
    DROP TYPE job_status;
    CREATE TYPE job_status AS ENUM ('queued', 'processing', 'complete', 'failed');
    ALTER TABLE jobs ALTER COLUMN status TYPE job_status USING status::job_status;
    ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'queued';
  `);
};
