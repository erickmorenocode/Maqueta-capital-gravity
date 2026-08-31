import YahooFinance from 'yahoo-finance2';
import type { CompanyGravityResult } from '@/src/data';
import { GEO_EVENTS } from '@/src/data';

// ─── Yahoo Finance quote interface ────────────────────────────────────────────
export interface YFQuote {
  regularMarketPrice?: number;
  regularMarketOpen?: number;
  regularMarketChangePercent?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  fiftyDayAverage?: number;
  trailingEps?: number;
  earningsQuarterlyGrowth?: number;
  returnOnEquity?: number;
  trailingAnnualDividendYield?: number;
  marketCap?: number;
  regularMarketVolume?: number;
  averageDailyVolume3Month?: number;
  bid?: number;
  ask?: number;
}

export const yf = new YahooFinance();

// ─── Compact geopolitical-events snapshot (editorial data, not a live feed) ───
export function getGeoEventsSnapshot() {
  return GEO_EVENTS.map(e => ({
    id: e.id, name: e.name, type: e.type, severity: e.severity, countries: e.countries,
  }));
}

// ─── Country-specific transaction costs ───────────────────────────────────────
// UNCALIBRATED: reasonable brokerage/exchange-fee estimates per market, not sourced
// from a specific broker/exchange fee schedule, and never validated against G's
// actual predictive power. Treat as a design assumption, not a verified fact.
export const COUNTRY_TX_COSTS: Record<string, number> = {
  'EE.UU.': 0.05, 'Canadá': 0.10, 'Francia': 0.12, 'Alemania': 0.12,
  'Italia': 0.15, 'Japón': 0.18, 'Reino Unido': 0.13,
};

// ─── Sector ETF symbols (for betaPremium baseline) ────────────────────────────
export const SECTOR_ETFS: Record<string, string> = {
  technology: 'XLK', communication: 'XLC', cons_discretionary: 'XLY',
  cons_staples: 'XLP', energy: 'XLE', financial: 'XLF', healthcare: 'XLV',
  industrials: 'XLI', real_estate: 'XLRE', basic_materials: 'XLB', utilities: 'XLU',
};

// ─── Regime weights (mirrors live-analysis) ───────────────────────────────────
// UNCALIBRATED: how much Return/Growth/Liquidity/Confidence should count toward MASA
// per macro regime is a design heuristic (more weight on Return/Growth when risk-on,
// more on Liquidity/Confidence when risk-off/crisis makes intuitive sense) -- it has
// never been fit or backtested against realized returns. See the audit recommendation
// on backtesting (2026-08-31) before treating these numbers as validated.
export const REGIME_WEIGHTS: Record<string, { w1: number; w2: number; w3: number; w4: number }> = {
  'risk-on':  { w1: 0.40, w2: 0.35, w3: 0.15, w4: 0.10 },
  'risk-off': { w1: 0.15, w2: 0.10, w3: 0.35, w4: 0.40 },
  'crisis':   { w1: 0.05, w2: 0.05, w3: 0.45, w4: 0.45 },
  'neutral':  { w1: 0.25, w2: 0.25, w3: 0.25, w4: 0.25 },
};

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

// ─── Black-Scholes gamma ──────────────────────────────────────────────────────
export function bsGamma(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  return Math.exp(-0.5 * d1 * d1) / (Math.sqrt(2 * Math.PI) * S * sigma * Math.sqrt(T));
}

// ─── Options metrics (GEX + PCR via Black-Scholes) ───────────────────────────
export interface OptionsResult {
  optionsPressure: number;
  putCallRatio: number;
  gammaFlip: number | null;
}
export const OPTIONS_ZERO: OptionsResult = { optionsPressure: 0, putCallRatio: 1, gammaFlip: null };

