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

export async function retrieveAllChunksOrdered(uploadId: string): Promise<RetrievedChunk[]> {
    const result = await pool.query(
        `SELECT id, chunk_text, chunk_index, 0 AS distance
        FROM chunks
        WHERE upload_id = $1
        ORDER BY chunk_index ASC`,
        [uploadId]
    );
    return result.rows.map((row) => ({
        id: row.id,
        chunkText: row.chunk_text,
        chunkIndex: row.chunk_index,
        distance: 0,
    }));
}

// Rough token estimate: ~4 characters per token for English text.
// This is intentionally conservative (overestimates tokens slightly)
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

export function selectChunksWithinBudget(
    chunks: RetrievedChunk[],
    maxTokens = 12000
): RetrievedChunk[] {
    const selected: RetrievedChunk[] = [];
    let totalTokens = 0;

    for (const chunk of chunks) {
        const chunkTokens = estimateTokens(chunk.chunkText);
        if (totalTokens + chunkTokens > maxTokens) break;
        selected.push(chunk);
        totalTokens += chunkTokens;
    }
    return selected;
}