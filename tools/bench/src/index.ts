export * from "./corpus.js";
export * from "./raw-arm.js";
export * from "./arms/crawl-arm.js";
export * from "./arms/browser-arm.js";
export * from "./arms/mcp-arm.js";
export * from "./speed-runner.js";
export * from "./harness.js";
export * from "./report.js";
import { writeFileSync } from "node:fs";
import { loadCorpus } from "./corpus.js";
import { runBench, type FixtureSite } from "./harness.js";
import { renderReport } from "./report.js";
/** Tiny fixture sites for smoke bench; real sites arrive with Q2 corpus. */
export function fixtureSites(): Map<string, FixtureSite> {
  const mk = (domain: string, cats: [string, string][]): FixtureSite => ({
    domain,
    pages: [
      { url: `https://${domain}/`, html: `<html><body>${"nav ".repeat(200)}${cats.map(([t, h]) => `<a href="${h}">${t}</a>`).join("")}</body></html>`, links: cats.map(([text, href]) => ({ text, href: `https://${domain}${href}` })) },
      ...cats.map(([, href]) => ({ url: `https://${domain}${href}`, html: `<html><body>${"product listing filler ".repeat(300)}</body></html>`, links: [] })),
    ],
  });
  return new Map([
    ["mini-auto.example", mk("mini-auto.example", [["brake pads", "/brakes/brake-pads"], ["oil filter", "/filters/oil"]])],
    ["mini-home.example", mk("mini-home.example", [["interior paint", "/paint/interior"], ["drills", "/tools/drills"]])],
  ]);
}
const isMain = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isMain) {
  const corpus = loadCorpus(process.argv[2] ?? "tools/bench/corpus/mini-auto-parts.json");
  const finder = async (_d: string, q: string) => {
    const t = corpus.tasks.find((x) => x.question === q);
    return { found: !!t, steps: t ? [{ action: "navigate", url: t.expected_url_pattern }] : [], result_url_template: t?.expected_url_pattern ?? null };
  };
  runBench(corpus, fixtureSites(), finder).then((r) => {
    const md = renderReport(r);
    const out = `docs/bench/${new Date().toISOString().slice(0, 10)}-fixture.md`;
    writeFileSync(out, md); console.log(md); console.log(`wrote ${out}`);
  });
}