export async function fetchOptionsMetrics(sym: string): Promise<OptionsResult> {
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

    const R = 0.05;
    const now = Date.now();
    let callGex = 0, putGex = 0, callVol = 0, putVol = 0;
    const strikeGex: Record<number, number> = {};

    for (const chain of result.options.slice(0, 2)) {
      const T = (chain.expirationDate.getTime() - now) / (365.25 * 24 * 3600 * 1000);
      if (T <= 0) continue;
      for (const c of chain.calls) {
        const K = c.strike ?? 0; const oi = c.openInterest ?? 0;
        if (K <= 0 || oi <= 0) continue;
        const g = bsGamma(spot, K, T, R, c.impliedVolatility ?? 0.3) * oi * 100 * spot * spot / 100;
        callGex += g; callVol += (c.volume ?? 0);
        strikeGex[K] = (strikeGex[K] ?? 0) + g;
      }
      for (const p of chain.puts) {
        const K = p.strike ?? 0; const oi = p.openInterest ?? 0;
        if (K <= 0 || oi <= 0) continue;
        const g = bsGamma(spot, K, T, R, p.impliedVolatility ?? 0.3) * oi * 100 * spot * spot / 100;
        putGex += g; putVol += (p.volume ?? 0);
        strikeGex[K] = (strikeGex[K] ?? 0) - g;
      }
    }

    let cum = 0, gammaFlip: number | null = null;
    for (const s of Object.keys(strikeGex).map(Number).sort((a, b) => a - b)) {
      const prev = cum; cum += strikeGex[s];
      if (prev !== 0 && Math.sign(prev) !== Math.sign(cum)) { gammaFlip = s; break; }
    }

    const total = callGex + putGex;
    const gexScore = total > 0 ? clamp(((callGex / total) - 0.5) * 200, -100, 100) : 0;
    const pcrScore = clamp((1 - (callVol > 0 ? putVol / callVol : 1)) * 50, -100, 100);

    return {
      optionsPressure: clamp(gexScore * 0.6 + pcrScore * 0.4, -100, 100),
      putCallRatio: callVol > 0 ? putVol / callVol : 1,
      gammaFlip,
    };
  } catch { return OPTIONS_ZERO; }
}

