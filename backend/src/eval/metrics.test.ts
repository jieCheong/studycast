import { describe, it, expect } from "vitest";
import { precisionAtK, recallAtK, percentile } from "./metrics";

describe("precisionAtK", () => {
  it("returns 1 when every retrieved item is relevant", () => {
    expect(precisionAtK([0, 1, 2], [0, 1, 2], 3)).toBe(1);
  });

  it("returns 0 when no retrieved item is relevant", () => {
    expect(precisionAtK([3, 4, 5], [0, 1, 2], 3)).toBe(0);
  });

  it("counts only hits within the top k", () => {
    // relevant item (2) sits outside the top-2 window, so it shouldn't count
    expect(precisionAtK([0, 1, 2], [2], 2)).toBe(0);
  });

  it("computes a fractional hit rate", () => {
    expect(precisionAtK([0, 1, 2, 3, 4], [0, 2, 9], 5)).toBeCloseTo(2 / 5);
  });
});

describe("recallAtK", () => {
  it("returns 1 when all relevant items are retrieved", () => {
    expect(recallAtK([0, 1, 2], [0, 2], 3)).toBe(1);
  });

  it("returns 0 when none of the relevant items are retrieved", () => {
    expect(recallAtK([3, 4, 5], [0, 1], 3)).toBe(0);
  });

  it("computes a fractional recall when only some relevant items are found", () => {
    expect(recallAtK([0, 1, 2], [0, 5, 9], 3)).toBeCloseTo(1 / 3);
  });

  it("returns 0 when there are no relevant items, avoiding a divide-by-zero", () => {
    expect(recallAtK([0, 1, 2], [], 3)).toBe(0);
  });
});

describe("percentile", () => {
  it("returns the median for p50 on an odd-length array", () => {
    expect(percentile([5, 1, 3], 50)).toBe(3);
  });

  it("returns the max for p100", () => {
    expect(percentile([10, 30, 20], 100)).toBe(30);
  });

  it("returns the min for very low percentiles", () => {
    expect(percentile([10, 30, 20], 1)).toBe(10);
  });

  it("does not mutate the input array", () => {
    const input = [3, 1, 2];
    percentile(input, 50);
    expect(input).toEqual([3, 1, 2]);
  });

  it("computes p95 on a larger sample", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(values, 95)).toBe(95);
  });
});
