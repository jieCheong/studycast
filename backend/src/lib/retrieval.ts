import { pool } from "../db";
import { generateEmbedding } from "./openai";

export interface RetrievedChunk {
    id: string;
    chunkText: string;
    chunkIndex: number;
    distance: number;
}

export async function retrieveRelevantChunks(
    uploadId: string,
    query: string,
    topK = 5
): Promise<RetrievedChunk[]> {
    const queryEmbedding = await generateEmbedding(query);
    const embeddingString = `[${queryEmbedding.join(",")}]`;

    // pgvector's <=> operator computes cosine distanceL 0 = identical, 2 = opposite.
    // Lower distance = more relevant. We order ascending and take the closest matches.
    const result = await pool.query(
    `SELECT id, chunk_text, chunk_index, embedding <=> $1 AS distance
     FROM chunks
     WHERE upload_id = $2
     ORDER BY embedding <=> $1
     LIMIT $3`,
    [embeddingString, uploadId, topK]
    );

    return result.rows.map((row) => ({
        id: row.id,
        chunkText: row.chunk_text,
        chunkIndex: row.chunk_index,
        distance: parseFloat(row.distance),
    }));
}