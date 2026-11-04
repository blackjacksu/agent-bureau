import { createHash } from "node:crypto";
import { tokenize } from "./normalize.js";
export interface EmbeddingProvider { model: string; dims: number; embed(text: string): Promise<number[]> }
export function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const n = Math.min(a.length, b.length); let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
/** Deterministic token-hashing embedding for tests/offline. No network. */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  // Default dims must match the DB vector(1536) column: indexer and query service
  // create separate provider instances, and mismatched dims make cosine meaningless.
  model = "fake/token-hash@1"; constructor(public dims = 1536) {}
  async embed(text: string): Promise<number[]> {
    const v = new Array(this.dims).fill(0);
    const toks = tokenize(text).map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
    for (const t of toks) {
      const h = createHash("sha256").update(t).digest();
      const idx = h.readUInt32BE(0) % this.dims;
      v[idx] += 1;
      v[(idx + 17) % this.dims] += 0.3;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}
export class HostedEmbeddingProvider implements EmbeddingProvider {
  model: string; dims = 1536;
  constructor(private opts: { apiKey: string; model?: string; baseUrl?: string; dims?: number; padTo?: number; fetchFn?: typeof fetch }) {
    this.model = opts.model ?? "text-embedding-3-small";
  }
  async embed(text: string): Promise<number[]> {
    const f = this.opts.fetchFn ?? fetch;
    const base = (this.opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const res = await f(`${base}/embeddings`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` }, body: JSON.stringify({ model: this.model, input: text, ...(this.opts.dims ? { dimensions: this.opts.dims } : {}) }) });
    if (!res.ok) throw Object.assign(new Error(`embedding provider ${res.status}`), { code: "upstream_error" });
    const j: any = await res.json();
    const vec = j?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) throw Object.assign(new Error("embedding provider bad response"), { code: "upstream_error" });
    const out = vec.map(Number);
    // Zero-padding keeps cosine similarity identical while fitting the fixed vector(1536) column.
    const pad = this.opts.padTo;
    if (pad && out.length > pad) throw Object.assign(new Error(`embedding dims ${out.length} exceed EMBEDDING_PAD_TO ${pad}`), { code: "upstream_error" });
    if (pad) while (out.length < pad) out.push(0);
    this.dims = out.length; return out;
  }
}
export function createEmbeddingProviderFromEnv(env: Record<string, string | undefined> = process.env): EmbeddingProvider {
  const key = env.EMBEDDING_API_KEY;
  if (key && env.EMBEDDING_PROVIDER && env.EMBEDDING_PROVIDER !== "fake") return new HostedEmbeddingProvider({ apiKey: key, model: env.EMBEDDING_MODEL, baseUrl: env.EMBEDDING_BASE_URL || undefined, dims: env.EMBEDDING_DIMS ? Number(env.EMBEDDING_DIMS) : undefined, padTo: env.EMBEDDING_PAD_TO ? Number(env.EMBEDDING_PAD_TO) : undefined });
  return new FakeEmbeddingProvider();
}
export function parseVector(v: unknown): number[] | null {
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(Number) : null; } catch { return null; } }
  return null;
}
