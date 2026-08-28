import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { GoogleGenAI } from '@google/genai';
import type { MarketScenario, GravityMetrics, CapitalFlow } from '@/src/data';

export const dynamic = 'force-dynamic';

// â”€â”€â”€ Extended YFQuote interface â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Asset symbols â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Sector ETF symbols â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Country-specific sector tickers (price/volume signal per country) â”€â”€â”€â”€â”€â”€â”€â”€
// Each entry maps sectorId â†’ ticker available on Yahoo Finance for that country.
// Falls back to US ETF options pressure for sectors without a country ticker.
const COUNTRY_SECTOR_SYMBOLS: Record<string, Record<string, string>> = {
  'EE.UU.': {},  // uses SECTOR_SYMBOLS (US ETFs) directly
  'CanadÃ¡': {
    technology:         'XIT.TO',   // iShares S&P/TSX Capped Info Tech
    energy:             'XEG.TO',   // iShares S&P/TSX Capped Energy
    financial:          'XFN.TO',   // iShares S&P/TSX Capped Financials
    basic_materials:    'XMA.TO',   // iShares S&P/TSX Global Mining
    real_estate:        'XRE.TO',   // iShares S&P/TSX Capped REIT
    cons_staples:       'XST.TO',   // iShares S&P/TSX Capped Consumer Staples
    utilities:          'XUT.TO',   // iShares S&P/TSX Capped Utilities
    industrials:        'ZIN.TO',   // BMO S&P/TSX Equal Weight Industrials
  },
  'Alemania': {
    technology:         'SAP.DE',   // SAP (Xetra)
    industrials:        'SIE.DE',   // Siemens
    financial:          'DBK.DE',   // Deutsche Bank
    healthcare:         'BAYN.DE',  // Bayer
    energy:             'RWE.DE',   // RWE
    cons_discretionary: 'BMW.DE',   // BMW
    basic_materials:    'BASF.DE',  // BASF
    utilities:          'EOAN.DE',  // E.ON
    communication:      'DTE.DE',   // Deutsche Telekom
  },
  'Francia': {
    technology:         'CAP.PA',   // Capgemini (Euronext Paris)
    cons_discretionary: 'MC.PA',    // LVMH
    financial:          'BNP.PA',   // BNP Paribas
    healthcare:         'SAN.PA',   // Sanofi
    energy:             'TTE.PA',   // TotalEnergies
    industrials:        'AIR.PA',   // Airbus
    cons_staples:       'OR.PA',    // L'Oreal
    basic_materials:    'AI.PA',    // Air Liquide
    communication:      'ORA.PA',   // Orange
  },
  'Italia': {
    technology:         'STM.MI',   // STMicroelectronics (Borsa Italiana)
    financial:          'ISP.MI',   // Intesa Sanpaolo
    energy:             'ENI.MI',   // ENI
    utilities:          'ENEL.MI',  // Enel
    industrials:        'LDO.MI',   // Leonardo
    healthcare:         'REC.MI',   // Recordati
    cons_discretionary: 'STLA.MI',  // Stellantis
    basic_materials:    'TEN.MI',   // Tenaris
  },
  'JapÃ³n': {
    technology:         '6758.T',   // Sony (Tokyo)
    industrials:        '7203.T',   // Toyota
    financial:          '8306.T',   // Mitsubishi UFJ Financial
    healthcare:         '4502.T',   // Takeda Pharmaceutical
    cons_discretionary: '7974.T',   // Nintendo
    energy:             '5020.T',   // ENEOS Holdings
    basic_materials:    '5401.T',   // Nippon Steel
    communication:      '9984.T',   // SoftBank Group
    utilities:          '9501.T',   // Tokyo Electric Power
    real_estate:        '8951.T',   // Japan Real Estate Investment
  },
  'Reino Unido': {
    financial:          'HSBA.L',   // HSBC (London)
    healthcare:         'AZN.L',    // AstraZeneca
    energy:             'BP.L',     // BP
    cons_staples:       'ULVR.L',   // Unilever
    industrials:        'RR.L',     // Rolls-Royce
    basic_materials:    'RIO.L',    // Rio Tinto
    utilities:          'NG.L',     // National Grid
    communication:      'VOD.L',    // Vodafone
    real_estate:        'LAND.L',   // Land Securities
  },
  'Rusia': {},  // Moscow Exchange data unreliable via Yahoo Finance â€” uses static profiles
};

// â”€â”€â”€ Country ETF symbols â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const COUNTRY_ETF_SYMBOLS: Record<string, string | null> = {
  'EE.UU.':      null,
  'CanadÃ¡':      'EWC',
  'Francia':     'EWQ',
  'Alemania':    'EWG',
  'Italia':      'EWI',
  'JapÃ³n':       'EWJ',
  'Reino Unido': 'EWU',
  'Rusia':       'ERUS',
};

// â”€â”€â”€ Static country tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// S&P/Moody's credit ratings â†’ [0-100]
const COUNTRY_CREDIT_RATINGS: Record<string, number> = {
  'EE.UU.':      85,
  'CanadÃ¡':      90,
  'Francia':     78,
  'Alemania':    95,
  'Italia':      65,
  'JapÃ³n':       80,
  'Reino Unido': 82,
  'Rusia':       35,
};

// World Bank political stability â†’ [0-100, higher = more stable]
const COUNTRY_POLITICAL_STABILITY: Record<string, number> = {
  'EE.UU.':      70,
  'CanadÃ¡':      85,
  'Francia':     68,
  'Alemania':    82,
  'Italia':      60,
  'JapÃ³n':       84,
  'Reino Unido': 72,
  'Rusia':       25,
};

// IMF/WB capital controls â†’ [0-30, higher = more restricted]
const COUNTRY_CAPITAL_CONTROLS: Record<string, number> = {
  'EE.UU.':      0,
  'CanadÃ¡':      0,
  'Francia':     1,
  'Alemania':    1,
  'Italia':      2,
  'JapÃ³n':       3,
  'Reino Unido': 0,
  'Rusia':       22,
};

