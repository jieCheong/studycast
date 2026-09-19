export function precisionAtK(retrievedIndices: number[], relevantIndices: number[], k: number): number {
  const retrievedAtK = retrievedIndices.slice(0, k);
  const hits = retrievedAtK.filter((i) => relevantIndices.includes(i)).length;
  return hits / k;
}

export function recallAtK(retrievedIndices: number[], relevantIndices: number[], k: number): number {
  if (relevantIndices.length === 0) return 0;
  const retrievedAtK = retrievedIndices.slice(0, k);
  const hits = retrievedAtK.filter((i) => relevantIndices.includes(i)).length;
  return hits / relevantIndices.length;
}

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}
