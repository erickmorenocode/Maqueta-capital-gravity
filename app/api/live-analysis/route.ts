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

// ─── Asset symbols ───────────────────────────────────────────────────────────
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

interface AssetBase { liquidez: number; friccion: number; correlacion: number; spreadBase: number; }
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

// ─── Sector ETF symbols ───────────────────────────────────────────────────────
const SECTOR_SYMBOLS: Record<string, string> = {
  technology:         'XLK',
  communication:      'XLC',
  cons_discretionary: 'XLY',
  cons_staples:       'XLP',
  energy:             'XLE',
  financial:          'XLF',
  healthcare:         'XLV',
  industrials:        'XLI',
  real_estate:        'XLRE',
  basic_materials:    'XLB',
  utilities:          'XLU',
};

interface SectorBase { liquidezBase: number; spreadBase: number; correlacion: number; }
const SECTOR_BASE: Record<string, SectorBase> = {
  technology:         { liquidezBase: 88, spreadBase: 18, correlacion: 0.92 },
  communication:      { liquidezBase: 80, spreadBase: 22, correlacion: 0.85 },
  cons_discretionary: { liquidezBase: 78, spreadBase: 24, correlacion: 0.88 },
  cons_staples:       { liquidezBase: 82, spreadBase: 12, correlacion: 0.55 },
  energy:             { liquidezBase: 76, spreadBase: 30, correlacion: 0.65 },
  financial:          { liquidezBase: 85, spreadBase: 20, correlacion: 0.80 },
  healthcare:         { liquidezBase: 80, spreadBase: 15, correlacion: 0.60 },
  industrials:        { liquidezBase: 78, spreadBase: 22, correlacion: 0.78 },
  real_estate:        { liquidezBase: 72, spreadBase: 28, correlacion: 0.70 },
  basic_materials:    { liquidezBase: 74, spreadBase: 26, correlacion: 0.72 },
  utilities:          { liquidezBase: 70, spreadBase: 14, correlacion: 0.45 },
};

// ─── Regime weights ───────────────────────────────────────────────────────────
const REGIME_WEIGHTS: Record<string, { w1: number; w2: number; w3: number; w4: number }> = {
  'risk-on':  { w1: 0.40, w2: 0.35, w3: 0.15, w4: 0.10 },
  'risk-off': { w1: 0.15, w2: 0.10, w3: 0.35, w4: 0.40 },
  'crisis':   { w1: 0.05, w2: 0.05, w3: 0.45, w4: 0.45 },
  'neutral':  { w1: 0.25, w2: 0.25, w3: 0.25, w4: 0.25 },
};

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

// ─── Asset metrics ────────────────────────────────────────────────────────────
interface RawAssetMetrics extends GravityMetrics { distanciaRaw: number; changePercent: number; }