// Transaction costs [% of trade value]
const COUNTRY_TRANSACTION_COSTS: Record<string, number> = {
  'EE.UU.':      0.05,
  'CanadÃ¡':      0.10,
  'Francia':     0.12,
  'Alemania':    0.12,
  'Italia':      0.15,
  'JapÃ³n':       0.18,
  'Reino Unido': 0.13,
  'Rusia':       0.40,
};

// CPI annual approx 2024-2025 [%]
const COUNTRY_CPI: Record<string, number> = {
  'EE.UU.':      3.2,
  'CanadÃ¡':      2.9,
  'Francia':     2.3,
  'Alemania':    2.5,
  'Italia':      1.8,
  'JapÃ³n':       2.8,
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
  'CanadÃ¡': {
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
  'JapÃ³n': {
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

// â”€â”€â”€ Regime weights â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const REGIME_WEIGHTS: Record<string, { w1: number; w2: number; w3: number; w4: number }> = {
  'risk-on':  { w1: 0.40, w2: 0.35, w3: 0.15, w4: 0.10 },
  'risk-off': { w1: 0.15, w2: 0.10, w3: 0.35, w4: 0.40 },
  'crisis':   { w1: 0.05, w2: 0.05, w3: 0.45, w4: 0.45 },
  'neutral':  { w1: 0.25, w2: 0.25, w3: 0.25, w4: 0.25 },
};

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

// â”€â”€â”€ Macro context passed to sector functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface MacroContext {
  vix: number;
  us10y: number;
  us2y: number;
  move: number;
  hygStress: number;
  regime: string;
  regimeMult: number;
}

// â”€â”€â”€ Asset metrics (unchanged) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    distanciaJustificacion: `Vol52s=${annualRange.toFixed(1)}%Ã—VIX=${vix.toFixed(1)} â†’ vol=${volatilidad}, spr=${spread}`,
    friccionJustificacion:  `F_base=${base.friccion}Ã—${fricMult}=${friccion}`,
    distanciaRaw,
    changePercent: changePct,
  };
}

// â”€â”€â”€ Sector metrics with full MASA/DISTANCIA/FRICCION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ MASA: M = w1(Return) + w2(Growth) + w3(Liquidity) + w4(Confidence) â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ DISTANCIA: r = Volatilidad + Spread + (1 - Correlacion) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ FRICCION: F = BidAsk + TxCost + CapControl + Slippage - LiqBonus â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Country sector nodes (country ETF overlay on global sectors) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function computeCountrySectorNodes(
  globalNodes: Array<{ id: string; masa: number; distancia: number; friccionRaw: number }>,
  countryQuote: YFQuote | null,
  countryName: string,
  macro: MacroContext,
  sectorPressures: Record<string, number> = {},
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
    // non-dominant sectors are pulled toward a neutral floor (30) â€” they barely
    // exist in the local economy so the country ETF move barely affects them.
    const sectorCountrySignal = countryMasaSignal * domFactor + 30 * (1 - domFactor);

    // MASA: strong country blend (70%) + structural dominance bonus (Â±20pts)
    // domMasaBonus: dom=0.98 â†’ +19.2, dom=0.50 â†’ 0, dom=0.30 â†’ -8
    const domMasaBonus = (domFactor - 0.5) * 40;
    const masa = Math.round(clamp(
      node.masa * (1 - domFactor * 0.70) + sectorCountrySignal * domFactor * 0.70 + domMasaBonus,
      5, 100
    ));

    // DISTANCIA: non-dominant sectors get heavy distance penalty (up to +50 pts)
    // Dom=0.98 â†’ penalty=1, dom=0.50 â†’ penalty=25, dom=0.30 â†’ penalty=35
    const domDistanciaAdj = (1 - domFactor) * 50;
    const distancia = Math.round(clamp(
      node.distancia * 0.40 + countryRisk * 0.30 + domDistanciaAdj,
      10, 90
    ));

    // FRICCION: global base + country-specific friction
    const friccion = Math.round(clamp(node.friccionRaw * 0.5 + countryFricBase * 0.5, 1, 30));

    return { id: node.id, masa, distancia, friccion, domFactor };
  });

  // mean+0.5Ïƒ threshold â€” rotation-enhanced, pressure weighted by country sector dominance
  const sForces = rawNodes.map(n => {
    const pressureContrib = clamp((sectorPressures[n.id] ?? 0) / 5, -15, 15) * n.domFactor;
    return (n.masa - n.distancia) + pressureContrib;
  });
  const sMean   = sForces.reduce((a, b) => a + b, 0) / sForces.length;
  const sSigma  = Math.sqrt(sForces.reduce((a, b) => a + (b - sMean) ** 2, 0) / sForces.length);
  const sHighT  = sMean + 0.5 * sSigma;
  return rawNodes.map((n, i) => ({ id: n.id, masa: n.masa, distancia: n.distancia, isGravityCenter: sForces[i] >= sHighT }));
}

// â”€â”€â”€ Sector flows with Z-score calibration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FlowFinal = FlowTheoretical Ã— (1 + ZscoreFlows)
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

// â”€â”€â”€ Asset flows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    label: `Flujo ${from} â†’ ${to} (FG: ${(metrics[to].fuerzaG ?? 0).toFixed(1)})`,
  }));
}

// ─── Gemini cache (60-min TTL — free tier: 20 req/day) ───────────────────────
let geminiCache: { text: string; ts: number; key: string } | null = null;
const GEMINI_TTL_MS = 60 * 60 * 1000;