// ─── Compute full G for a single company ──────────────────────────────────────
export function computeCompanyG(
  quote: YFQuote,
  opts: OptionsResult,
  vix: number,
  us10y: number,
  us2y: number,
  move: number,
  hygStress: number,
  regime: string,
  regimeMult: number,
  weights: { w1: number; w2: number; w3: number; w4: number },
  sectorChangePct: number,
  country: string,
): Omit<CompanyGravityResult, 'ticker' | 'name' | 'isGravityCenter' | 'tier' | 'error'> {
  const price    = quote.regularMarketPrice         ?? 100;
  const open     = quote.regularMarketOpen          ?? price;
  const low52    = quote.fiftyTwoWeekLow            ?? price * 0.80;
  const high52   = quote.fiftyTwoWeekHigh           ?? price * 1.20;
  const avg50    = quote.fiftyDayAverage            ?? price;
  const changePct = quote.regularMarketChangePercent ?? 0;
  const vol      = quote.regularMarketVolume        ?? 0;
  const avgVol   = (quote.averageDailyVolume3Month ?? vol) || 1;
  const mktCap   = quote.marketCap                 ?? 1e9;

  const rangeW    = high52 - low52;
  const midPrice  = (high52 + low52) / 2;
  const annualRange = midPrice > 0 ? (rangeW / midPrice) * 100 : 20;

  // ── MASA components ──────────────────────────────────────────────────────
  const priceReturn   = Math.round(rangeW > 0 ? clamp((price - low52) / rangeW * 100, 0, 100) : 50);
  const momentum50d   = Math.round(clamp((price / (avg50 || price) - 1) * 200 + 50, 0, 100));
  const dailyReturn   = Math.round(clamp(50 + changePct * 5, 0, 100));
  const earningsYield = quote.trailingEps && quote.trailingEps > 0 && price > 0
    ? Math.round(clamp(quote.trailingEps / price * 1000, 0, 100))
    : 50;

  const epsGrowth  = Math.round(clamp(50 + (quote.earningsQuarterlyGrowth ?? 0) * 100, 0, 100));
  const roeScore   = Math.round(clamp(50 + (quote.returnOnEquity ?? 0) * 150, 0, 100));
  const divYield   = Math.round(clamp((quote.trailingAnnualDividendYield ?? 0) * 200, 0, 100));

  const volumeScore   = Math.round(clamp(vol / avgVol * 50, 0, 100));
  const mktCapScore   = Math.round(clamp(Math.log10(mktCap) / Math.log10(5e10) * 100, 0, 100));

  // Price+volume institutional pressure (for Confidence component)
  const priceMomentum = avg50 > 0 ? (price / avg50 - 1) * 200 : 0;
  const volSurge      = avgVol > 0 ? (vol / avgVol - 1) * 30 : 0;
  const priceVolPress = clamp((priceMomentum * 0.5 + volSurge * 0.3 + changePct * 5 * 0.2) * regimeMult, -100, 100);

  // Options institutional pressure
  const optionsPressure = opts.optionsPressure;
  const institutionalPressure = clamp(priceVolPress * 0.40 + optionsPressure * 0.60, -100, 100);
  const instScore = Math.round(clamp(50 + institutionalPressure * 0.3, 0, 100));

  const Return     = priceReturn * 0.20 + momentum50d * 0.20 + dailyReturn * 0.30 + earningsYield * 0.30;
  const Growth     = epsGrowth * 0.5 + roeScore * 0.3 + divYield * 0.2;
  const Liquidity  = volumeScore * 0.5 + mktCapScore * 0.3 + divYield * 0.2;
  const Confidence = momentum50d * 0.4 + roeScore * 0.3 + instScore * 0.3;

  const masa = Math.round(clamp(
    weights.w1 * Return + weights.w2 * Growth + weights.w3 * Liquidity + weights.w4 * Confidence,
    0, 100
  ));

  // MASA adjusted by institutional pressure
  const masaAdj = Math.round(clamp(masa + clamp(institutionalPressure / 5, -15, 15), 0, 100));

  // ── DISTANCIA components ─────────────────────────────────────────────────
  const impliedVol  = annualRange * (vix / 20) * 0.40;
  const histVol     = annualRange * 0.35;
  const moveContrib = move > 0 ? move / 100 * 5 : 2;
  const Volatilidad = clamp(impliedVol + histVol + moveContrib, 0, 60);

  const betaPremium = Math.abs(changePct - sectorChangePct) * 2;
  const cpiBase     = country === 'Japón' ? 2.8 : country === 'Reino Unido' ? 3.5 : 3.0;
  const Spread      = hygStress * regimeMult * 0.3 + betaPremium * 0.3 + cpiBase * 0.5 + clamp((us10y - us2y) * 5, 0, 20);

  const rho = regime === 'crisis' ? 0.85 : regime === 'risk-off' ? 0.70 : regime === 'risk-on' ? 0.35 : 0.50;
  const distanciaRaw = Volatilidad + Spread + (1 - rho) * 30;
  // Normalize to [10, 90]
  const distancia = Math.round(clamp(distanciaRaw / 1.2, 10, 90));

  // ── FRICCIÓN components ──────────────────────────────────────────────────
  const bidAsk = quote.bid && quote.ask && quote.bid > 0 && price > 0
    ? (quote.ask - quote.bid) / price * 100 * 20
    : 1.0;
  const slippage = clamp(15 - Math.log10(Math.max(mktCap, 1e6)) + 9, 0, 15) * 0.5;
  const txCost   = (COUNTRY_TX_COSTS[country] ?? 0.10) * 2;
  const liqBonus = clamp((vol / Math.max(avgVol, 1) - 1) * 10, -10, 10);
  const friccion = Math.round(clamp((bidAsk + slippage + txCost - liqBonus) * regimeMult, 1, 30));

  // ── Final G ──────────────────────────────────────────────────────────────
  const fuerzaG = parseFloat(((masaAdj - distancia) / Math.max(1, friccion)).toFixed(2));

  return {
    price,
    open,
    changePct,
    masa: masaAdj,
    distancia,
    friccion,
    fuerzaG,
    institutionalPressure: parseFloat(institutionalPressure.toFixed(1)),
    optionsPressure: parseFloat(optionsPressure.toFixed(1)),
    gammaFlip: opts.gammaFlip,
    putCallRatio: parseFloat(opts.putCallRatio.toFixed(2)),
    masaComponents: { retorno: priceReturn, crecimiento: epsGrowth, liquidez: volumeScore, confianza: Math.round(Confidence) },
    marketCap: mktCap,
  };
}