function computeAssetMetrics(
  assetId: string,
  quote: YFQuote,
  vix: number,
  regime: string,
  weights: { w1: number; w2: number; w3: number; w4: number },
): RawAssetMetrics {
  const base       = ASSET_BASE[assetId];
  const price      = quote.regularMarketPrice ?? 100;
  const low52      = quote.fiftyTwoWeekLow    ?? price * 0.80;
  const high52     = quote.fiftyTwoWeekHigh   ?? price * 1.20;
  const avg50      = quote.fiftyDayAverage    ?? price;
  const changePct  = quote.regularMarketChangePercent ?? 0;

  const rangeW    = high52 - low52;
  const retorno   = Math.round(rangeW > 0 ? clamp(((price - low52) / rangeW) * 100, 0, 100) : 50);
  const momentum  = avg50 > 0 ? ((price / avg50) - 1) * 200 : 0;
  const crecimiento = Math.round(clamp(50 + momentum, 0, 100));
  const liqPenalty  = regime === 'crisis' ? 10 : regime === 'risk-off' ? 5 : 0;
  const liquidezActivo = Math.round(clamp(base.liquidez - liqPenalty, 0, 100));
  const trendSign  = price >= avg50 ? 1 : -1;
  const vixPenalty = clamp((vix - 15) * 2, 0, 50);
  const confianza  = Math.round(clamp(65 + trendSign * 15 - vixPenalty, 0, 100));
  const masa       = Math.round(weights.w1 * retorno + weights.w2 * crecimiento + weights.w3 * liquidezActivo + weights.w4 * confianza);

  const midPrice    = (high52 + low52) / 2;
  const annualRange = midPrice > 0 ? ((high52 - low52) / midPrice) * 100 : 20;
  const volatilidad = Math.round(clamp(annualRange * (vix / 20) * 0.5, 0, 100));
  const spreadMult  = regime === 'crisis' ? 2.5 : regime === 'risk-off' ? 1.5 : regime === 'risk-on' ? 0.7 : 1.0;
  const spread      = Math.round(clamp(base.spreadBase * spreadMult, 0, 100));
  const correlacion = base.correlacion;
  const distanciaRaw = volatilidad + spread + (1 - correlacion) * 100;

  const fricMult    = regime === 'crisis' ? 1.5 : regime === 'risk-off' ? 1.2 : 1.0;
  const friccion    = Math.round(clamp(base.friccion * fricMult, 1, 30));

  return {
    masa,
    distancia:   Math.round(distanciaRaw),
    friccion,
    masaComponents:      { retorno, crecimiento, liquidezActivo, confianza },
    masaWeights:         weights,
    distanciaComponents: { volatilidad, spread, correlacion },
    friccionComponents:  {
      bidAskSpread:  Math.round(clamp(base.friccion * 0.40 * fricMult, 1, 30)),
      restricciones: Math.round(clamp(base.friccion * 0.35 * fricMult, 1, 30)),
      profundidad:   Math.round(clamp(base.liquidez * 0.90, 0, 100)),
    },
    fuerzaG:             0,
    zscoreFlows:         parseFloat((changePct / 2).toFixed(2)),
    masaJustificacion:   `Ret=${retorno}(52s) Crec=${crecimiento}(50d) Liq=${liquidezActivo} Conf=${confianza}`,
    distanciaJustificacion: `Vol52s=${annualRange.toFixed(1)}%×VIX=${vix.toFixed(1)} → vol=${volatilidad}, spr=${spread}`,
    friccionJustificacion:  `F_base=${base.friccion}×${fricMult}=${friccion}`,
    distanciaRaw,
    changePercent: changePct,
  };
}

// ─── Sector metrics ───────────────────────────────────────────────────────────
interface RawSectorMetric { masa: number; distanciaRaw: number; }

function computeSectorMetric(
  sectorId: string,
  quote: YFQuote,
  vix: number,
  regime: string,
  weights: { w1: number; w2: number; w3: number; w4: number },
): RawSectorMetric {
  const base       = SECTOR_BASE[sectorId];
  const price      = quote.regularMarketPrice ?? 100;
  const low52      = quote.fiftyTwoWeekLow    ?? price * 0.80;
  const high52     = quote.fiftyTwoWeekHigh   ?? price * 1.20;
  const avg50      = quote.fiftyDayAverage    ?? price;

  const rangeW     = high52 - low52;
  const retorno    = Math.round(rangeW > 0 ? clamp(((price - low52) / rangeW) * 100, 0, 100) : 50);
  const momentum   = avg50 > 0 ? ((price / avg50) - 1) * 200 : 0;
  const crecimiento = Math.round(clamp(50 + momentum, 0, 100));
  const liqPenalty  = regime === 'crisis' ? 10 : regime === 'risk-off' ? 5 : 0;
  const liquidezActivo = Math.round(clamp(base.liquidezBase - liqPenalty, 0, 100));
  const trendSign  = price >= avg50 ? 1 : -1;
  const vixPenalty = clamp((vix - 15) * 2, 0, 50);
  const confianza  = Math.round(clamp(65 + trendSign * 15 - vixPenalty, 0, 100));
  const masa       = Math.round(weights.w1 * retorno + weights.w2 * crecimiento + weights.w3 * liquidezActivo + weights.w4 * confianza);

  const midPrice    = (high52 + low52) / 2;
  const annualRange = midPrice > 0 ? ((high52 - low52) / midPrice) * 100 : 20;
  const volatilidad = Math.round(clamp(annualRange * (vix / 20) * 0.5, 0, 100));
  const spreadMult  = regime === 'crisis' ? 2.5 : regime === 'risk-off' ? 1.5 : regime === 'risk-on' ? 0.7 : 1.0;
  const spread      = Math.round(clamp(base.spreadBase * spreadMult, 0, 100));
  const correlacion = base.correlacion;
  const distanciaRaw = volatilidad + spread + (1 - correlacion) * 100;

  return { masa, distanciaRaw };
}

