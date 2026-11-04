import { describe, it, expect } from "vitest";
import { renderCacheReport, type CacheResult } from "../src/cache-main.js";

const rows: CacheResult[] = [
  { task_id: "t1", domain: "a.example", arm: "cold", found: true, wall_ms: 100, tokens: 60 },
  { task_id: "t1", domain: "a.example", arm: "warm", found: true, wall_ms: 2, tokens: 60 },
  { task_id: "t1", domain: "a.example", arm: "para", found: true, wall_ms: 20, tokens: 60 },
  { task_id: "t2", domain: "a.example", arm: "cold", found: false, wall_ms: 90, tokens: 10 },
  { task_id: "t2", domain: "a.example", arm: "warm", found: false, wall_ms: 90, tokens: 10 },
  { task_id: "t2", domain: "a.example", arm: "para", found: false, wall_ms: 90, tokens: 10 },
];

describe("cache bench report", () => {
  it("tabulates per-arm found rates and medians over successes only", () => {
    const md = renderCacheReport(rows);
    expect(md).toContain("| a.example | cold | 1/2 | 100 |");
    expect(md).toContain("| a.example | warm | 1/2 | 2 |");
    expect(md).toContain("| a.example | para | 1/2 | 20 |");
    expect(md).toContain("| ALL | cold | 1/2 |");
    expect(md).toMatch(/50\.0x/); // warm is 50x the cold median here
  });
});
