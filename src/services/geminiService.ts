import type { MarketScenario } from '../data';

export async function fetchLiveMarketGravity(_forceRefresh = false): Promise<MarketScenario> {
  const response = await fetch('/api/live-analysis');
  if (!response.ok) {
    throw new Error(`Live analysis request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<MarketScenario>;
}