// ─── Asset flows ──────────────────────────────────────────────────────────────
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
      const flowTheoretical = (mF.masa * mT.masa) / Math.pow(Math.max(1, mT.distancia), 2) / Math.max(1, mT.friccion);
      if (flowTheoretical < 5) continue;
      const zscore    = clamp(mF.zscoreFlows ?? 0, -0.8, 2.0);
      const flowFinal = flowTheoretical * (1 + zscore);
      rawFlows.push({ from, to, flowTheoretical, flowFinal, zscoreAdjustment: parseFloat((mF.zscoreFlows ?? 0).toFixed(2)) });
    }
  }

  rawFlows.sort((a, b) => b.flowFinal - a.flowFinal);
  const top = rawFlows.slice(0, 10);
  if (top.length === 0) return [];

  const maxFlow = top[0].flowFinal;
  return top.map(({ from, to, flowTheoretical, flowFinal, zscoreAdjustment }) => ({
    from, to,
    strength:        parseFloat((flowFinal / maxFlow).toFixed(3)),
    flowTheoretical: parseFloat(flowTheoretical.toFixed(3)),
    flowFinal:       parseFloat(flowFinal.toFixed(3)),
    zscoreAdjustment,
    label: `Flujo ${from} → ${to} (FG: ${(metrics[to].fuerzaG ?? 0).toFixed(1)})`,
  }));
}

