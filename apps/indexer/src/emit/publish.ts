import type { DbClient } from "@agentmap/db";
import { publishMapVersion } from "@agentmap/db";
import type { BuiltGraph } from "./graph-builder.js";
import type { GraphStorePort } from "../crawl/frontier.js";
import type { ParsedRobots } from "../crawl/robots.js";

function vectorLiteral(v?: number[]): string | null {
  return v && v.length ? `[${v.join(",")}]` : null;
}

/** Postgres GraphStore: insert v+1 nodes/edges in one tx, then atomic publish flip (plan 6.5/7.5). */
export class PgGraphStore implements GraphStorePort {
  constructor(private db: DbClient) {}
  async currentVersion(domain: string): Promise<number> {
    const r = await this.db.query(`SELECT map_version FROM site WHERE domain=$1`, [domain]);
    return (r.rows[0]?.map_version as number) ?? 0;
  }
  async markStatus(domain: string, status: string, robots?: ParsedRobots | null): Promise<void> {
    await this.db.query(
      `INSERT INTO site(domain,status,robots_policy) VALUES($1,$2,$3) ON CONFLICT(domain) DO UPDATE SET status=EXCLUDED.status, robots_policy=COALESCE(EXCLUDED.robots_policy, site.robots_policy), updated_at=now()`,
      [domain, status, robots ? JSON.stringify({ raw: robots.raw, fetched_at: robots.fetchedAt, sitemaps: robots.sitemaps }) : null],
    );
  }
  async publish(graph: BuiltGraph, robots: ParsedRobots | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO site(domain,status,map_version,robots_policy) VALUES($1,'indexing',0,$2) ON CONFLICT(domain) DO UPDATE SET robots_policy=COALESCE(EXCLUDED.robots_policy, site.robots_policy), updated_at=now()`,
        [graph.domain, robots ? JSON.stringify({ raw: robots.raw, fetched_at: robots.fetchedAt }) : null],
      );
      for (const n of graph.nodes) {
        await tx.query(
          `INSERT INTO node(id,domain,map_version,url_pattern,kind,description,embedding,embedding_model) VALUES($1,$2,$3,$4,$5,$6,$7::vector,$8)`,
          [n.id, n.domain, n.map_version, n.url_pattern, n.kind, n.description, vectorLiteral(n.embedding), n.embedding_model ?? "none"],
        );
      }
      for (const e of graph.edges) {
        await tx.query(
          `INSERT INTO edge(id,domain,map_version,from_node_id,to_node_id,action,selector,selector_fallbacks,url_template,params_schema) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [e.id, e.domain, e.map_version, e.from_node_id, e.to_node_id, e.action, e.selector, e.selector_fallbacks, e.url_template, JSON.stringify(e.params_schema)],
        );
      }
    });
    // Atomic flip in its own transaction (marks old path_cache stale)
    await publishMapVersion(this.db, graph.domain, graph.map_version);
  }
}

/** In-memory store for tests / fixture integration. publish() is the atomic flip. */
export class InMemoryGraphStore implements GraphStorePort {
  sites = new Map<string, { version: number; status: string; graph: BuiltGraph | null; robots: ParsedRobots | null }>();
  async currentVersion(domain: string) { return this.sites.get(domain)?.version ?? 0; }
  async markStatus(domain: string, status: string, robots?: ParsedRobots | null) {
    const cur = this.sites.get(domain) ?? { version: 0, status: "queued", graph: null, robots: null };
    cur.status = status; if (robots !== undefined) cur.robots = robots; this.sites.set(domain, cur);
  }
  async publish(graph: BuiltGraph, robots: ParsedRobots | null) {
    this.sites.set(graph.domain, { version: graph.map_version, status: "mapped", graph, robots });
  }
  graphFor(domain: string) { return this.sites.get(domain)?.graph ?? null; }
}
