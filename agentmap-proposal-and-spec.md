# AgentMap: Project Proposal and Design Spec

**Status:** Draft v0.1 · **Date:** 2026-11-02 · **Owner:** Willy
**Related:** AgentBureau (agent trust layer). AgentMap is the first product and the data on-ramp for the bureau.

---

## Part A: Proposal

### 1. One-line summary

AgentMap is a shared, pre-built map of how to use websites, served to AI agents over MCP. The first agent to need a site pays the cost of figuring it out; every agent after that gets a short, cheap, fast answer.

### 2. Problem

**For agents and the people who build them**

- Most websites have no MCP server or agent API. Agents have to browse them page by page.
- Browsing is slow, breaks easily, and pulls large amounts of HTML into the agent's context. That costs tokens and crowds out the user's actual task.
- Every agent repeats the same work. A hundred agents looking for brake pads on the same store each crawl it from scratch.

**For merchants**

- Agent traffic loads their servers but rarely looks like a human shopper.
- They see a blur of anonymous bots, with no idea who is behind each one or how it behaves.
- They have no data on what agent shoppers are looking for.

### 3. Solution

A single service, built by us, that:

1. Maps the structure of websites: menus, search, filters, page paths, how to reach a product.
2. Answers agent questions about a site in one call ("how do I find front brake pads for a 2018 Honda Civic on AutoZone?") with a short path or result, not raw pages.
3. Keeps maps fresh by self-healing from agent feedback.
4. Records verified agent behaviour, which later becomes a trust signal for merchants (the AgentBureau).

### 4. Who it's for and why they'd use it

| Side | What they get | Why they care |
| --- | --- | --- |
| Agent builders (first customer) | Fewer tokens, smaller context, faster and more reliable answers | They pay the token bill every month |
| End users | Their agent finishes shopping tasks faster | Indirect benefit |
| Merchants (second customer) | Less repeated bot load, agent demand and journey data, behaviour flags, a verified check behind each agent | Server cost, fraud risk, insight into a new channel |

**Go-to-market order:** win agent builders first, then bring merchants the data. Do not try to launch both sides at once.

### 5. Goals

- G1. Cut tokens per task by a large margin on mapped sites, versus an agent browsing on its own.
- G2. Cut time to answer on repeat visits (second through fifth query to the same site).
- G3. Keep task accuracy at least equal to raw browsing.
- G4. Work with any agent from any lab, through MCP.
- G5. Lay the groundwork for the bureau: agent registration, a verified check, and per-agent behaviour records.

### 6. Non-goals (for now)

- Caching prices or stock as truth. These are always checked live.
- Completing checkout or handling payments.
- Storing any shopper's personal data.
- Holding inventory or acting as a retailer. (That is the separate shopping-middleman idea.)
- Scraping sites that forbid it.

### 7. Business model

- **Subscription for agent builders** as the primary plan, with tiers by monthly query volume.
- **Pay per query** API pricing as the fallback for low-volume or irregular users.
- **Verified agents** get better terms: higher limits or discounts.
- **Later:** merchant analytics and the AgentBureau trust lookups.

Pricing numbers are open (see section 21).

### 8. Competitors and how we differ

| Competitor | What it does | Our difference |
| --- | --- | --- |
| Firecrawl | Turns pages into clean Markdown or JSON; official MCP server; short-lived cache; priced per page | It caches *pages* and serves developers only. We share a *map of how to use a site*, and we serve merchants too. |
| Exa | AI search engine over its own web index | Broad web search, not deep per-store navigation |
| Browserbase | Cloud browsers for agents | Makes browsing possible, doesn't make repeat browsing faster |
| Shopify Catalog | Pre-indexes Shopify stores | Shopify only. Most of our value is sites with no MCP. |
| Rye, Crossmint | Checkout at any store | Merchants can't see who is buying |
| Riskified, Forter, Signifyd | Merchant-side agent detection from behaviour | No operator identity, no portable record across stores |

**Lesson from Honey:** it lost roughly 40% of its Chrome users and thousands of merchant partners after being caught misusing affiliate links and scraping private codes. Give merchants value they can see, and be fully transparent about what data is collected.

---

## Part B: Design spec

### 9. System overview

