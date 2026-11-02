import type { TrustInputs } from "@agentmap/db";

/**
 * AgentBureau trust score (plan Phase 4, spec §18): a transparent, explainable
 * score in [0,100] from verified behaviour only. No single report moves it much:
 * outcomes are Bayesian-smoothed, volume is log-scaled, and every component is
 * returned so merchants can see *why*, not just a number.
 */
export function computeTrustScore(i: TrustInputs): { score: number; components: Record<string, number>; inputs: TrustInputs } {
  const outcomeRate = (i.successes + 9) / (Math.max(i.outcomes, 0) + 10); // prior 0.9, as §11.2
  const volume = Math.min(1, Math.log10(1 + i.outcomes + i.live_checks) / 2); // 100 actions ~= full
  const breadth = Math.min(1, i.domains / 5);
  const components = {
    outcome_rate: round(outcomeRate * 60),
    volume: round(volume * 20),
    breadth: round(breadth * 10),
    live_check_engagement: round(Math.min(1, i.live_checks / Math.max(1, i.queries)) * 10),
  };
  const score = Math.max(0, Math.min(100, Object.values(components).reduce((a, b) => a + b, 0)));
  return { score, components, inputs: i };
}
const round = (n: number) => Math.round(n * 10) / 10;
