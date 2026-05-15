import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import type { MarketScenario, GravityMetrics, CapitalFlow } from '@/src/data';

export const dynamic = 'force-dynamic';

interface YFQuote {
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
}

const yf = new YahooFinance();

const ASSET_SYMBOLS: Record<string, string> = {
  USD:                'DX-Y.NYB',
  Europe:             'EZU',
  'Emerging Markets': 'EEM',
  Gold:               'GC=F',
  Tech:               'QQQ',
  Bonds:              'TLT',
  Crypto:             'BTC-USD',
  Oil:                'CL=F',
};

interface AssetBase {
  liquidez: number;
  friccion: number;
  correlacion: number;
  spreadBase: number;
}

const ASSET_BASE: Record<string, AssetBase> = {
  USD:                { liquidez: 98, friccion: 5,  correlacion: 0.30, spreadBase: 5  },
  Europe:             { liquidez: 75, friccion: 12, correlacion: 0.80, spreadBase: 25 },
  'Emerging Markets': { liquidez: 65, friccion: 20, correlacion: 0.75, spreadBase: 45 },
  Gold:               { liquidez: 85, friccion: 8,  correlacion: 0.50, spreadBase: 10 },
  Tech:               { liquidez: 88, friccion: 6,  correlacion: 0.90, spreadBase: 15 },
  Bonds:              { liquidez: 90, friccion: 7,  correlacion: 0.40, spreadBase: 12 },
  Crypto:             { liquidez: 70, friccion: 15, correlacion: 0.55, spreadBase: 30 },
  Oil:                { liquidez: 80, friccion: 10, correlacion: 0.60, spreadBase: 20 },
};

const REGIME_WEIGHTS: Record<string, { w1: number; w2: number; w3: number; w4: number }> = {
  'risk-on':  { w1: 0.40, w2: 0.35, w3: 0.15, w4: 0.10 },
  'risk-off': { w1: 0.15, w2: 0.10, w3: 0.35, w4: 0.40 },
  'crisis':   { w1: 0.05, w2: 0.05, w3: 0.45, w4: 0.45 },
  'neutral':  { w1: 0.25, w2: 0.25, w3: 0.25, w4: 0.25 },
};

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

interface RawMetrics extends GravityMetrics {
  distanciaRaw: number;
  changePercent: number;
}

function computeAssetMetrics(
  assetId: string,
  quote: YFQuote,
  vix: number,
  regime: string,
  weights: { w1: number; w2: number; w3: number; w4: number },
): RawMetrics {
  const base = ASSET_BASE[assetId];
  const price    = quote.regularMarketPrice ?? 100;
  const low52    = quote.fiftyTwoWeekLow    ?? price * 0.80;
  const high52   = quote.fiftyTwoWeekHigh   ?? price * 1.20;
  const avg50    = quote.fiftyDayAverage    ?? price;
  const changePct = quote.regularMarketChangePercent ?? 0;

  // Retorno: position within 52-week range (0-100)
  const rangeWidth = high52 - low52;
  const retorno = Math.round(rangeWidth > 0 ? clamp(((price - low52) / rangeWidth) * 100, 0, 100) : 50);

  // Crecimiento: momentum vs 50-day average
  const momentum = avg50 > 0 ? ((price / avg50) - 1) * 200 : 0;
  const crecimiento = Math.round(clamp(50 + momentum, 0, 100));

  // LiquidezActivo: base adjusted by regime stress
  const liquidezPenalty = regime === 'crisis' ? 10 : regime === 'risk-off' ? 5 : 0;
  const liquidezActivo = Math.round(clamp(base.liquidez - liquidezPenalty, 0, 100));

  // Confianza: trend direction + VIX penalty
  const trendSign  = price >= avg50 ? 1 : -1;
  const vixPenalty = clamp((vix - 15) * 2, 0, 50);
  const confianza  = Math.round(clamp(65 + trendSign * 15 - vixPenalty, 0, 100));

  const masa = Math.round(
    weights.w1 * retorno +
    weights.w2 * crecimiento +
    weights.w3 * liquidezActivo +
    weights.w4 * confianza,
  );

  // Volatilidad: 52-week range width as annualized vol proxy, scaled by VIX
  const midPrice   = (high52 + low52) / 2;
  const annualRange = midPrice > 0 ? ((high52 - low52) / midPrice) * 100 : 20;
  const volatilidad = Math.round(clamp(annualRange * (vix / 20) * 0.5, 0, 100));

  // Spread: base spread multiplied by regime
  const spreadMult = regime === 'crisis' ? 2.5 : regime === 'risk-off' ? 1.5 : regime === 'risk-on' ? 0.7 : 1.0;
  const spread     = Math.round(clamp(base.spreadBase * spreadMult, 0, 100));

  const correlacion    = base.correlacion;
  const distanciaRaw   = volatilidad + spread + (1 - correlacion) * 100;

  // Friccion: base × regime multiplier, clamped 1-30
  const fricMult = regime === 'crisis' ? 1.5 : regime === 'risk-off' ? 1.2 : 1.0;
  const friccion = Math.round(clamp(base.friccion * fricMult, 1, 30));

  const bidAskSpread  = Math.round(clamp(base.friccion * 0.40 * fricMult, 1, 30));
  const restricciones = Math.round(clamp(base.friccion * 0.35 * fricMult, 1, 30));
  const profundidad   = Math.round(clamp(base.liquidez * 0.90, 0, 100));

  return {
    masa,
    distancia: Math.round(distanciaRaw), // will be overwritten after normalization
    friccion,
    masaComponents:      { retorno, crecimiento, liquidezActivo, confianza },
    masaWeights:         weights,
    distanciaComponents: { volatilidad, spread, correlacion },
    friccionComponents:  { bidAskSpread, restricciones, profundidad },
    fuerzaG:             0, // placeholder
    zscoreFlows:         parseFloat((changePct / 2).toFixed(2)),
    masaJustificacion:   `Ret=${retorno}(52s) Crec=${crecimiento}(50d) Liq=${liquidezActivo} Conf=${confianza}`,
    distanciaJustificacion: `Vol52s=${annualRange.toFixed(1)}%×VIX=${vix.toFixed(1)} → vol=${volatilidad}, spr=${spread}`,
    friccionJustificacion:  `F_base=${base.friccion}×${fricMult}=${friccion}`,
    distanciaRaw,
    changePercent: changePct,
  };
}

