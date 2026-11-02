# AgentMap data policy (plain language)

Draft for publication before prod indexing (plan §15.2). This page must be live and linked from the MCP server root before production crawling.

## What we crawl

Public website structure only: navigation, search, filters, page paths, and how to reach a product. We identify ourselves with the `AgentMapBot` user-agent and a contact URL. We honour `robots.txt`; sites that disallow crawling are not mapped. Merchants can opt out at any time — opt-out stops crawling immediately and retires the map from answers within 24 hours.

## What we never store

No shopper personal data: no names, addresses, logins, order history, or payment details. No product descriptions or images copied wholesale. Prices and stock are never cached as truth — they are checked live on each request.

## What we record about agents

Per-agent behaviour needed to run and improve the service: queries made (question text is hashed, not stored), paths used, success/failure outcomes, and latency. This record later powers merchant demand/journey views (aggregated, never raw shopper data) and the AgentBureau trust layer.

## Coupons and offers

If offers are ever shown, they come only from public merchant pages or merchants/affiliate networks that explicitly provide them, are labelled with their commercial relationship, and stop immediately for any merchant that opts out. We never use private, leaked, or single-use codes, and never rewrite links silently.

## Contact

Merchant opt-out and data questions: via the contact address published with the `AgentMapBot` user-agent string.