```
               ┌──────────────────────────────────────────┐
  Agent ──MCP──▶  AgentMap MCP server                       │
               │   ├─ Query service (semantic matching)     │
               │   ├─ Live verifier (price/stock at the end)│
               │   └─ Feedback intake (did the step work?)  │
               │                                            │
               │  Map store (site graphs)  ◀── Indexer      │
               │  Event log (per-agent behaviour)           │
               │  Agent registry (verified check)           │
               └──────────────┬───────────────────────────┘
                              │
                     Merchant dashboard (phase 3)
                     Bureau scoring (phase 4)
```

Optional: a browser extension that maps sites through a real user session (section 15).

### 10. Components

| Component | Responsibility |
| --- | --- |
| **Indexer** | Crawls a site (headless browser), discovers navigation, search, filters and product page patterns, and builds the site graph. Respects robots.txt. |
| **Map store** | Stores one graph per site, versioned. |
| **Query service** | Takes a natural-language question plus a domain, matches it to a path in the graph by meaning, and returns a compact answer. |
| **Live verifier** | Fetches only the final page(s) to confirm price, stock and that the path still works. |
| **Feedback intake** | Receives success or failure reports from agents and triggers re-indexing of broken branches. |
| **Agent registry** | Registers agents and operators, issues API keys, holds verification status. |
| **Event log** | Append-only record of queries and outcomes per agent, with no shopper personal data. |
| **MCP server** | The public interface for agents. |

### 11. Data model

**Site**
- `domain`, `status` (mapped, queued, blocked, opted_out), `map_version`, `last_indexed_at`, `robots_policy`, `demand_score`

**Node** (a page type or state in the site)
- `node_id`, `domain`, `url_pattern`, `kind` (home, search, category, filter, product, cart), `description`, `embedding`, `last_verified_at`, `stale` (bool)

**Edge** (an action that moves between nodes)
- `from_node`, `to_node`, `action` (click, fill, select, navigate), `selector` or `url_template`, `params` (for example a year/make/model fitment filter), `success_rate`

**Path cache**
- `question_embedding`, `domain`, `ordered_edges`, `hits`, `last_success_at`

**Agent**
- `agent_id`, `operator_id`, `declared_model` and version, `public_key` (optional), `erc8004_id` (optional), `verified` (bool), `tier`

**Operator**
- `operator_id`, `type` (person, business), `verification_status`, `created_at`

**Event**
- `event_id`, `agent_id`, `domain`, `type` (query, path_used, step_failed, live_check, outcome), `timestamp`, `latency_ms`, `tokens_saved_estimate`

### 12. MCP tools

| Tool | Input | Output |
| --- | --- | --- |
| `is_mapped` | `domain` | `{ mapped: true/false, map_version, last_indexed_at }` |
| `find` | `domain`, `question` | Short answer: the path to follow, the target URL(s), and which fields need a live check |
| `get_path` | `domain`, `goal` | Ordered step list (navigate, fill, click) with selectors or URL templates |
| `live_check` | `url` | Current price, stock and page status for one page |
| `report_outcome` | `domain`, `path_id`, `success`, `note` | Acknowledgement; failures mark the branch stale |
| `request_mapping` | `domain` | Queue position |
| `my_sites` | add or remove domains | The user's filter list, kept freshest |

**Example: `find`**

Request:
```json
{
  "domain": "autozone.com",
  "question": "front brake pads for a 2018 Honda Civic"
}
```

Response:
```json
{
  "mapped": true,
  "steps": [
    { "action": "navigate", "url": "https://www.autozone.com/brakes-and-traction-control/brake-pads" },
    { "action": "set_vehicle", "params": { "year": 2018, "make": "Honda", "model": "Civic" } },
    { "action": "filter", "params": { "position": "front" } }
  ],
  "result_url_template": "https://www.autozone.com/...",
  "needs_live_check": ["price", "stock"],
  "path_id": "p_8f21"
}
```

The URL and parameters above are illustrative only.

### 13. Core flows

**Mapped site**
1. Agent calls `is_mapped` → true.
2. Agent calls `find` → gets steps.
3. Agent follows steps or opens the result URL, then calls `live_check` for price and stock.
4. Agent calls `report_outcome`.

**Unmapped site**
1. `is_mapped` → false.
2. Agent browses normally.
3. AgentMap queues the site; demand from `request_mapping` and `my_sites` sets priority.

**Broken path**
1. Agent reports `success: false`, or the live verifier sees a failure.
2. The branch is marked stale and removed from answers.
3. The indexer re-maps that branch only.
4. `success_rate` on edges is updated either way.