// â”€â”€â”€ Human-readable description â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function generateAIDescription(
  regime: string,
  vix: number,
  us10y: number,
  gravityCenters: string[],
  metrics: Record<string, GravityMetrics>,
  headlines: Array<{ title: string; source: string; sentiment: string; category: NewsCategory }>,
  assetPressures: Record<string, number>,
  rotationSignal: string,
  countrySectorData?: Record<string, {
    nodes: Array<{ id: string; masa: number; distancia: number; isGravityCenter: boolean }>;
  }>,
  newsFlowSignal?: Record<string, { tilt: number; reasons: string[] }>,
): Promise<string> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return buildDescription(regime, vix, us10y, gravityCenters, metrics);

    // Cache key: only regime — reduces invalidations, conserves free-tier quota
    const cacheKey = regime;
    const now = Date.now();
    if (geminiCache && geminiCache.key === cacheKey && now - geminiCache.ts < GEMINI_TTL_MS) {
      return geminiCache.text;
    }

    const gcDetails = gravityCenters.length
      ? gravityCenters.map(id => {
          const m = metrics[id];
          if (!m) return `${id}: sin datos`;
          return `${id}: MASA=${m.masa} · distancia=${m.distancia} · G=${m.fuerzaG?.toFixed(2) ?? 'n/a'} · presión_institucional=${(assetPressures[id] ?? 0).toFixed(0)}`;
        }).join('\n')
      : 'Ninguno supera el umbral dinámico (media+0.5σ)';

    const allAssetsRanked = Object.entries(metrics)
      .sort((a, b) => (b[1].fuerzaG ?? 0) - (a[1].fuerzaG ?? 0))
      .map(([id, m]) => `${id}: MASA=${m.masa} d=${m.distancia} G=${m.fuerzaG?.toFixed(2) ?? 'n/a'}`)
      .join(' | ');

    const newsBlock = (cat: NewsCategory) => {
      const items = headlines.filter(h => h.category === cat);
      if (items.length === 0) return '(sin titulares en esta categoria hoy)';
      return items.map(h => `[${h.sentiment.toUpperCase()}] ${h.title} -- ${h.source}`).join('\n');
    };
    const companyNewsText = newsBlock('empresas');
    const geoNewsText     = newsBlock('geopolitica');
    const econNewsText    = newsBlock('economia');

    const newsFlowText = newsFlowSignal && Object.keys(newsFlowSignal).length > 0
      ? Object.entries(newsFlowSignal)
          .sort((a, b) => Math.abs(b[1].tilt) - Math.abs(a[1].tilt))
          .map(([id, v]) => `${id}: ${v.tilt > 0 ? '+' : ''}${v.tilt} -- ${v.reasons.join('; ')}`)
          .join('\n')
      : '(ninguna regla de flujo por noticias se activo hoy)';

    // Top G7 sectors by gravity force
    const SECTOR_LABELS: Record<string, string> = {
      technology:'Tecnología', communication:'Comunicación', cons_discretionary:'C.Discrecional',
      cons_staples:'C.Básico', energy:'Energía', financial:'Financiero',
      healthcare:'Salud', industrials:'Industriales', real_estate:'Inmobiliario',
      basic_materials:'Materiales', utilities:'Utilities',
    };
    const countrySectorSummary = countrySectorData
      ? Object.entries(countrySectorData)
          .filter(([c]) => c !== 'Rusia')
          .map(([country, { nodes }]) => {
            const centers = nodes
              .filter(n => n.isGravityCenter)
              .sort((a, b) => (b.masa - b.distancia) - (a.masa - a.distancia))
              .slice(0, 3)
              .map(n => `${SECTOR_LABELS[n.id] ?? n.id}(M=${n.masa},d=${n.distancia})`)
              .join(', ');
            return `${country}: ${centers || 'sin centros'}`;
          }).join('\n')
      : 'No disponible';

    const today = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
    const prompt = `Eres un analista cuantitativo de mercados financieros especializado en el modelo de Gravedad de Capital (G = (MASA − distancia) / fricción).

FECHA: ${today}
RÉGIMEN MACRO: ${regime.toUpperCase()} | VIX: ${vix.toFixed(1)} | US10Y: ${us10y.toFixed(2)}% | Rotación: ${rotationSignal}

CENTROS DE GRAVEDAD ACTUALES (activos con G ≥ media+0.5σ del escenario):
${gcDetails}

TODOS LOS ACTIVOS RANKEADOS POR FUERZA G:
${allAssetsRanked}

Ã
NOTICIAS DE EMPRESAS (${headlines.filter(h => h.category === 'empresas').length} titulares):
${companyNewsText}

NOTICIAS GEOPOLITICAS (${headlines.filter(h => h.category === 'geopolitica').length} titulares):
${geoNewsText}

NOTICIAS DE ECONOMIA Y BANCOS CENTRALES -- inflacion, Fed, BCE, BoE, BoJ, BoC, tasas (${headlines.filter(h => h.category === 'economia').length} titulares):
${econNewsText}

SENALES DE FLUJO POR NOTICIAS (reglas activadas hoy por titulares reales -- tilt en puntos, positivo = entra capital, negativo = sale capital):
${newsFlowText}

SECTORES LIDERES POR PAIS G7 (centros de gravedad activos, Sector(M=masa,d=distancia)):
${countrySectorSummary}

Escribe un análisis en español de 5 párrafos cortos. Cada párrafo separado por una línea en blanco. Sin markdown, sin viñetas, sin encabezados.

Párrafo 1 — Interpretación de noticias: qué narrativa emerge de las tres categorías (empresas, geopolítica, economía/bancos centrales) y cómo se combinan para afectar el sentimiento de mercado hoy.
Párrafo 2 — Justificación de centros de gravedad: explica por qué exactamente esos activos/mercados están atrayendo capital HOY, citando sus valores MASA/distancia/G y conectándolos explícitamente con noticias concretas de empresas, geopolítica y economía/bancos centrales (inflación, decisiones de tasas) cuando aplique, y con las SEÑALES DE FLUJO POR NOTICIAS si hay alguna activada — no te quedes en lo genérico, nombra la noticia y el activo.
Párrafo 3 — Activos que pierden capital: cuáles tienen la menor Fuerza G, por qué el capital sale de ahí, y qué noticias (de cualquiera de las tres categorías) o métricas lo explican.
Párrafo 4 — Sectores por países G7: analiza cuáles sectores dominan en qué países (usando los datos de SECTORES LIDERES POR PAIS). Identifica divergencias entre economías G7 y qué implica para la rotación de capital internacional. Menciona al menos 3 países con sus sectores líderes y valores MASA/distancia.
Párrafo 5 — Posicionamiento estratégico: qué sugiere el modelo para el posicionamiento de capital en las próximas horas/días, dado el régimen ${regime} y las señales actuales.

Sé específico con los números del modelo. Conecta cada conclusión con datos concretos.`;

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [{ role: 'user' as const, parts: [{ text: prompt }] }],
    });
    const text = response.text?.trim();
    const result = text || buildDescription(regime, vix, us10y, gravityCenters, metrics);
    geminiCache = { text: result, ts: Date.now(), key: cacheKey };
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[AI] generateAIDescription failed:', msg);
    // Return cached text if available (even stale), else fall back to static description
    return geminiCache?.text ?? buildDescription(regime, vix, us10y, gravityCenters, metrics);
  }
}

