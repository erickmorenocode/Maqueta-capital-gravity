import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import type { MarketScenario, GravityMetrics, CapitalFlow } from '@/src/data';

export const dynamic = 'force-dynamic';

// ─── Extended YFQuote interface ───────────────────────────────────────────────
interface YFQuote {
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
  // MASA variables
  trailingEps?: number;
  forwardEps?: number;
  earningsQuarterlyGrowth?: number;
  returnOnEquity?: number;
  trailingAnnualDividendYield?: number;
  marketCap?: number;
  regularMarketVolume?: number;
  averageDailyVolume3Month?: number;
  // FRICCION variables
  bid?: number;
  ask?: number;
}

const yf = new YahooFinance();

// ─── Asset symbols ────────────────────────────────────────────────────────────
const ASSET_SYMBOLS: Record<string, string> = {
  USD:                'DX-Y.NYB',
  Europe:             'EZU',
  'Emerging Markets': 'EEM',
  Gold:               'GC=F',
  'Norte America':    'QQQ',
  Asia:               'EWJ',
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
  'Norte America':    { liquidez: 88, friccion: 6,  correlacion: 0.90, spreadBase: 15 },
  Asia:               { liquidez: 72, friccion: 14, correlacion: 0.70, spreadBase: 28 },
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

// ─── Country ETF symbols ──────────────────────────────────────────────────────
const COUNTRY_ETF_SYMBOLS: Record<string, string | null> = {
  'EE.UU.':      null,
  'Canadá':      'EWC',
  'Francia':     'EWQ',
  'Alemania':    'EWG',
  'Italia':      'EWI',
  'Japón':       'EWJ',
  'Reino Unido': 'EWU',
  'Rusia':       'ERUS',
};

// ─── Static country tables ────────────────────────────────────────────────────
// S&P/Moody's credit ratings → [0-100]
const COUNTRY_CREDIT_RATINGS: Record<string, number> = {
  'EE.UU.':      85,
  'Canadá':      90,
  'Francia':     78,
  'Alemania':    95,
  'Italia':      65,
  'Japón':       80,
  'Reino Unido': 82,
  'Rusia':       35,
};

// World Bank political stability → [0-100, higher = more stable]
const COUNTRY_POLITICAL_STABILITY: Record<string, number> = {
  'EE.UU.':      70,
  'Canadá':      85,
  'Francia':     68,
  'Alemania':    82,
  'Italia':      60,
  'Japón':       84,
  'Reino Unido': 72,
  'Rusia':       25,
};

// IMF/WB capital controls → [0-30, higher = more restricted]
const COUNTRY_CAPITAL_CONTROLS: Record<string, number> = {
  'EE.UU.':      0,
  'Canadá':      0,
  'Francia':     1,
  'Alemania':    1,
  'Italia':      2,
  'Japón':       3,
  'Reino Unido': 0,
  'Rusia':       22,
};

// Transaction costs [% of trade value]
const COUNTRY_TRANSACTION_COSTS: Record<string, number> = {
  'EE.UU.':      0.05,
  'Canadá':      0.10,
  'Francia':     0.12,
  'Alemania':    0.12,
  'Italia':      0.15,
  'Japón':       0.18,
  'Reino Unido': 0.13,
  'Rusia':       0.40,
};

// CPI annual approx 2024-2025 [%]
const COUNTRY_CPI: Record<string, number> = {
  'EE.UU.':      3.2,
  'Canadá':      2.9,
  'Francia':     2.3,
  'Alemania':    2.5,
  'Italia':      1.8,
  'Japón':       2.8,
  'Reino Unido': 3.5,
  'Rusia':       9.0,
};

// Structural sector dominance per G8 country [0-100]
const G8_SECTOR_PROFILES: Record<string, Record<string, number>> = {
  'EE.UU.': {
    technology: 95, communication: 88, cons_discretionary: 85, cons_staples: 80,
    energy: 78, financial: 90, healthcare: 87, industrials: 82,
    real_estate: 80, basic_materials: 75, utilities: 72,
  },
  'Canadá': {
    technology: 42, communication: 48, cons_discretionary: 45, cons_staples: 60,
    energy: 90, financial: 78, healthcare: 52, industrials: 60,
    real_estate: 72, basic_materials: 85, utilities: 58,
  },
  'Francia': {
    technology: 52, communication: 60, cons_discretionary: 80, cons_staples: 88,
    energy: 50, financial: 72, healthcare: 78, industrials: 82,
    real_estate: 65, basic_materials: 58, utilities: 65,
  },
  'Alemania': {
    technology: 62, communication: 52, cons_discretionary: 85, cons_staples: 65,
    energy: 55, financial: 62, healthcare: 68, industrials: 95,
    real_estate: 45, basic_materials: 80, utilities: 52,
  },
  'Italia': {
    technology: 38, communication: 50, cons_discretionary: 70, cons_staples: 78,
    energy: 52, financial: 65, healthcare: 60, industrials: 78,
    real_estate: 68, basic_materials: 55, utilities: 62,
  },
  'Japón': {
    technology: 82, communication: 65, cons_discretionary: 80, cons_staples: 70,
    energy: 30, financial: 60, healthcare: 72, industrials: 92,
    real_estate: 52, basic_materials: 65, utilities: 48,
  },
  'Reino Unido': {
    technology: 55, communication: 65, cons_discretionary: 62, cons_staples: 80,
    energy: 70, financial: 95, healthcare: 75, industrials: 60,
    real_estate: 70, basic_materials: 52, utilities: 62,
  },
  'Rusia': {
    technology: 30, communication: 42, cons_discretionary: 32, cons_staples: 52,
    energy: 98, financial: 45, healthcare: 38, industrials: 58,
    real_estate: 38, basic_materials: 85, utilities: 68,
  },
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

// ─── Macro context passed to sector functions ─────────────────────────────────
interface MacroContext {
  vix: number;
  us10y: number;
  us2y: number;
  move: number;
  hygStress: number;
  regime: string;
  regimeMult: number;
}

// ─── Asset metrics (unchanged) ────────────────────────────────────────────────
interface RawAssetMetrics extends GravityMetrics { distanciaRaw: number; changePercent: number; }

function computeAssetMetrics(
  assetId: string,
  quote: YFQuote,
  vix: number,
  regime: string,
  weights: { w1: number; w2: number; w3: number; w4: number },
): RawAssetMetrics {
  const base      = ASSET_BASE[assetId];
  const price     = quote.regularMarketPrice ?? 100;
  const low52     = quote.fiftyTwoWeekLow    ?? price * 0.80;
  const high52    = quote.fiftyTwoWeekHigh   ?? price * 1.20;
  const avg50     = quote.fiftyDayAverage    ?? price;
  const changePct = quote.regularMarketChangePercent ?? 0;

  const rangeW         = high52 - low52;
  const retorno        = Math.round(rangeW > 0 ? clamp(((price - low52) / rangeW) * 100, 0, 100) : 50);
  const momentum       = avg50 > 0 ? ((price / avg50) - 1) * 200 : 0;
  const dailyReturn    = Math.round(clamp(50 + changePct * 5, 0, 100));
  const momentum50d    = Math.round(clamp(50 + momentum, 0, 100));
  const crecimiento    = Math.round(clamp(momentum50d * 0.5 + dailyReturn * 0.5, 0, 100));
  const liqPenalty     = regime === 'crisis' ? 10 : regime === 'risk-off' ? 5 : 0;
  const liquidezActivo = Math.round(clamp(base.liquidez - liqPenalty, 0, 100));
  const trendSign      = price >= avg50 ? 1 : -1;
  const vixPenalty     = clamp((vix - 15) * 2, 0, 50);
  const confianza      = Math.round(clamp(60 + trendSign * 10 + changePct * 2 - vixPenalty, 0, 100));
  const masa        = Math.round(weights.w1 * retorno + weights.w2 * crecimiento + weights.w3 * liquidezActivo + weights.w4 * confianza);

  const midPrice    = (high52 + low52) / 2;
  const annualRange = midPrice > 0 ? ((high52 - low52) / midPrice) * 100 : 20;
  const volatilidad = Math.round(clamp(annualRange * (vix / 20) * 0.5, 0, 100));
  const spreadMult  = regime === 'crisis' ? 2.5 : regime === 'risk-off' ? 1.5 : regime === 'risk-on' ? 0.7 : 1.0;
  const spread      = Math.round(clamp(base.spreadBase * spreadMult, 0, 100));
  const correlacion = base.correlacion;
  const distanciaRaw = volatilidad + spread + (1 - correlacion) * 100;

  const fricMult = regime === 'crisis' ? 1.5 : regime === 'risk-off' ? 1.2 : 1.0;
  const friccion = Math.round(clamp(base.friccion * fricMult, 1, 30));

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
    fuerzaG:                0,
    zscoreFlows:            parseFloat((changePct / 2).toFixed(2)),
    masaJustificacion:      `Ret=${retorno}(52s) Daily=${dailyReturn}(${changePct.toFixed(1)}%) Crec=${crecimiento} Liq=${liquidezActivo} Conf=${confianza}`,
    distanciaJustificacion: `Vol52s=${annualRange.toFixed(1)}%×VIX=${vix.toFixed(1)} → vol=${volatilidad}, spr=${spread}`,
    friccionJustificacion:  `F_base=${base.friccion}×${fricMult}=${friccion}`,
    distanciaRaw,
    changePercent: changePct,
  };
}

// ─── Sector metrics with full MASA/DISTANCIA/FRICCION ────────────────────────
interface RawSectorMetric { masa: number; distanciaRaw: number; friccionRaw: number; }

function computeSectorMetric(
  sectorId: string,
  quote: YFQuote,
  macro: MacroContext,
  weights: { w1: number; w2: number; w3: number; w4: number },
  countryName?: string,
): RawSectorMetric {
  const base     = SECTOR_BASE[sectorId];
  const price    = quote.regularMarketPrice ?? 100;
  const low52    = quote.fiftyTwoWeekLow    ?? price * 0.80;
  const high52   = quote.fiftyTwoWeekHigh   ?? price * 1.20;
  const avg50    = quote.fiftyDayAverage    ?? price;
  const changePct = quote.regularMarketChangePercent ?? 0;

  const rangeW   = high52 - low52;
  const midPrice = (high52 + low52) / 2;
  const annualRange = midPrice > 0 ? (rangeW / midPrice) * 100 : 20;

  // ── MASA: M = w1(Return) + w2(Growth) + w3(Liquidity) + w4(Confidence) ──────
  const priceReturn   = Math.round(rangeW > 0 ? clamp((price - low52) / rangeW * 100, 0, 100) : 50);
  const priceMomentum = Math.round(clamp((price / (avg50 || price) - 1) * 300 + 50, 0, 100));
  const dailyReturn   = Math.round(clamp(50 + changePct * 5, 0, 100));
  const earningsYield = quote.trailingEps && quote.trailingEps > 0 && price > 0
    ? Math.round(clamp(quote.trailingEps / price * 1000, 0, 100))
    : 50;
  const dividendYield = Math.round(clamp((quote.trailingAnnualDividendYield ?? 0) * 200, 0, 100));
  const epsGrowth     = Math.round(clamp(50 + (quote.earningsQuarterlyGrowth ?? 0) * 100, 0, 100));
  const volumeScore   = quote.regularMarketVolume && quote.averageDailyVolume3Month
    ? Math.round(clamp(quote.regularMarketVolume / quote.averageDailyVolume3Month * 50, 0, 100))
    : 50;
  const marketCapScore = quote.marketCap && quote.marketCap > 0
    ? Math.round(clamp(Math.log10(quote.marketCap) / Math.log10(5e10) * 100, 0, 100))
    : 50;
  const roeScore      = Math.round(clamp(50 + (quote.returnOnEquity ?? 0) * 150, 0, 100));
  const creditScore   = countryName ? (COUNTRY_CREDIT_RATINGS[countryName] ?? 70) : 70;

  const Return     = priceReturn * 0.20 + priceMomentum * 0.20 + dailyReturn * 0.30 + earningsYield * 0.30;
  const Growth     = epsGrowth * 0.5 + roeScore * 0.3 + dividendYield * 0.2;
  const Liquidity  = volumeScore * 0.5 + marketCapScore * 0.3 + dividendYield * 0.2;
  const Confidence = priceMomentum * 0.4 + roeScore * 0.3 + creditScore * 0.3;

  const masa = Math.round(clamp(
    weights.w1 * Return + weights.w2 * Growth + weights.w3 * Liquidity + weights.w4 * Confidence,
    0, 100
  ));

  // ── DISTANCIA: r = Volatilidad + Spread + (1 - Correlacion) ─────────────────
  const impliedVol  = annualRange * (macro.vix / 20) * 0.4;
  const histVol     = annualRange * 0.35;
  const moveContrib = macro.move > 0 ? macro.move / 100 * 5 : 2;
  const Volatilidad = clamp(impliedVol + histVol + moveContrib, 0, 60);

  const cdsProxy      = countryName ? (100 - (COUNTRY_CREDIT_RATINGS[countryName] ?? 70)) * 0.3 : macro.hygStress * 0.5;
  const cpiContrib    = (COUNTRY_CPI[countryName ?? ''] ?? 3.0) * 0.5;
  const rateContrib   = clamp((macro.us10y - macro.us2y) * 5, 0, 20);
  const politicalRisk = countryName ? (100 - (COUNTRY_POLITICAL_STABILITY[countryName] ?? 70)) * 0.2 : 6;
  const Spread        = macro.hygStress * macro.regimeMult * 0.4 + cdsProxy + cpiContrib + rateContrib + politicalRisk;

  const correlacion  = macro.regime === 'crisis' ? 0.85 : macro.regime === 'risk-off' ? 0.70 : macro.regime === 'risk-on' ? 0.35 : 0.50;
  const correlEffect = (1 - correlacion) * 30;

  const distanciaRaw = Volatilidad + Spread + correlEffect;

  // ── FRICCION: F = BidAsk + TxCost + CapControl + Slippage - LiqBonus ────────
  const bidAskRaw = quote.bid && quote.ask && quote.bid > 0 && price > 0
    ? (quote.ask - quote.bid) / price * 100 * 20
    : base.spreadBase * 0.1;
  const turnover  = quote.regularMarketVolume && quote.averageDailyVolume3Month
    ? quote.regularMarketVolume / quote.averageDailyVolume3Month
    : 1;
  const liqBonus  = clamp((turnover - 1) * 10, -10, 10);
  const txCost    = (COUNTRY_TRANSACTION_COSTS[countryName ?? ''] ?? 0.15) * 2;
  const capCtrl   = (COUNTRY_CAPITAL_CONTROLS[countryName ?? ''] ?? 2) * 0.3;
  const slippage  = quote.marketCap && quote.marketCap > 0
    ? clamp(15 - Math.log10(quote.marketCap) + 9, 0, 15) * 0.5
    : 3;

  const friccionRaw = clamp(bidAskRaw + txCost + capCtrl + slippage - liqBonus, 1, 30) * macro.regimeMult;

  return { masa, distanciaRaw, friccionRaw };
}

// ─── Country sector nodes (country ETF overlay on global sectors) ─────────────
function computeCountrySectorNodes(
  globalNodes: Array<{ id: string; masa: number; distancia: number; friccionRaw: number }>,
  countryQuote: YFQuote | null,
  countryName: string,
  macro: MacroContext,
): Array<{ id: string; masa: number; distancia: number; isGravityCenter: boolean }> {
  const profile      = G8_SECTOR_PROFILES[countryName];
  const creditRating = COUNTRY_CREDIT_RATINGS[countryName] ?? 70;
  const politicalStab = COUNTRY_POLITICAL_STABILITY[countryName] ?? 70;
  const capControl   = COUNTRY_CAPITAL_CONTROLS[countryName] ?? 5;
  const txCost       = COUNTRY_TRANSACTION_COSTS[countryName] ?? 0.15;
  const cpi          = COUNTRY_CPI[countryName] ?? 3.0;

  // Country ETF live metrics
  let countryReturn      = 50;
  let countryMomentum    = 50;
  let countryDailyReturn = 50;
  let countryVolatility  = 20;
  let countryVolume      = 50;
  let countryDivYield    = 0;

  if (countryQuote) {
    const cp         = countryQuote.regularMarketPrice         ?? 100;
    const cl         = countryQuote.fiftyTwoWeekLow            ?? cp * 0.85;
    const ch         = countryQuote.fiftyTwoWeekHigh           ?? cp * 1.15;
    const ca         = countryQuote.fiftyDayAverage            ?? cp;
    const countryChgPct = countryQuote.regularMarketChangePercent ?? 0;
    const cr         = ch - cl;
    countryReturn      = Math.round(cr > 0 ? clamp((cp - cl) / cr * 100, 0, 100) : 50);
    countryMomentum    = Math.round(clamp(50 + (cp / (ca || cp) - 1) * 300, 0, 100));
    countryDailyReturn = Math.round(clamp(50 + countryChgPct * 5, 0, 100));
    const cMid         = (ch + cl) / 2;
    countryVolatility  = cMid > 0 ? clamp((ch - cl) / cMid * 100 * (macro.vix / 20) * 0.5, 5, 60) : 20;
    countryVolume      = countryQuote.regularMarketVolume && countryQuote.averageDailyVolume3Month
      ? Math.round(clamp(countryQuote.regularMarketVolume / countryQuote.averageDailyVolume3Month * 50, 0, 100))
      : 50;
    countryDivYield    = Math.round(clamp((countryQuote.trailingAnnualDividendYield ?? 0) * 200, 0, 100));
  }

  const countryConfidence = Math.round(
    countryReturn * 0.30 + countryMomentum * 0.30 + creditRating * 0.25 + politicalStab * 0.15
  );
  const countryFricBase = clamp(capControl * 0.5 + txCost * 20 + (countryQuote ? 1 : 5), 1, 20) * macro.regimeMult;

  const countryRisk = countryVolatility * 0.4 + (100 - creditRating) * 0.3 + (100 - politicalStab) * 0.2 + cpi * 0.5;

  // Country ETF composite signal (same for all sectors in this country)
  const countryMasaSignal =
    countryReturn      * 0.20 +
    countryMomentum    * 0.15 +
    countryDailyReturn * 0.30 +
    countryConfidence  * 0.20 +
    countryDivYield    * 0.15;

  const rawNodes = globalNodes.map(node => {
    const domFactor = profile ? (profile[node.id] ?? 50) / 100 : 0.5;

    // Sector-specific country signal: dominant sectors get full country signal,
    // non-dominant sectors are pulled toward a neutral floor (30) — they barely
    // exist in the local economy so the country ETF move barely affects them.
    const sectorCountrySignal = countryMasaSignal * domFactor + 30 * (1 - domFactor);

    // MASA: strong country blend (70%) + structural dominance bonus (±20pts)
    // domMasaBonus: dom=0.98 → +19.2, dom=0.50 → 0, dom=0.30 → -8
    const domMasaBonus = (domFactor - 0.5) * 40;
    const masa = Math.round(clamp(
      node.masa * (1 - domFactor * 0.70) + sectorCountrySignal * domFactor * 0.70 + domMasaBonus,
      5, 100
    ));

    // DISTANCIA: non-dominant sectors get heavy distance penalty (up to +50 pts)
    // Dom=0.98 → penalty=1, dom=0.50 → penalty=25, dom=0.30 → penalty=35
    const domDistanciaAdj = (1 - domFactor) * 50;
    const distancia = Math.round(clamp(
      node.distancia * 0.40 + countryRisk * 0.30 + domDistanciaAdj,
      10, 90
    ));

    // FRICCION: global base + country-specific friction
    const friccion = Math.round(clamp(node.friccionRaw * 0.5 + countryFricBase * 0.5, 1, 30));

    return { id: node.id, masa, distancia, friccion };
  });

  // Top-3 by net gravity force become gravity centers
  const ranked = [...rawNodes].sort((a, b) => (b.masa - b.distancia) - (a.masa - a.distancia));
  const topIds = new Set(ranked.slice(0, 3).map(n => n.id));
  return rawNodes.map(n => ({ id: n.id, masa: n.masa, distancia: n.distancia, isGravityCenter: topIds.has(n.id) }));
}

// ─── Sector flows with Z-score calibration ────────────────────────────────────
// FlowFinal = FlowTheoretical × (1 + ZscoreFlows)
function computeSectorFlowsCalibrated(
  nodes: Array<{ id: string; masa: number; distancia: number }>,
  zscoreFlows: number,
  topN = 6,
): Array<{ from: string; to: string; strength: number }> {
  const pairs: Array<{ from: string; to: string; score: number }> = [];

  for (const f of nodes) {
    for (const t of nodes) {
      if (f.id === t.id) continue;
      const flowTheoretical = (f.masa * t.masa) / Math.pow(Math.max(1, t.distancia), 2);
      if (flowTheoretical < 1) continue;
      pairs.push({ from: f.id, to: t.id, score: flowTheoretical * (1 + zscoreFlows) });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  const usedTargets = new Set<string>();
  const selected: typeof pairs = [];
  for (const pair of pairs) {
    if (usedTargets.has(pair.to)) continue;
    usedTargets.add(pair.to);
    selected.push(pair);
    if (selected.length >= topN) break;
  }
  if (selected.length === 0) return [];
  const maxScore = selected[0].score;
  return selected.map(({ from, to, score }) => ({
    from, to, strength: parseFloat((score / maxScore).toFixed(3)),
  }));
}

// ─── Asset flows ──────────────────────────────────────────────────────────────
function computeFlows(metrics: Record<string, GravityMetrics>): CapitalFlow[] {
  const rawFlows: Array<{
    from: string; to: string;
    flowTheoretical: number; flowFinal: number; zscoreAdjustment: number;
  }> = [];

  for (const from of Object.keys(metrics)) {
    for (const to of Object.keys(metrics)) {
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
  const losers    = Object.entries(metrics)
    .sort((a, b) => (a[1].fuerzaG ?? 0) - (b[1].fuerzaG ?? 0))
    .slice(0, 2)
    .map(([id]) => id);
  const topText    = gravityCenters.slice(0, 3).join(', ') || 'ninguno destacado';
  return (
    `Mercados en modo ${regimeLabel[regime] ?? regime.toUpperCase()}. ` +
    `Capital gravitando hacia: ${topText}. ` +
    `Salida de flujos desde: ${losers.join(' y ')}. ` +
    `VIX ${vix.toFixed(1)} · US10Y ${us10y.toFixed(2)}%.`
  );
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const assetSyms   = Object.values(ASSET_SYMBOLS);
    const sectorSyms  = Object.values(SECTOR_SYMBOLS);
    const countrySyms = Object.values(COUNTRY_ETF_SYMBOLS).filter((s): s is string => s !== null);
    const macroSyms   = ['^VIX', '^TNX', '^IRX', 'HYG', '^MOVE'];
    const allSymbols  = [...new Set([...assetSyms, ...sectorSyms, ...countrySyms, ...macroSyms])];

    const quotes = await Promise.all(
      allSymbols.map(sym => (yf.quote(sym) as Promise<YFQuote>).catch(() => null)),
    );
    const quoteMap: Record<string, YFQuote> = {};
    allSymbols.forEach((sym, i) => { if (quotes[i]) quoteMap[sym] = quotes[i]!; });

    // Macro values
    const vix     = quoteMap['^VIX']?.regularMarketPrice          ?? 20;
    const vixChg  = quoteMap['^VIX']?.regularMarketChangePercent  ?? 0;
    const us10y   = quoteMap['^TNX']?.regularMarketPrice          ?? 4.3;
    const us2y    = quoteMap['^IRX']?.regularMarketPrice          ?? 4.7;
    const move  = quoteMap['^MOVE']?.regularMarketPrice ?? 0;

    // HY-OAS proxy: HYG distance from 52w high
    const hygQ      = quoteMap['HYG'];
    const hygHigh52 = hygQ?.fiftyTwoWeekHigh ?? ((hygQ?.regularMarketPrice ?? 80) * 1.05);
    const hygStress = hygQ
      ? clamp((1 - (hygQ.regularMarketPrice ?? hygHigh52) / hygHigh52) * 100, 0, 50)
      : 10;

    const regime: 'risk-on' | 'risk-off' | 'crisis' | 'neutral' =
      vix > 30 || (vix > 24 && vixChg > 8)  ? 'crisis'  :
      vix < 18 && vixChg < 5                 ? 'risk-on' :
      vix < 20                               ? 'risk-on' :
      vix > 24 || vixChg > 5                 ? 'risk-off':
      'neutral';

    const regimeMult = regime === 'crisis' ? 1.5 : regime === 'risk-off' ? 1.2 : 1.0;
    const weights    = REGIME_WEIGHTS[regime];
    const macro: MacroContext = { vix, us10y, us2y, move, hygStress, regime, regimeMult };

    // Z-score from real flow signals: DXY + HYG + yield curve
    const dxyChg   = quoteMap['DX-Y.NYB']?.regularMarketChangePercent ?? 0;
    const hygChg   = hygQ?.regularMarketChangePercent ?? 0;
    const zDXY     = clamp(-dxyChg / 2, -0.8, 2.0);
    const zHYG     = clamp(hygChg / 1.5, -0.8, 2.0);
    const zCurve   = clamp((us10y - us2y) / 2, -0.5, 1.0);
    const zscoreFlows = zDXY * 0.3 + zHYG * 0.4 + zCurve * 0.3;

    // ── Asset metrics ──────────────────────────────────────────────────────────
    const rawAssets: Record<string, RawAssetMetrics> = {};
    for (const [id, sym] of Object.entries(ASSET_SYMBOLS)) {
      rawAssets[id] = computeAssetMetrics(id, quoteMap[sym] ?? {}, vix, regime, weights);
    }
    const assetDistRaw = Object.values(rawAssets).map(m => m.distanciaRaw);
    const minAD  = Math.min(...assetDistRaw);
    const rangeAD = (Math.max(...assetDistRaw) - minAD) || 1;

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

    // ── Global sector metrics (US baseline) ────────────────────────────────────
    const rawSectors: Record<string, RawSectorMetric> = {};
    for (const [sectorId, sym] of Object.entries(SECTOR_SYMBOLS)) {
      rawSectors[sectorId] = computeSectorMetric(sectorId, quoteMap[sym] ?? {}, macro, weights, 'EE.UU.');
    }
    const sectorDistRaw = Object.values(rawSectors).map(m => m.distanciaRaw);
    const minSD   = Math.min(...sectorDistRaw);
    const rangeSD = (Math.max(...sectorDistRaw) - minSD) || 1;

    // globalNodes includes friccionRaw for country overlay blending
    const globalNodes = Object.entries(rawSectors).map(([id, raw]) => ({
      id,
      masa:       raw.masa,
      distancia:  Math.round(((raw.distanciaRaw - minSD) / rangeSD) * 80 + 10),
      friccionRaw: clamp(raw.friccionRaw, 1, 30),
    }));

    // sectorData = EE.UU. perspective — top-3 by net force become gravity centers
    const usSectorRaw = globalNodes.map(({ id, masa, distancia }) => ({ id, masa, distancia }));
    const usRanked    = [...usSectorRaw].sort((a, b) => (b.masa - b.distancia) - (a.masa - a.distancia));
    const usTopIds    = new Set(usRanked.slice(0, 3).map(n => n.id));
    const usSectorNodes = usSectorRaw.map(n => ({ ...n, isGravityCenter: usTopIds.has(n.id) }));
    const usSectorFlows = computeSectorFlowsCalibrated(usSectorNodes, zscoreFlows);

    // ── Per-country sector data ────────────────────────────────────────────────
    const countrySectorData: Record<string, {
      nodes: Array<{ id: string; masa: number; distancia: number; isGravityCenter: boolean }>;
      flows: Array<{ from: string; to: string; strength: number }>;
    }> = {};

    for (const [countryName, etfSym] of Object.entries(COUNTRY_ETF_SYMBOLS)) {
      const countryQuote = etfSym ? (quoteMap[etfSym] ?? null) : null;
      const nodes = computeCountrySectorNodes(globalNodes, countryQuote, countryName, macro);
      countrySectorData[countryName] = {
        nodes,
        flows: computeSectorFlowsCalibrated(nodes, zscoreFlows),
      };
    }

    // ── Assemble scenario ──────────────────────────────────────────────────────
    const scenario: MarketScenario = {
      id:               'live',
      name:             'Realidad del Mercado en Vivo',
      description:      buildDescription(regime, vix, us10y, gravityCenters, metrics),
      macroRegime:      regime,
      regimeWeights:    weights,
      gravityCenters,
      flows,
      metrics,
      sectorData:       { nodes: usSectorNodes, flows: usSectorFlows },
      countrySectorData,
      lastUpdated:      Date.now(),
    };

    return NextResponse.json(scenario);
  } catch (error) {
    console.error('Live analysis error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Failed to fetch live analysis', detail: message }, { status: 500 });
  }
}