// ─── Compute G for a macro asset (index/ETF/future/crypto — no EPS/ROE/dividend) ──
export function computeAssetG(
  quote: YFQuote,
  opts: OptionsResult,
  vix: number,
  us10y: number,
  us2y: number,
  move: number,
  hygStress: number,
  regime: string,
  regimeMult: number,
  weights: { w1: number; w2: number; w3: number; w4: number },
): Omit<CompanyGravityResult, 'ticker' | 'name' | 'isGravityCenter' | 'tier' | 'error'> {
  const price    = quote.regularMarketPrice         ?? 100;
  const open     = quote.regularMarketOpen          ?? price;
  const low52    = quote.fiftyTwoWeekLow            ?? price * 0.80;
  const high52   = quote.fiftyTwoWeekHigh           ?? price * 1.20;
  const avg50    = quote.fiftyDayAverage            ?? price;
  const changePct = quote.regularMarketChangePercent ?? 0;
  const vol      = quote.regularMarketVolume        ?? 0;
  const avgVol   = (quote.averageDailyVolume3Month ?? vol) || 1;
  const mktCap   = quote.marketCap                 ?? 1e9;

  const rangeW    = high52 - low52;
  const midPrice  = (high52 + low52) / 2;
  const annualRange = midPrice > 0 ? (rangeW / midPrice) * 100 : 20;

  // ── MASA: no Growth component (no EPS/ROE/dividend at index/future/crypto level) ──
  const priceReturn = Math.round(rangeW > 0 ? clamp((price - low52) / rangeW * 100, 0, 100) : 50);
  const momentum50d = Math.round(clamp((price / (avg50 || price) - 1) * 200 + 50, 0, 100));
  const dailyReturn = Math.round(clamp(50 + changePct * 5, 0, 100));

  const volumeScore = Math.round(clamp(vol / avgVol * 50, 0, 100));

  const priceMomentum = avg50 > 0 ? (price / avg50 - 1) * 200 : 0;
  const volSurge      = avgVol > 0 ? (vol / avgVol - 1) * 30 : 0;
  const priceVolPress = clamp((priceMomentum * 0.5 + volSurge * 0.3 + changePct * 5 * 0.2) * regimeMult, -100, 100);

  const optionsPressure = opts.optionsPressure;
  const hasOptionsData = !(opts.optionsPressure === 0 && opts.putCallRatio === 1 && opts.gammaFlip === null);
  const institutionalPressure = hasOptionsData
    ? clamp(priceVolPress * 0.40 + optionsPressure * 0.60, -100, 100)
    : clamp(priceVolPress, -100, 100);
  const instScore = Math.round(clamp(50 + institutionalPressure * 0.3, 0, 100));

  const Return     = priceReturn * 0.20 + momentum50d * 0.20 + dailyReturn * 0.30 + 50 * 0.30;
  const Liquidity  = volumeScore;
  const Confidence = momentum50d * 0.4 + instScore * 0.6;

  // Growth-less renormalization: w1+w2 -> Return, w3 -> Liquidity, w4 -> Confidence
  const wReturn = weights.w1 + weights.w2;
  const masa = Math.round(clamp(wReturn * Return + weights.w3 * Liquidity + weights.w4 * Confidence, 0, 100));
  const masaAdj = Math.round(clamp(masa + clamp(institutionalPressure / 5, -15, 15), 0, 100));

  // ── DISTANCIA: same shape as computeCompanyG, no sector-ETF benchmark (sectorChangePct = 0) ──
  const impliedVol  = annualRange * (vix / 20) * 0.40;
  const histVol     = annualRange * 0.35;
  const moveContrib = move > 0 ? move / 100 * 5 : 2;
  const Volatilidad = clamp(impliedVol + histVol + moveContrib, 0, 60);

  const betaPremium = Math.abs(changePct - 0) * 2;
  const cpiBase     = 3.0;
  const Spread      = hygStress * regimeMult * 0.3 + betaPremium * 0.3 + cpiBase * 0.5 + clamp((us10y - us2y) * 5, 0, 20);

  const rho = regime === 'crisis' ? 0.85 : regime === 'risk-off' ? 0.70 : regime === 'risk-on' ? 0.35 : 0.50;
  const distanciaRaw = Volatilidad + Spread + (1 - rho) * 30;
  const distancia = Math.round(clamp(distanciaRaw / 1.2, 10, 90));

  // ── FRICCIÓN: same shape, flat US-equivalent transaction cost (liquid USD instruments) ──
  const bidAsk = quote.bid && quote.ask && quote.bid > 0 && price > 0
    ? (quote.ask - quote.bid) / price * 100 * 20
    : 1.0;
  const slippage = clamp(15 - Math.log10(Math.max(mktCap, 1e6)) + 9, 0, 15) * 0.5;
  const txCost   = COUNTRY_TX_COSTS['EE.UU.'] * 2;
  const liqBonus = clamp((vol / Math.max(avgVol, 1) - 1) * 10, -10, 10);
  const friccion = Math.round(clamp((bidAsk + slippage + txCost - liqBonus) * regimeMult, 1, 30));

  const fuerzaG = parseFloat(((masaAdj - distancia) / Math.max(1, friccion)).toFixed(2));

  return {
    price,
    open,
    changePct,
    masa: masaAdj,
    distancia,
    friccion,
    fuerzaG,
    institutionalPressure: parseFloat(institutionalPressure.toFixed(1)),
    optionsPressure: parseFloat(optionsPressure.toFixed(1)),
    gammaFlip: opts.gammaFlip,
    putCallRatio: parseFloat(opts.putCallRatio.toFixed(2)),
    masaComponents: { retorno: priceReturn, crecimiento: 0, liquidez: volumeScore, confianza: Math.round(Confidence) },
    marketCap: mktCap,
  };
}