function buildDescription(
  regime: string,
  vix: number,
  us10y: number,
  gravityCenters: string[],
  metrics: Record<string, GravityMetrics>,
): string {
  const regimeLabel: Record<string, string> = {
    'risk-on':  'EXPANSIÃ“N â€” apetito de riesgo alto',
    'risk-off': 'DEFENSIVO â€” inversores buscan seguridad',
    'crisis':   'CRISIS â€” capital huye hacia refugios',
    'neutral':  'NEUTRAL â€” seÃ±ales mixtas sin tendencia clara',
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
    `VIX ${vix.toFixed(1)} Â· US10Y ${us10y.toFixed(2)}%.`
  );
}

// â”€â”€â”€ Rotation model (adapted from sector.py) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function computeInstitutionalPressure(quote: YFQuote, regimeMult: number): number {
  const price     = quote.regularMarketPrice        ?? 100;
  const avg50     = quote.fiftyDayAverage           ?? price;
  const changePct = quote.regularMarketChangePercent ?? 0;
  const vol       = quote.regularMarketVolume       ?? 0;
  const avgVol    = quote.averageDailyVolume3Month  ?? vol;

  const momentum  = avg50 > 0 ? (price / avg50 - 1) * 200 : 0;
  const volSurge  = avgVol > 0 ? (vol / avgVol - 1) * 30 : 0;
  const dailyMove = changePct * 5;

  return clamp((momentum * 0.5 + volSurge * 0.3 + dailyMove * 0.2) * regimeMult, -100, 100);
}

function computeSectorRotationSignal(
  pressures: Record<string, number>,
  auxPressures: { gold: number; bonds: number; norteAmerica: number },
): { signal: string; regimeHint: 'risk-on' | 'risk-off' | 'value' | 'defensive' | 'mixed' } {
  const avgOf = (...keys: string[]) => {
    const vals = keys.map(k => pressures[k] ?? 0);
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const growthScore    = (avgOf('technology', 'communication', 'cons_discretionary') + auxPressures.norteAmerica) / 2;
  const defensiveScore = avgOf('cons_staples', 'healthcare');
  const altScore       = (auxPressures.gold + auxPressures.bonds) / 2;
  const energyScore    = pressures['energy']    ?? 0;
  const finScore       = pressures['financial'] ?? 0;

  if (growthScore > 20 && altScore < -5)
    return { signal: 'RISK-ON Â· GROWTH',            regimeHint: 'risk-on'   };
  if (altScore > 20 && growthScore < -5)
    return { signal: 'RISK-OFF Â· REFUGIO',           regimeHint: 'risk-off'  };
  if ((energyScore > 20 || finScore > 20) && growthScore < -5)
    return { signal: 'ROTACIÃ“N VALUE',               regimeHint: 'value'     };
  if (defensiveScore > 20 && growthScore < 0)
    return { signal: 'DEFENSIVO Â· CAUTELA',          regimeHint: 'defensive' };
  return   { signal: 'MIXTO Â· SIN TENDENCIA CLARA', regimeHint: 'mixed'     };
}

// â”€â”€â”€ Options: Black-Scholes gamma â†’ real GEX + PCR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface OptionsMetrics {
  netGex:          number;
  putCallRatio:    number;
  gammaFlip:       number | null;
  optionsPressure: number; // [-100, 100]
}
const OPTIONS_ZERO: OptionsMetrics = { netGex: 0, putCallRatio: 1, gammaFlip: null, optionsPressure: 0 };
const OPTIONS_SYMS = [
  ...Object.values(SECTOR_SYMBOLS),
  'QQQ', 'GLD', 'TLT', 'EEM', 'EZU', 'EWJ', 'IBIT', 'USO', 'UUP',
];

function bsGamma(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  return Math.exp(-0.5 * d1 * d1) / (Math.sqrt(2 * Math.PI) * S * sigma * Math.sqrt(T));
}

async function fetchOptionsMetrics(sym: string): Promise<OptionsMetrics> {
  try {
    const result = await (yf as unknown as {
      options(s: string): Promise<{
        quote: { regularMarketPrice?: number };
        options: Array<{
          expirationDate: Date;
          calls: Array<{ strike?: number; openInterest?: number; volume?: number; impliedVolatility?: number }>;
          puts:  Array<{ strike?: number; openInterest?: number; volume?: number; impliedVolatility?: number }>;
        }>;
      }>;
    }).options(sym);

    if (!result?.options?.length) return OPTIONS_ZERO;
    const spot = result.quote?.regularMarketPrice ?? 0;
    if (spot <= 0) return OPTIONS_ZERO;

    const R   = 0.05; // fixed risk-free rate proxy
    const now = Date.now();
    let callGex = 0, putGex = 0, callVol = 0, putVol = 0;
    const strikeGex: Record<number, number> = {};

    for (const chain of result.options.slice(0, 2)) {
      const T = (chain.expirationDate.getTime() - now) / (365.25 * 24 * 3600 * 1000);
      if (T <= 0) continue;

      for (const c of chain.calls) {
        const K = c.strike ?? 0; const oi = c.openInterest ?? 0;
        const iv = c.impliedVolatility ?? 0.3;
        if (K <= 0 || oi <= 0) continue;
        const g = bsGamma(spot, K, T, R, iv) * oi * 100 * spot * spot / 100;
        callGex += g; callVol += (c.volume ?? 0);
        strikeGex[K] = (strikeGex[K] ?? 0) + g;
      }
      for (const p of chain.puts) {
        const K = p.strike ?? 0; const oi = p.openInterest ?? 0;
        const iv = p.impliedVolatility ?? 0.3;
        if (K <= 0 || oi <= 0) continue;
        const g = bsGamma(spot, K, T, R, iv) * oi * 100 * spot * spot / 100;
        putGex += g; putVol += (p.volume ?? 0);
        strikeGex[K] = (strikeGex[K] ?? 0) - g;
      }
    }

    // Gamma flip: strike where cumulative net GEX changes sign
    let cum = 0, gammaFlip: number | null = null;
    for (const s of Object.keys(strikeGex).map(Number).sort((a, b) => a - b)) {
      const prev = cum; cum += strikeGex[s];
      if (prev !== 0 && Math.sign(prev) !== Math.sign(cum)) { gammaFlip = s; break; }
    }

    const total    = callGex + putGex;
    const gexScore = total > 0 ? clamp(((callGex / total) - 0.5) * 200, -100, 100) : 0;
    const pcrScore = clamp((1.0 - (callVol > 0 ? putVol / callVol : 1.0)) * 50, -100, 100);

    return {
      netGex:          callGex - putGex,
      putCallRatio:    callVol > 0 ? putVol / callVol : 1.0,
      gammaFlip,
      optionsPressure: clamp(gexScore * 0.6 + pcrScore * 0.4, -100, 100),
    };
  } catch { return OPTIONS_ZERO; }
}

