exports.up = (pgm) => {
  pgm.createTable("outputs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    job_id: { type: "uuid", notNull: true, references: "jobs", onDelete: "cascade" },
    transcript: { type: "text" },
    audio_url: { type: "text" },
    duration_seconds: { type: "integer" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("outputs");
};