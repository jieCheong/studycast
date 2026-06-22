export function chunkTextForEmbedding(
    text: string,
    chunkSize = 1000,
    overlap = 150
): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        let chunk = text.slice(start, end);

        if (end < text.length) {
            const lastPeriod = chunk.lastIndexOf(". ");
            if (lastPeriod > chunkSize * 0.5) {
                chunk = chunk.slice(0, lastPeriod + 1);
            }
        }
        chunks.push(chunk.trim());
        const advance = chunk.length - overlap;
        start += advance > 0 ? advance : chunk.length; // guarantee forward progress
    }
    return chunks.filter((c) => c.length > 20);
}