// â”€â”€â”€ News: types + sentiment helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export type NewsCategory = 'empresas' | 'geopolitica' | 'economia';
interface RawNewsItem { title: string; source: string; publishedAt: number; url?: string; category: NewsCategory; }

const CRISIS_WORDS  = ['bank run','bailout','emergency','systemic','sovereign debt','margin call','liquidity crisis','circuit breaker'];
const BEARISH_WORDS = ['crash','collapse','panic','recession','default','tariff','war','sanctions','selloff','sell-off','plunge','tumble','slump','stagflation','bear market','bank failure','contagion','layoffs','downgrade'];
const BULLISH_WORDS = ['rally','surge','record high','rate cut','recovery','earnings beat','profit','growth','upgrade','buyback','bull market','rebound','beat estimates'];

// Whole-word match, not substring -- 'war' as a plain substring false-positives on
// names like "Warsh" (the Fed chair), "Warsaw", "forward", etc.
function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

// Yahoo's news search() doesn't reliably respect topical query intent (it tends to
// fall back to generic trending finance headlines). Classify by keyword instead of
// trusting whichever query happened to surface a given headline.
const GEO_KEYWORDS = [
  'war','conflict','sanction','tariff','trade war','geopolit','military','invasion',
  'ceasefire','nato','ukraine','russia','taiwan','israel','gaza','middle east','iran',
  'north korea','south china sea','coup','airstrike','missile',
];
const ECON_KEYWORDS = [
  'inflation','cpi','fed','federal reserve','ecb','european central bank',
  'bank of japan','boj','bank of england','bank of canada','interest rate','rate cut',
  'rate hike','gdp','unemployment','jobs report','ppi','central bank','powell','lagarde',
  'warsh','treasury yield','fomc','monetary policy',
];

function classifyNews(title: string): NewsCategory {
  for (const w of GEO_KEYWORDS) if (hasWord(title, w)) return 'geopolitica';
  for (const w of ECON_KEYWORDS) if (hasWord(title, w)) return 'economia';
  return 'empresas';
}

// ─── News → capital-flow rules ─────────────────────────────────────────────
// A rule only fires if a REAL fetched headline today contains one of its keywords --
// no rule ever applies from a static table alone. `reasons` carries the exact
// headline that triggered each tilt, so every adjustment is traceable to real news.
interface NewsFlowTarget { kind: 'asset' | 'sector'; id: string; tilt: number }
interface NewsFlowRule { keywords: string[]; targets: NewsFlowTarget[]; label: string }

const NEWS_FLOW_RULES: NewsFlowRule[] = [
  {
    keywords: ['war', 'conflict', 'invasion', 'military', 'airstrike', 'missile', 'coup'],
    targets: [
      { kind: 'asset', id: 'Gold', tilt: 12 },
      { kind: 'asset', id: 'Bonds', tilt: 8 },
      { kind: 'asset', id: 'Emerging Markets', tilt: -10 },
    ],
    label: 'conflicto armado / tension geopolitica',
  },
  {
    keywords: ['iran', 'middle east', 'strait of hormuz', 'opec'],
    targets: [{ kind: 'asset', id: 'Oil', tilt: 15 }],
    label: 'riesgo de suministro de petroleo en Medio Oriente',
  },
  {
    keywords: ['sanction', 'tariff', 'trade war'],
    targets: [
      { kind: 'asset', id: 'Emerging Markets', tilt: -8 },
      { kind: 'sector', id: 'industrials', tilt: -5 },
    ],
    label: 'sanciones / tension comercial',
  },
  {
    keywords: ['rate hike', 'rate hikes', 'rate increase', 'rate increases', 'hawkish', 'raise rates', 'raising rates', 'tightening'],
    targets: [
      { kind: 'asset', id: 'Bonds', tilt: -12 },
      { kind: 'sector', id: 'technology', tilt: -6 },
      { kind: 'asset', id: 'USD', tilt: 8 },
    ],
    label: 'postura hawkish de banco central / tasas al alza',
  },
  {
    keywords: ['rate cut', 'rate cuts', 'dovish', 'cutting rates', 'lower rates', 'easing'],
    targets: [
      { kind: 'asset', id: 'Bonds', tilt: 12 },
      { kind: 'sector', id: 'technology', tilt: 6 },
      { kind: 'asset', id: 'USD', tilt: -6 },
    ],
    label: 'postura dovish de banco central / recorte de tasas',
  },
  {
    keywords: ['recession', 'layoffs', 'unemployment', 'jobs report'],
    targets: [
      { kind: 'sector', id: 'cons_staples', tilt: 6 },
      { kind: 'sector', id: 'cons_discretionary', tilt: -8 },
      { kind: 'sector', id: 'financial', tilt: -6 },
    ],
    label: 'senales de debilidad economica',
  },
];

interface NewsFlowResult { assetTilts: Record<string, { tilt: number; reasons: string[] }>; sectorTilts: Record<string, { tilt: number; reasons: string[] }> }