// ─── Regime classification from global macro quotes ───────────────────────────
export interface MacroContext {
  vix: number; vixChg: number; us10y: number; us2y: number; move: number;
  hygStress: number;
  regime: 'risk-on' | 'risk-off' | 'crisis' | 'neutral';
  regimeMult: number;
  weights: { w1: number; w2: number; w3: number; w4: number };
}

export async function fetchMacroContext(): Promise<MacroContext> {
  const macroSyms = ['^VIX', '^TNX', '^IRX', 'HYG', '^MOVE'];
  const quotes = await Promise.all(macroSyms.map(s => (yf.quote(s) as Promise<YFQuote>).catch(() => null)));
  const macroMap: Record<string, YFQuote> = {};
  macroSyms.forEach((s, i) => { if (quotes[i]) macroMap[s] = quotes[i]!; });

  const vix    = macroMap['^VIX']?.regularMarketPrice  ?? 20;
  const vixChg = macroMap['^VIX']?.regularMarketChangePercent ?? 0;
  const us10y  = macroMap['^TNX']?.regularMarketPrice  ?? 4.3;
  const us2y   = macroMap['^IRX']?.regularMarketPrice  ?? 4.7;
  const move   = macroMap['^MOVE']?.regularMarketPrice ?? 0;

  const hygQ      = macroMap['HYG'];
  const hygHigh52 = hygQ?.fiftyTwoWeekHigh ?? ((hygQ?.regularMarketPrice ?? 80) * 1.05);
  const hygStress = hygQ
    ? clamp((1 - (hygQ.regularMarketPrice ?? hygHigh52) / hygHigh52) * 100, 0, 50)
    : 10;

  const regime: MacroContext['regime'] =
    vix > 30 || (vix > 24 && vixChg > 8) ? 'crisis' :
    vix < 20                              ? 'risk-on' :
    vix > 24 || vixChg > 5               ? 'risk-off' : 'neutral';

  const regimeMult = regime === 'crisis' ? 1.5 : regime === 'risk-off' ? 1.2 : 1.0;
  const weights    = REGIME_WEIGHTS[regime];

  return { vix, vixChg, us10y, us2y, move, hygStress, regime, regimeMult, weights };
}

// ─── Assign gravity-center tiers within a group via mean ± 0.5σ ───────────────
// UNCALIBRATED: the 0.5σ multiplier (vs. 0.3σ, 1σ, or a percentile-based cut) was
// picked by feel, not fit against how well "gravity center" status predicted forward
// returns. Groups also tend to be small (~10 companies per country/sector), so the
// sample sigma itself is noisy -- one outlier can swing the whole group's threshold.
export function assignTiers(results: CompanyGravityResult[]): void {
  const validForces = results.filter(r => !r.error).map(r => r.fuerzaG);
  if (validForces.length === 0) return;
  const mean  = validForces.reduce((a, b) => a + b, 0) / validForces.length;
  const sigma = Math.sqrt(validForces.reduce((a, b) => a + (b - mean) ** 2, 0) / validForces.length);
  const highT = mean + 0.5 * sigma;
  const lowT  = mean - 0.5 * sigma;
  for (const r of results) {
    if (!r.error) {
      r.isGravityCenter = r.fuerzaG >= highT;
      r.tier = r.fuerzaG >= highT ? 'high' : r.fuerzaG >= lowT ? 'medium' : 'low';
    }
  }
}