// ─── Sector flows ─────────────────────────────────────────────────────────────
function computeSectorFlows(
  nodes: Array<{ id: string; masa: number; distancia: number }>,
): Array<{ from: string; to: string; strength: number }> {
  const pairs: Array<{ from: string; to: string; score: number }> = [];

  for (const f of nodes) {
    for (const t of nodes) {
      if (f.id === t.id) continue;
      const score = (f.masa * t.masa) / Math.pow(Math.max(1, t.distancia), 2);
      if (score < 1) continue;
      pairs.push({ from: f.id, to: t.id, score });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  const top = pairs.slice(0, 6);
  if (top.length === 0) return [];
  const maxScore = top[0].score;
  return top.map(({ from, to, score }) => ({
    from, to,
    strength: parseFloat((score / maxScore).toFixed(3)),
  }));
}

// ─── Human-readable description ───────────────────────────────────────────────
function buildDescription(
  regime: string,
  vix: number,
  us10y: number,
  gravityCenters: string[],
  metrics: Record<string, GravityMetrics>,
): string {
  const regimeLabel: Record<string, string> = {
    'risk-on':  'EXPANSIÓN — apetito de riesgo alto',
    'risk-off': 'DEFENSIVO — inversores buscan seguridad',
    'crisis':   'CRISIS — capital huye hacia refugios',
    'neutral':  'NEUTRAL — señales mixtas sin tendencia clara',
  };

  const losers = Object.entries(metrics)
    .sort((a, b) => (a[1].fuerzaG ?? 0) - (b[1].fuerzaG ?? 0))
    .slice(0, 2)
    .map(([id]) => id);

  const topText    = gravityCenters.slice(0, 3).join(', ') || 'ninguno destacado';
  const losersText = losers.join(' y ');

  return (
    `Mercados en modo ${regimeLabel[regime] ?? regime.toUpperCase()}. ` +
    `Capital gravitando hacia: ${topText}. ` +
    `Salida de flujos desde: ${losersText}. ` +
    `VIX ${vix.toFixed(1)} · US10Y ${us10y.toFixed(2)}%.`
  );
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const assetSyms  = Object.values(ASSET_SYMBOLS);
    const sectorSyms = Object.values(SECTOR_SYMBOLS);
    const macroSyms  = ['^VIX', '^TNX'];
    const allSymbols = [...assetSyms, ...sectorSyms, ...macroSyms];

    const quotes = await Promise.all(
      allSymbols.map(sym => (yf.quote(sym) as Promise<YFQuote>).catch(() => null)),
    );

    const quoteMap: Record<string, YFQuote> = {};
    allSymbols.forEach((sym, i) => { if (quotes[i]) quoteMap[sym] = quotes[i]!; });

    const vix   = quoteMap['^VIX']?.regularMarketPrice ?? 20;
    const us10y = quoteMap['^TNX']?.regularMarketPrice ?? 4.3;

    const regime: 'risk-on' | 'risk-off' | 'crisis' | 'neutral' =
      vix > 28 ? 'crisis' :
      vix < 18 ? 'risk-on' :
      vix <= 28 ? 'risk-off' :
      'neutral';

    const weights = REGIME_WEIGHTS[regime];

    // ── Asset metrics ──────────────────────────────────────────────────────────
    const rawAssets: Record<string, RawAssetMetrics> = {};
    for (const [id, sym] of Object.entries(ASSET_SYMBOLS)) {
      rawAssets[id] = computeAssetMetrics(id, quoteMap[sym] ?? {}, vix, regime, weights);
    }

    const assetDistRaw = Object.values(rawAssets).map(m => m.distanciaRaw);
    const minAD = Math.min(...assetDistRaw);
    const maxAD = Math.max(...assetDistRaw);
    const rangeAD = maxAD - minAD || 1;

    const metrics: Record<string, GravityMetrics> = {};
    for (const [id, raw] of Object.entries(rawAssets)) {
      const distancia = Math.round(((raw.distanciaRaw - minAD) / rangeAD) * 80 + 10);
      const fuerzaG   = parseFloat(((raw.masa - distancia) / Math.max(1, raw.friccion)).toFixed(2));
      const { distanciaRaw: _dr, changePercent: _cp, ...rest } = raw;
      metrics[id] = { ...rest, distancia, fuerzaG };
    }

    const gravityCenters = Object.entries(metrics)
      .filter(([, m]) => (m.fuerzaG ?? 0) > 8)
      .map(([id]) => id);

    const flows = computeFlows(metrics);

    // ── Sector metrics ─────────────────────────────────────────────────────────
    const rawSectors: Record<string, RawSectorMetric> = {};
    for (const [sectorId, sym] of Object.entries(SECTOR_SYMBOLS)) {
      rawSectors[sectorId] = computeSectorMetric(sectorId, quoteMap[sym] ?? {}, vix, regime, weights);
    }

    const sectorDistRaw = Object.values(rawSectors).map(m => m.distanciaRaw);
    const minSD = Math.min(...sectorDistRaw);
    const maxSD = Math.max(...sectorDistRaw);
    const rangeSD = maxSD - minSD || 1;

    const sectorNodes = Object.entries(rawSectors).map(([id, raw]) => {
      const distancia = Math.round(((raw.distanciaRaw - minSD) / rangeSD) * 80 + 10);
      const isGravityCenter = (raw.masa - distancia) / 10 > 3.0;
      return { id, masa: raw.masa, distancia, isGravityCenter };
    });

    const sectorFlows = computeSectorFlows(sectorNodes);

    // ── Assemble scenario ──────────────────────────────────────────────────────
    const scenario: MarketScenario = {
      id:            'live',
      name:          'Realidad del Mercado en Vivo',
      description:   buildDescription(regime, vix, us10y, gravityCenters, metrics),
      macroRegime:   regime,
      regimeWeights: weights,
      gravityCenters,
      flows,
      metrics,
      sectorData:    { nodes: sectorNodes, flows: sectorFlows },
      lastUpdated:   Date.now(),
    };

    return NextResponse.json(scenario);
  } catch (error) {
    console.error('Live analysis error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Failed to fetch live analysis', detail: message }, { status: 500 });
  }
}
