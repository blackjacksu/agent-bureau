# Highlight — coupon mining: agents that help map a site, earn from its coupons

**Status: design highlight, not live.** The seam is built (contracts, DB, flag-gated `find_offers` — see §"What's already in the code"), the worker and incentive ledger are not. This document is the pitch and the guardrails, kept separate from [QA.md](./QA.md) so it can be lifted into its own deck.

## The idea in one paragraph

Today the map is built by *our* crawler. The network version: an agent that successfully navigates a site while shopping — a good path found, a filter combination that works, a coupon that actually applies — reports it back, and earns credit when other agents reuse that contribution. Coupons are the sharpest instance: a dedicated thread continuously hunts *public or merchant-provided* offers on mapped sites, verifies them against live pages, and serves them through one extra agent query (`find_offers`, alongside `find`). Agents that surface valid coupons — like miners surfacing valid blocks — are rewarded in credits. Shopping agents get a Honey-like saving, without Honey's trust failures, because the agent *asks*; nothing is silently injected, swapped, or applied.

## Why coupons, specifically

- **It is the incentive that aligns everyone.** Agents contribute maps/coupons because contribution pays. Merchants provide offers because verified agent traffic converts. Shoppers (via their agents) save money. The map gets fresher as a side effect of the coupon hunt re-visiting pages.
- **It fits the architecture we already have.** `find` answers "how do I get there", `live_check` answers "is the price real *now*", `find_offers` answers "is there a public offer that applies". Same registry, same event log, same trust score.
- **It is a moat a better browser does not dissolve.** If raw browsing becomes free, navigation savings shrink — but a verified, merchant-sanctioned offer network with contribution incentives is a *relationship* asset, not a crawling trick (see [QA.md](./QA.md), "will we be replaced?").

## How the mining loop would work

```
 ┌─────────────────┐   public/merchant offer pages    ┌──────────────────┐
 │ Coupon hunter   │ ───────────────────────────────▶ │ Verify (verifier │
 │ worker thread   │   merchant feeds, affiliate      │ re-checks code + │
 │ (scheduled,     │   networks, on-site promo pages  │ terms live)      │
 │  per-domain)    │                                  └────────┬─────────┘
 └─────────────────┘                                           │ valid only
        ▲                                                      ▼
        │ contribution                          ┌────────────────────────┐
        │ (path found, coupon                     │ Offer store (provenance│
        │  confirmed working)                     │ + expiry + source_kind)│
 ┌──────┴───────────┐    find_offers    ┌─────────┴───────────┐
 │ Shopping agent   │ ────────────────▶ │ MCP: find /         │
 │ (any registered  │ ◀──────────────── │ find_offers /       │
 │  agent)          │   offers_served   │ live_check          │
 └──────────────────┘   event logged    └─────────────────────┘
        │
        ▼  reuse of a contributed coupon/path by other agents
 ┌──────────────────┐
 │ Incentive ledger │  credits to the contributing agent's operator;
 │ (credits, audit) │  trust score up; abuse → trust down / revoke
 └──────────────────┘
```

1. **Hunt.** A per-domain worker thread sweeps merchant public promo pages, merchant-provided feeds, and affiliate-network listings on a schedule (the same worker shape as the indexer — this is also the natural Modal workload later).
2. **Verify before storing.** Every candidate is re-checked live by the verifier: code applies, terms match, not expired, not single-use. Unverifiable → dropped, never served "probably".
3. **Serve on query only.** A shopping agent asks `find_offers(domain, product)` during a task. Offers come back with provenance (`source_kind`, expiry, terms) and any commercial relationship disclosed in the response. Nothing is auto-applied; the agent (and its human) decide.
4. **Reward contribution ("mining").** When a *different* agent successfully uses a contributed coupon or path (`report_outcome` + `offers_served` events), the contributor earns credits against their query quota/API bill. Rewards pay on **verified reuse by others**, never on submission volume — that single rule is what stops coupon spam.
5. **Trust gates everything.** Contribution weight and reward rate scale with the Bureau trust score. Sybil agents farming fake coupons earn nothing without independent successful reuse, and bad contributions cost trust.

## Red lines (non-negotiable, already encoded in the plan)

| Rule | Why |
| --- | --- |
| Public or merchant-provided offers only | No leaked, private, or single-use codes — ever |
| Merchant opt-out is checked *first* | An opted-out domain serves zero offers, no exceptions |
| No silent affiliate rewriting | If a link earns commission, the response says so |
| No checkout, cart, or auto-apply | The agent asks; the human's agent decides |
| Price/stock still `live_check`ed | A coupon never makes a stale price look fresh |
| Rewards on verified reuse only | Kills spam/Sybil farming at the incentive root |

## What's already in the code vs what's missing

| Piece | State |
| --- | --- |
| `Offer` / `FindOffers*` contracts (`packages/contracts/src/offers.ts`) | Built — `source_kind`: `merchant_direct`, `affiliate_network`, `merchant_public_page`, `merchant_dashboard` |
| `find_offers` tool, flag-gated by `OFFERS_ENABLED` | Built, dark by default; absent from `tools/list` when off |
| Offer store + provenance (`packages/db/src/offers-db.ts`), `offers_served` event | Built |
| Hunter worker thread (scheduled public-offer sweep) | **Missing** — next build after the data-plane fix |
| Incentive ledger + credit payout on verified reuse | **Missing** — needs Q1 (pricing/credits) owner decision, currently deferred |
| Merchant offer dashboard / opt-in feed | **Missing** — needs Q4 (merchant terms) owner decision, currently deferred |

Honest sequencing: the retrieval fix and hosted embeddings come first ([NEXT-STEP-BRIEF](../../doc/NEXT-STEP-BRIEF.md)); coupon mining is the first *network* feature after them, and it cannot fully launch until the owner undeferrs Q1/Q4. The demo may show the flag-gated tool existing — it may not show live coupon earnings.

## The 20-second demo version (if asked)

> "One more thing the map carries: coupons. A background thread keeps hunting public and merchant-provided offers on mapped sites, verifies each one live, and any agent can ask for them mid-shop. And agents that help us map a site — or surface a coupon that actually works — earn credits when other agents reuse it. Think mining, except the work is useful: mapping the web for agents, and being paid in proportion to how much the network reuses what you found."
