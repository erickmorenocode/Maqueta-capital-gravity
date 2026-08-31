import { NextResponse } from 'next/server';
import type { MarketScenario } from '@/src/data';
import { computeLiveSnapshot, generateAIDescription } from '@/src/lib/liveSnapshot';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const snap = await computeLiveSnapshot();

    const aiDescription = await generateAIDescription(
      snap.regime, snap.vix, snap.us10y, snap.gravityCenters, snap.metrics,
      snap.newsHeadlines, snap.assetPressures, snap.rotationSignal,
      snap.countrySectorData, snap.newsFlowSignal, snap.newsFlowFirings,
    );

    const scenario: MarketScenario = {
      id:                'live',
      name:              'Realidad del Mercado en Vivo',
      description:       aiDescription,
      macroRegime:       snap.regime,
      regimeWeights:     snap.weights,
      gravityCenters:    snap.gravityCenters,
      flows:             snap.flows,
      metrics:           snap.metrics,
      sectorData:        { nodes: snap.usSectorNodes, flows: snap.usSectorFlows },
      countrySectorData: snap.countrySectorData,
      lastUpdated:       Date.now(),
      rotationSignal:    snap.rotationSignal,
      newsFlowSignal:    snap.newsFlowSignal,
      newsContext: {
        headlines:      snap.newsHeadlines,
        sentimentScore: snap.newsSentimentScore,
        newsSentiment:  snap.newsSentiment,
        regimeSignal:   snap.priceRegime !== snap.regime
          ? `Noticias ajustaron regimen: ${snap.priceRegime} -> ${snap.regime}`
          : `Regimen confirmado por precios y noticias: ${snap.regime}`,
      },
    };

    return NextResponse.json(scenario);
  } catch (error) {
    console.error('Live analysis error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Failed to fetch live analysis', detail: message }, { status: 500 });
  }
}