function computeNewsFlowSignal(pool: Array<{ title: string }>): NewsFlowResult {
  const assetTilts: NewsFlowResult['assetTilts'] = {};
  const sectorTilts: NewsFlowResult['sectorTilts'] = {};
  for (const rule of NEWS_FLOW_RULES) {
    const hit = pool.find(h => rule.keywords.some(k => hasWord(h.title, k)));
    if (!hit) continue; // no real headline matched -- rule contributes nothing today
    const reason = `${rule.label}: "${hit.title}"`;
    for (const t of rule.targets) {
      const bucket = t.kind === 'asset' ? assetTilts : sectorTilts;
      bucket[t.id] ??= { tilt: 0, reasons: [] };
      bucket[t.id].tilt += t.tilt;
      bucket[t.id].reasons.push(reason);
    }
  }
  for (const bucket of [assetTilts, sectorTilts]) {
    for (const id of Object.keys(bucket)) bucket[id].tilt = clamp(bucket[id].tilt, -30, 30);
  }
  return { assetTilts, sectorTilts };
}

function scoreTitle(title: string): number {
  const t = title.toLowerCase();
  let s = 0;
  for (const w of CRISIS_WORDS)  if (hasWord(t, w)) s -= 2;
  for (const w of BEARISH_WORDS) if (hasWord(t, w)) s -= 1;
  for (const w of BULLISH_WORDS) if (hasWord(t, w)) s += 1;
  return Math.max(-4, Math.min(4, s));
}

function titleSentiment(score: number): 'bullish' | 'bearish' | 'neutral' {
  return score > 0 ? 'bullish' : score < 0 ? 'bearish' : 'neutral';
}

function parseRssItems(xml: string, source: string, category: NewsCategory, maxItems = 8): RawNewsItem[] {
  const items: RawNewsItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && items.length < maxItems) {
    const block  = m[1];
    const tMatch = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/);
    const dMatch = block.match(/<pubDate>(.*?)<\/pubDate>/);
    const lMatch = block.match(/<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>|<link>(https?:\/\/[^\s<]+)<\/link>/);
    const title  = tMatch ? (tMatch[1] ?? tMatch[2] ?? '').trim() : '';
    if (!title || title.length < 10) continue;
    const publishedAt = dMatch ? (new Date(dMatch[1]).getTime() || Date.now()) : Date.now();
    const url = lMatch ? (lMatch[1] ?? lMatch[2] ?? '').trim() : undefined;
    items.push({ title, source, publishedAt, url, category });
  }
  return items;
}

// â”€â”€â”€ Targeted Yahoo Finance news search, one query per category â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchYahooNews(query: string, category: NewsCategory, count = 8): Promise<RawNewsItem[]> {
  try {
    const result = await (yf as unknown as {
      search(q: string, opts: object): Promise<{
        news?: Array<{ title?: string; publisher?: string; providerPublishTime?: Date | number; link?: string }>;
      }>;
    }).search(query, { newsCount: count });
    if (!result?.news?.length) return [];
    return result.news
      .filter(n => n.title)
      .map(n => ({
        title: n.title!,
        source: n.publisher ?? 'Yahoo Finance',
        publishedAt:
          n.providerPublishTime instanceof Date ? n.providerPublishTime.getTime() :
          typeof n.providerPublishTime === 'number' ? n.providerPublishTime * 1000 : Date.now(),
        url: n.link ?? undefined,
        category,
      }));
  } catch { return []; }
}

async function fetchInvestingNews(): Promise<RawNewsItem[]> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://www.investing.com/rss/news_25.rss', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return [];
    return parseRssItems(await res.text(), 'Investing.com', 'empresas');
  } catch { return []; }
}

// Yahoo's news search() does not respect topical query intent -- it returns the
// same generic trending list regardless of the query text (verified empirically).
// Google News RSS search does real full-text matching, so it's the source for the
// geopolitics and economy/central-banks categories.
async function fetchGoogleNews(query: string, category: NewsCategory, maxItems = 8): Promise<RawNewsItem[]> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return [];
    return parseRssItems(await res.text(), 'Google News', category, maxItems);
  } catch { return []; }
}

