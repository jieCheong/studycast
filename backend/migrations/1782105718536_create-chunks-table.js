exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS vector;');

  pgm.createTable("chunks", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    upload_id: { type: "uuid", notNull: true, references: "uploads", onDelete: "cascade" },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "cascade" },
    chunk_text: { type: "text", notNull: true },
    chunk_index: { type: "integer", notNull: true },
    embedding: { type: "vector(1536)", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.sql(`
    CREATE INDEX chunks_embedding_idx ON chunks 
    USING hnsw (embedding vector_cosine_ops);
  `);

  pgm.createIndex("chunks", "upload_id");
};

exports.down = (pgm) => {
  pgm.dropTable("chunks");
};
