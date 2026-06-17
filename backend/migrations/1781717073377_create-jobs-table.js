exports.up = (pgm) => {
  pgm.createType("job_mode", ["understanding", "memorization"]);
  pgm.createType("job_status", ["queued", "processing", "complete", "failed"]);

  pgm.createTable("jobs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    upload_id: { type: "uuid", notNull: true, references: "uploads", onDelete: "cascade" },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "cascade" },
    mode: { type: "job_mode", notNull: true, default: "understanding" },
    language: { type: "text", notNull: true, default: "en" },
    length: { type: "text", notNull: true, default: "medium" },
    voice: { type: "text" },
    status: { type: "job_status", notNull: true, default: "queued" },
    error_message: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    completed_at: { type: "timestamptz" },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("jobs");
  pgm.dropType("job_status");
  pgm.dropType("job_mode");
};