function computeFlows(metrics: Record<string, GravityMetrics>): CapitalFlow[] {
  const assets = Object.keys(metrics);
  const rawFlows: Array<{
    from: string; to: string;
    flowTheoretical: number; flowFinal: number; zscoreAdjustment: number;
  }> = [];

  for (const from of assets) {
    for (const to of assets) {
      if (from === to) continue;
      const mF = metrics[from];
      const mT = metrics[to];
      const dSq  = Math.pow(Math.max(1, mT.distancia), 2);
      const fric = Math.max(1, mT.friccion);
      const flowTheoretical = (mF.masa * mT.masa) / dSq / fric;
      if (flowTheoretical < 5) continue;
      const zscore = clamp(mF.zscoreFlows ?? 0, -0.8, 2.0);
      const flowFinal = flowTheoretical * (1 + zscore);
      rawFlows.push({ from, to, flowTheoretical, flowFinal, zscoreAdjustment: parseFloat((mF.zscoreFlows ?? 0).toFixed(2)) });
    }
  }

  rawFlows.sort((a, b) => b.flowFinal - a.flowFinal);
  const top = rawFlows.slice(0, 10);
  if (top.length === 0) return [];

  const maxFlow = top[0].flowFinal;
  return top.map(({ from, to, flowTheoretical, flowFinal, zscoreAdjustment }) => ({
    from,
    to,
    strength:          parseFloat((flowFinal / maxFlow).toFixed(3)),
    flowTheoretical:   parseFloat(flowTheoretical.toFixed(3)),
    flowFinal:         parseFloat(flowFinal.toFixed(3)),
    zscoreAdjustment,
    label: `Flujo ${from} → ${to} (FG: ${(metrics[to].fuerzaG ?? 0).toFixed(1)})`,
  }));
}

export async function GET() {
  try {
    const allSymbols = [...Object.values(ASSET_SYMBOLS), '^VIX', '^TNX'];

    const quotes = await Promise.all(
      allSymbols.map(sym => (yf.quote(sym) as Promise<YFQuote>).catch(() => null)),
    );

    const quoteMap: Record<string, YFQuote> = {};
    allSymbols.forEach((sym, i) => {
      if (quotes[i]) quoteMap[sym] = quotes[i]!;
    });

    const vix   = quoteMap['^VIX']?.regularMarketPrice ?? 20;
    const us10y = quoteMap['^TNX']?.regularMarketPrice ?? 4.3;

    const regime: 'risk-on' | 'risk-off' | 'crisis' | 'neutral' =
      vix > 28 ? 'crisis' :
      vix < 18 ? 'risk-on' :
      vix <= 28 ? 'risk-off' :
      'neutral';

    const weights = REGIME_WEIGHTS[regime];

    // Compute raw metrics for each asset
    const rawMap: Record<string, RawMetrics> = {};
    for (const [assetId, symbol] of Object.entries(ASSET_SYMBOLS)) {
      rawMap[assetId] = computeAssetMetrics(
        assetId,
        quoteMap[symbol] ?? {},
        vix,
        regime,
        weights,
      );
    }

    // Normalize distancia to 10-90 range across all assets
    const rawValues = Object.values(rawMap).map(m => m.distanciaRaw);
    const minD = Math.min(...rawValues);
    const maxD = Math.max(...rawValues);
    const rangeD = maxD - minD || 1;

    const metrics: Record<string, GravityMetrics> = {};
    for (const [assetId, raw] of Object.entries(rawMap)) {
      const distancia = Math.round(((raw.distanciaRaw - minD) / rangeD) * 80 + 10);
      const fuerzaG   = parseFloat(((raw.masa - distancia) / Math.max(1, raw.friccion)).toFixed(2));
      const { distanciaRaw: _dr, changePercent: _cp, ...rest } = raw;
      metrics[assetId] = { ...rest, distancia, fuerzaG };
    }

    const gravityCenters = Object.entries(metrics)
      .filter(([, m]) => (m.fuerzaG ?? 0) > 8)
      .map(([id]) => id);

    const flows = computeFlows(metrics);

    const topAssets = gravityCenters.slice(0, 3).join(', ') || 'ninguno';
    const description =
      `Régimen ${regime.toUpperCase()} detectado (VIX=${vix.toFixed(1)}, US10Y=${us10y.toFixed(2)}%). ` +
      `Capital fluye hacia ${topAssets}. ` +
      `Pesos: Ret w1=${weights.w1}, Crec w2=${weights.w2}, Liq w3=${weights.w3}, Conf w4=${weights.w4}.`;

    const scenario: MarketScenario = {
      id:            'live',
      name:          'Realidad del Mercado en Vivo',
      description,
      macroRegime:   regime,
      regimeWeights: weights,
      gravityCenters,
      flows,
      metrics,
      lastUpdated:   Date.now(),
    };

    return NextResponse.json(scenario);
  } catch (error) {
    console.error('Live analysis error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Failed to fetch live analysis', detail: message }, { status: 500 });
  }
}