### 14. Freshness and self-healing

- Sites change quietly; do not rely on maintenance banners.
- Every use of a path is a test. Failures mark the branch stale at once.
- Scheduled light re-checks for high-demand sites.
- Never treat cached prices or stock as current.

### 15. Delivery surfaces

1. **MCP server (primary).** Works with Claude Code, Cursor, Codex and any MCP client.
2. **REST API.** Same functions for agents that don't speak MCP.
3. **Browser extension (optional, later).** Maps sites through a real user session, which helps where data-centre crawlers are blocked. It must strip all personal data and send back structure only. Expect close review by the Chrome Web Store.

### 16. Matching questions to paths

- People phrase the same need differently ("brake pads for a 2018 Civic", "front brakes, Honda Civic"). Use embeddings plus extracted parameters (year, make, model, size, and so on), not exact keys.
- Separate the path (stable, cached) from the parameters (filled per query).

### 17. Privacy, legal and compliance

- **robots.txt is the default rule.** Sites that disallow crawling are not mapped.
- **Merchant opt-out** at any time, and **merchant opt-in** listings that show the agent traffic we sent them.
- **No shopper personal data** is stored: no names, addresses, logins, order history or payment details.
- Map structure only. Do not copy product descriptions or images wholesale.
- Publish a plain-language data policy.
- Get legal review before indexing large retailers.

### 18. Security and trust (bureau groundwork)

- **API keys per agent**, tied to an operator.
- **Optional signed requests**, compatible with UCP-style HTTP Message Signatures, and an optional ERC-8004 ID.
- **Verified check:** free or cheap, requires an operator identity check, and is removed for bad behaviour. It must mean "a real, accountable operator," not "paid us."
- **Model swaps** must be re-declared; undeclared swaps that cause problems count against the operator.
- **Rate limits** by tier, and anomaly flags (hammering pages, probing checkout, abusing promo codes).
- Because we build the maps ourselves, outside users cannot poison them.

### 19. Merchant side (phase 3)

- Dashboard showing agent demand (what agents asked for, including what they couldn't find), journeys (where agents got stuck), bot load saved, and behaviour flags by agent.
- Collect what agents do, never who the shopper is.

### 20. Benchmark plan (needed before launch)

- **Sites:** 3–5 sites without MCP, across categories (for example auto parts, home improvement, skincare).
- **Tasks:** about 20 realistic tasks per site.
- **Baseline:** the same agent browsing on its own.
- **Measure:** time to answer, tokens used, context size, and accuracy (did it find the right item).
- **Repeat:** first through fifth run per task, to show the warm-map curve.
- **Output:** one chart that sells the product.

### 21. Roadmap

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| 0. Prototype | Indexer for 3–5 sites, `is_mapped`, `find`, `report_outcome` over MCP | Benchmark shows clear token and time savings |
| 1. Beta | Self-healing, `live_check`, `my_sites`, API keys, usage billing | 20+ agent builders using it weekly |
| 2. Verified agents | Operator registration, verified check, tiered limits | First verified operators, per-agent event history |
| 3. Merchant side | Opt-in listings, merchant dashboard | First merchants using the data |
| 4. AgentBureau | Trust score from verified behaviour; lookups for merchants and routers | Paid lookups |

### 22. Risks

| Risk | Mitigation |
| --- | --- |
| Big platforms (Google, OpenAI, Shopify) build this in | Stay lab-neutral and focus on sites without MCP |
| Firecrawl or Exa add maps or merchant analytics | Move fast on the merchant side; it is the hard part to copy |
| Site redesigns break maps | Self-healing from every use |
| Legal pushback from retailers | robots.txt default, opt-out, merchant value, legal review |
| Crawlers blocked by bot protection | Optional extension mapping through real sessions; merchant opt-in |
| Cold start: few sites mapped | Map from user demand (`my_sites`), start with a few categories |
| Weak willingness to pay | Prove savings with the benchmark; sell to builders who see the token bill |

### 23. Open questions

1. Pricing: subscription tiers and per-query price.
2. Which 3–5 sites and categories for the prototype?
3. How exactly is an operator verified, and by whom (in-house or a KYC partner)?
4. How much of the event log, if any, is shared with merchants, and on what terms?
5. Does AgentMap become a UCP extension, or stay protocol-neutral alongside it?
6. Is the browser extension worth its privacy and review cost?
