// Plan 14 minimal real observability: counters, latency histograms, Prometheus text, structured logs.
export class MetricsRegistry {
  counters = new Map<string, number>(); histograms = new Map<string, number[]>(); gauges = new Map<string, number>();
  inc(name: string, labels: Record<string, string> = {}, by = 1) { const k = key(name, labels); this.counters.set(k, (this.counters.get(k) ?? 0) + by); }
  observe(name: string, value: number, labels: Record<string, string> = {}) { const k = key(name, labels); const a = this.histograms.get(k) ?? []; a.push(value); this.histograms.set(k, a); }
  setGauge(name: string, value: number, labels: Record<string, string> = {}) { this.gauges.set(key(name, labels), value); }
  snapshot() { return { counters: Object.fromEntries(this.counters), gauges: Object.fromEntries(this.gauges), histograms: Object.fromEntries([...this.histograms].map(([k, v]) => [k, { count: v.length, sum: v.reduce((a, b) => a + b, 0), p95: percentile(v, 95) }])) }; }
  renderPrometheus(): string {
    const lines: string[] = [];
    for (const [k, v] of this.counters) lines.push(`${k} ${v}`);
    for (const [k, v] of this.gauges) lines.push(`${k} ${v}`);
    for (const [k, v] of this.histograms) { const name = k.split("{")[0]; const labels = k.includes("{") ? k.slice(k.indexOf("{")) : "{}"; lines.push(`${name}_count${labels} ${v.length}`, `${name}_sum${labels} ${v.reduce((a, b) => a + b, 0)}`, `${name}_p95${labels} ${percentile(v, 95)}`); }
    return lines.join("\n") + "\n";
  }
}
function key(name: string, labels: Record<string, string>) { const ks = Object.keys(labels).sort(); return ks.length ? `${name}{${ks.map((k) => `${k}="${String(labels[k]).replace(/"/g, "")}"`).join(",")}}` : name; }
export function percentile(values: number[], p: number): number { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0; }
export interface LogFields { level: string; service: string; request_id: string; agent_id?: string | null; domain?: string | null; tool?: string; latency_ms?: number; msg?: string }
export function structuredLog(f: LogFields): string { return JSON.stringify({ ts: new Date().toISOString(), ...f }); }
export const metrics = new MetricsRegistry();