// â”€â”€â”€ Main handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function GET() {
  try {
    const assetSyms          = Object.values(ASSET_SYMBOLS);
    const sectorSyms         = Object.values(SECTOR_SYMBOLS);
    const countrySyms        = Object.values(COUNTRY_ETF_SYMBOLS).filter((s): s is string => s !== null);
    const macroSyms          = ['^VIX', '^TNX', '^IRX', 'HYG', '^MOVE'];
    const countrySectorSyms  = Object.values(COUNTRY_SECTOR_SYMBOLS).flatMap(m => Object.values(m));
    // Additional instruments for asset-level institutional pressure
    const assetAuxSyms       = ['BZ=F', 'ZB=F', '^N225', 'GLD', 'IBIT', 'USO', 'UUP', 'SPY'];
    const allSymbols         = [...new Set([...assetSyms, ...sectorSyms, ...countrySyms, ...macroSyms, ...countrySectorSyms, ...assetAuxSyms])];

    const [rawQuotes, companyNews, geoNews, econNews, generalNews, investingNews, rawOptions] = await Promise.all([
      Promise.all(allSymbols.map(sym => (yf.quote(sym) as Promise<YFQuote>).catch(() => null))),
      fetchYahooNews('stock market company earnings corporate results', 'empresas', 10),
      fetchGoogleNews('geopolitics OR sanctions OR tariffs OR war OR "trade war" when:2d', 'geopolitica', 8),
      fetchGoogleNews('inflation OR "Federal Reserve" OR "interest rates" OR "central bank" OR ECB OR "Bank of Japan" OR "Bank of England" when:2d', 'economia', 8),
      fetchYahooNews('market economy stocks global finance', 'empresas', 10),
      fetchInvestingNews(),
      Promise.all(OPTIONS_SYMS.map(sym => fetchOptionsMetrics(sym))),
    ]);
    // Re-classify by keyword regardless of which query surfaced the headline --
    // Yahoo's search relevance is unreliable for topical (non-ticker) queries.
    const yahooNews = [...companyNews, ...geoNews, ...econNews, ...generalNews]
      .map(item => ({ ...item, category: classifyNews(item.title) }));
    const optionsMap: Record<string, OptionsMetrics> = {};
    OPTIONS_SYMS.forEach((sym, i) => { optionsMap[sym] = rawOptions[i]; });
    const quotes = rawQuotes;
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

    // â”€â”€ News sentiment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Per-category cap (not a single global recency slice) so geopolitics/economy news
    // can't get crowded out by a faster-moving stream of company headlines.
    const classifiedInvestingNews = investingNews.map(item => ({ ...item, category: classifyNews(item.title) }));
    const byCategory = (cat: NewsCategory) => [...yahooNews, ...classifiedInvestingNews]
      .filter(n => n.category === cat)
      .sort((a, b) => b.publishedAt - a.publishedAt);
    const allNewsRaw = [
      ...byCategory('empresas').slice(0, 6),
      ...byCategory('geopolitica').slice(0, 4),
      ...byCategory('economia').slice(0, 4),
    ].sort((a, b) => b.publishedAt - a.publishedAt);
    const scoredNews = allNewsRaw.map(item => ({ ...item, score: scoreTitle(item.title) }));
    const newsAvgScore = scoredNews.length > 0
      ? scoredNews.reduce((a, b) => a + b.score, 0) / scoredNews.length
      : 0;
    const newsSentimentScore = parseFloat(Math.max(-1, Math.min(1, newsAvgScore / 3)).toFixed(3));

    // Price-only regime
    const priceRegime: 'risk-on' | 'risk-off' | 'crisis' | 'neutral' =
      vix > 30 || (vix > 24 && vixChg > 8) ? 'crisis' :
      vix < 18 && vixChg < 5               ? 'risk-on' :
      vix < 20                              ? 'risk-on' :
      vix > 24 || vixChg > 5               ? 'risk-off' :
      'neutral';

    // News adjusts neutral regimes; crisis overrides all
    const regime: 'risk-on' | 'risk-off' | 'crisis' | 'neutral' =
      priceRegime === 'crisis'                                 ? 'crisis' :
      priceRegime === 'neutral' && newsSentimentScore < -0.40  ? 'risk-off' :
      priceRegime === 'neutral' && newsSentimentScore >  0.40  ? 'risk-on' :
      priceRegime === 'risk-on'  && newsSentimentScore < -0.60 ? 'neutral' :
      priceRegime === 'risk-off' && newsSentimentScore >  0.60 ? 'neutral' :
      priceRegime;

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

    // â”€â”€ Asset institutional pressure (price/vol 40% + GEX/PCR 60%) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Mirrors sector logic. Oil = WTI+Brent avg. Bonds = TLT+ZB=F futures âˆ’ ^TNX
    // yield change. Crypto = BTC-USD + IBIT options. News sentiment overlaid.
    const ap = (sym: string, optSym?: string): number => {
      const pp = computeInstitutionalPressure(quoteMap[sym] ?? {}, regimeMult);
      const op = optSym ? (optionsMap[optSym]?.optionsPressure ?? 0) : 0;
      return clamp(pp * 0.40 + op * 0.60, -100, 100);
    };
    const assetPressures: Record<string, number> = {
      'USD':              ap('DX-Y.NYB', 'UUP'),
      'Europe':           ap('EZU',      'EZU'),
      'Emerging Markets': ap('EEM',      'EEM'),
      'Gold':             ap('GLD',      'GLD'),
      'Norte America':    clamp(ap('QQQ', 'QQQ') * 0.6 + ap('SPY') * 0.4, -100, 100),
      'Asia':             clamp(ap('EWJ', 'EWJ') * 0.6 + ap('^N225') * 0.4, -100, 100),
      'Bonds':            clamp(
        ap('TLT', 'TLT') * 0.50 +
        ap('ZB=F')        * 0.30 +
        (-computeInstitutionalPressure(quoteMap['^TNX'] ?? {}, regimeMult)) * 0.20,
        -100, 100
      ),
      'Crypto':           clamp(ap('BTC-USD') * 0.50 + ap('IBIT', 'IBIT') * 0.50, -100, 100),
      'Oil':              clamp(ap('CL=F', 'USO') * 0.50 + ap('BZ=F') * 0.50, -100, 100),
    };
    // News sentiment: direct market-reality overlay on all asset nodes
    const newsBoost = clamp(newsSentimentScore * 25, -20, 20);
    for (const id of Object.keys(assetPressures)) {
      assetPressures[id] = clamp((assetPressures[id] ?? 0) + newsBoost, -100, 100);
    }

    // News → flow rules: targeted tilts, only from rules matched by a real headline today
    const newsFlow = computeNewsFlowSignal(scoredNews);
    for (const [id, t] of Object.entries(newsFlow.assetTilts)) {
      assetPressures[id] = clamp((assetPressures[id] ?? 0) + t.tilt, -100, 100);
    }

    // â”€â”€ Asset metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      const pressure  = assetPressures[id] ?? 0;
      const masaAdj   = Math.round(clamp(raw.masa + clamp(pressure / 5, -15, 15), 0, 100));
      const fuerzaG   = parseFloat(((masaAdj - distancia) / Math.max(1, raw.friccion)).toFixed(2));
      const { distanciaRaw: _dr, changePercent: _cp, ...rest } = raw;
      metrics[id] = {
        ...rest,
        masa: masaAdj,
        distancia,
        fuerzaG,
        masaJustificacion: (rest.masaJustificacion ?? '') + ` | P=${pressure.toFixed(0)} adj=${masaAdj}`,
      };
    }

    // Gravity centers: mean + 0.5Ïƒ of fuerzaG â€” same dynamic threshold as sectors
    const afForces = Object.values(metrics).map(m => m.fuerzaG ?? 0);
    const afMean   = afForces.reduce((a, b) => a + b, 0) / afForces.length;
    const afSigma  = Math.sqrt(afForces.reduce((a, b) => a + (b - afMean) ** 2, 0) / afForces.length);
    const afHighT  = afMean + 0.5 * afSigma;
    const gravityCenters = Object.entries(metrics)
      .filter(([, m]) => (m.fuerzaG ?? 0) >= afHighT)
      .map(([id]) => id);

    const flows = computeFlows(metrics);

    // â”€â”€ Global sector metrics (US baseline) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Rotation model: price/volume proxy + real GEX/PCR from options â”€â”€â”€â”€â”€â”€â”€â”€
    const blend = (pricePressure: number, sym: string) =>
      clamp(pricePressure * 0.4 + (optionsMap[sym]?.optionsPressure ?? 0) * 0.6, -100, 100);

    const sectorPressures: Record<string, number> = {};
    for (const [sectorId, sym] of Object.entries(SECTOR_SYMBOLS)) {
      sectorPressures[sectorId] = blend(computeInstitutionalPressure(quoteMap[sym] ?? {}, regimeMult), sym);
    }
    for (const [id, t] of Object.entries(newsFlow.sectorTilts)) {
      sectorPressures[id] = clamp((sectorPressures[id] ?? 0) + t.tilt, -100, 100);
    }
    const auxPressures = {
      gold:         blend(computeInstitutionalPressure(quoteMap[ASSET_SYMBOLS['Gold']]          ?? {}, regimeMult), 'GLD'),
      bonds:        blend(computeInstitutionalPressure(quoteMap[ASSET_SYMBOLS['Bonds']]         ?? {}, regimeMult), 'TLT'),
      norteAmerica: blend(computeInstitutionalPressure(quoteMap[ASSET_SYMBOLS['Norte America']] ?? {}, regimeMult), 'QQQ'),
    };
    const rotationResult = computeSectorRotationSignal(sectorPressures, auxPressures);

    // Apply institutional pressure bonus to MASA (Â±12 pts max)
    const pressuredGlobalNodes = globalNodes.map(node => ({
      ...node,
      masa: clamp(node.masa + clamp((sectorPressures[node.id] ?? 0) / 8, -12, 12), 0, 100),
    }));

    // sectorData = EE.UU. â€” rotation-enhanced mean+0.5Ïƒ threshold
    const usSectorRaw = pressuredGlobalNodes.map(({ id, masa, distancia }) => ({ id, masa, distancia }));
    const usPressureAdj = usSectorRaw.map(n => ({
      ...n,
      adjustedForce: (n.masa - n.distancia) + clamp((sectorPressures[n.id] ?? 0) / 5, -15, 15),
    }));
    const usF     = usPressureAdj.map(n => n.adjustedForce);
    const usMean  = usF.reduce((a, b) => a + b, 0) / usF.length;
    const usSigma = Math.sqrt(usF.reduce((a, b) => a + (b - usMean) ** 2, 0) / usF.length);
    const usHighT = usMean + 0.5 * usSigma;
    const usSectorNodes = usPressureAdj.map(n => ({
      id: n.id, masa: n.masa, distancia: n.distancia,
      isGravityCenter: n.adjustedForce >= usHighT,
    }));
    const usSectorFlows = computeSectorFlowsCalibrated(usSectorNodes, zscoreFlows);

    // â”€â”€ Per-country sector data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const countrySectorData: Record<string, {
      nodes: Array<{ id: string; masa: number; distancia: number; isGravityCenter: boolean }>;
      flows: Array<{ from: string; to: string; strength: number }>;
    }> = {};

    for (const [countryName, etfSym] of Object.entries(COUNTRY_ETF_SYMBOLS)) {
      const countryQuote = etfSym ? (quoteMap[etfSym] ?? null) : null;

      // Build country-specific sectorPressures: country price/vol signal (60%) + US options (40%).
      // Sectors without a country-specific ticker fall back to the global US ETF pressure.
      const countrySPs: Record<string, number> = { ...sectorPressures };
      const countrySectorSymMap = COUNTRY_SECTOR_SYMBOLS[countryName] ?? {};
      for (const [sectorId, ticker] of Object.entries(countrySectorSymMap)) {
        const cq = quoteMap[ticker];
        if (cq) {
          const countryPricePressure = computeInstitutionalPressure(cq, regimeMult);
          const usOptionsPressure    = optionsMap[SECTOR_SYMBOLS[sectorId] ?? '']?.optionsPressure ?? 0;
          countrySPs[sectorId]       = clamp(countryPricePressure * 0.6 + usOptionsPressure * 0.4, -100, 100);
        }
      }

      const nodes = computeCountrySectorNodes(pressuredGlobalNodes, countryQuote, countryName, macro, countrySPs);
      countrySectorData[countryName] = {
        nodes,
        flows: computeSectorFlowsCalibrated(nodes, zscoreFlows),
      };
    }

    // â”€â”€ Assemble scenario â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const newsHeadlines = scoredNews.slice(0, 14).map(({ title, source, publishedAt, score, url, category }) => ({
      title, source, publishedAt, url, category,
      sentiment: titleSentiment(score),
    }));
    const newsSentiment = titleSentiment(newsAvgScore > 0.5 ? 1 : newsAvgScore < -0.5 ? -1 : 0);

    const newsFlowSignal: Record<string, { tilt: number; reasons: string[] }> = {
      ...newsFlow.assetTilts,
      ...newsFlow.sectorTilts,
    };

    const aiDescription = await generateAIDescription(
      regime, vix, us10y, gravityCenters, metrics,
      newsHeadlines, assetPressures, rotationResult.signal,
      countrySectorData, newsFlowSignal,
    );

    const scenario: MarketScenario = {
      id:               'live',
      name:             'Realidad del Mercado en Vivo',
      description:      aiDescription,
      macroRegime:      regime,
      regimeWeights:    weights,
      gravityCenters,
      flows,
      metrics,
      sectorData:       { nodes: usSectorNodes, flows: usSectorFlows },
      countrySectorData,
      lastUpdated:      Date.now(),
      rotationSignal:   rotationResult.signal,
      newsFlowSignal,
      newsContext: {
        headlines:      newsHeadlines,
        sentimentScore: newsSentimentScore,
        newsSentiment,
        regimeSignal:   priceRegime !== regime
          ? `Noticias ajustaron rÃ©gimen: ${priceRegime} â†’ ${regime}`
          : `RÃ©gimen confirmado por precios y noticias: ${regime}`,
      },
    };

    return NextResponse.json(scenario);
  } catch (error) {
    console.error('Live analysis error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Failed to fetch live analysis', detail: message }, { status: 500 });
  }
}



