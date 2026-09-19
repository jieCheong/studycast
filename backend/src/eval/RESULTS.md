# Retrieval Accuracy Eval Results

Run date: 2026-09-19
Corpus: 23 docs, 639 chunks
Queries evaluated: 42
Average recall@5: 0.988
Average precision@5: 0.290
Retrieval latency p50: 281ms
Retrieval latency p95: 347ms

## Latency at small vs. realistic scale

Same 42 labeled queries and metrics, run twice against a differently-sized chunks table (the labeled docs and their ground truth never changed — only unrelated filler docs were added to grow the table).

| Scale | Docs | Total chunks | Recall@5 | Precision@5 | p50 | p95 |
|---|---|---|---|---|---|---|
| Small (pre-padding) | 3 | 33 | 0.988 | 0.290 | 229ms | 409ms |
| Realistic | 23 | 639 | 0.988 | 0.290 | 281ms | 347ms |

Latency held steady going from 33 to 639 chunks (a ~19x larger table): p95 went from 409ms to 347ms. Retrieval is still scoped to a single upload's chunks per query (`WHERE upload_id = $2`), so growing the total table size mostly stresses whether the HNSW index keeps that per-document search fast rather than falling back to a full scan.

Note: this eval corpus has only 1-2 relevant chunks per query out of 10-12 chunks per labeled doc, so precision@5 is mechanically capped well below 1.0 even for perfect retrieval (1-2 hits out of a 5-wide window). Recall@5 is the metric that reflects whether retrieval actually surfaced the relevant chunks, and is the one to cite.

Note: latency is measured end-to-end around `retrieveRelevantChunks`, which includes the OpenAI query-embedding API call over the network, not just the pgvector similarity search. It's a fair number for "time from query to retrieved chunks," but don't cite it as pure database latency.

## Per-query results (realistic-scale run)

| Query | Recall@5 | Precision@5 | Latency |
|---|---|---|---|
| What are the three parts of cell theory? | 1.00 | 0.20 | 205ms |
| What is the difference between prokaryotic and eukaryotic cells? | 1.00 | 0.40 | 347ms |
| What is the nucleolus responsible for? | 1.00 | 0.20 | 242ms |
| Why are mitochondria called the powerhouse of the cell? | 1.00 | 0.40 | 219ms |
| What is the endosymbiotic theory? | 1.00 | 0.20 | 349ms |
| What is the difference between rough and smooth endoplasmic reticulum? | 1.00 | 0.40 | 312ms |
| What are the cis and trans faces of the Golgi apparatus? | 1.00 | 0.20 | 262ms |
| What do lysosomes do inside a cell? | 1.00 | 0.40 | 340ms |
| What is the fluid mosaic model of the cell membrane? | 1.00 | 0.20 | 327ms |
| What happens during the Calvin cycle in chloroplasts? | 1.00 | 0.20 | 316ms |
| What are the three main components of the cytoskeleton? | 1.00 | 0.20 | 300ms |
| What happens during metaphase and anaphase of mitosis? | 1.00 | 0.20 | 300ms |
| What is the difference between diffusion and osmosis? | 1.00 | 0.40 | 312ms |
| How does the sodium-potassium pump work? | 1.00 | 0.40 | 196ms |
| What was the root cause of the American Civil War? | 1.00 | 0.20 | 313ms |
| How many soldiers died in the Civil War? | 1.00 | 0.20 | 298ms |
| What triggered the Southern states to secede from the Union? | 1.00 | 0.20 | 305ms |
| Which state seceded from the Union first? | 1.00 | 0.20 | 205ms |
| What happened at Fort Sumter in April 1861? | 1.00 | 0.20 | 281ms |
| What material advantages did the Union have over the Confederacy? | 1.00 | 0.20 | 337ms |
| What was the bloodiest single day of the Civil War? | 1.00 | 0.40 | 289ms |
| What did the Emancipation Proclamation do? | 1.00 | 0.40 | 228ms |
| Why was the Battle of Gettysburg significant? | 1.00 | 0.20 | 211ms |
| What was the significance of the Siege of Vicksburg? | 1.00 | 0.40 | 288ms |
| What was Sherman's March to the Sea? | 1.00 | 0.40 | 295ms |
| How did the Civil War end? | 1.00 | 0.40 | 228ms |
| Who assassinated Abraham Lincoln and when? | 1.00 | 0.20 | 301ms |
| What did the Thirteenth Amendment do? | 1.00 | 0.40 | 223ms |
| What rights did the Fourteenth and Fifteenth Amendments guarantee? | 1.00 | 0.20 | 210ms |
| What is the time complexity of bubble sort? | 1.00 | 0.40 | 217ms |
| How does selection sort work? | 0.50 | 0.20 | 383ms |
| Why is insertion sort efficient for nearly sorted data? | 1.00 | 0.40 | 226ms |
| How does merge sort work? | 1.00 | 0.40 | 271ms |
| What is the worst-case time complexity of quicksort and when does it occur? | 1.00 | 0.20 | 313ms |
| How does heapsort use a binary heap to sort a list? | 1.00 | 0.40 | 198ms |
| When is counting sort a good choice for sorting? | 1.00 | 0.40 | 239ms |
| How does radix sort achieve linear time complexity? | 1.00 | 0.40 | 277ms |
| What is the theoretical lower bound for comparison-based sorting algorithms? | 1.00 | 0.40 | 208ms |
| What does it mean for a sorting algorithm to be stable? | 1.00 | 0.20 | 306ms |
| Which sorting algorithms are stable and which are not? | 1.00 | 0.20 | 243ms |
| What is Timsort and which languages use it? | 1.00 | 0.20 | 267ms |
| What is Introsort and how does it combine quicksort and heapsort? | 1.00 | 0.20 | 304ms |
