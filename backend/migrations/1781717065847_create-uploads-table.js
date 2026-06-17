exports.up = (pgm) => {
  pgm.createTable("uploads", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "cascade" },
    filename: { type: "text", notNull: true },
    file_path: { type: "text" },
    extracted_text: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("uploads");
};