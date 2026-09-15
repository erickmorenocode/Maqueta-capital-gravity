/**
 * Prueba OFFLINE RAPIDA (no toca engine.ts ni DensityLab.tsx) de sumar
 * EWY (iShares MSCI South Korea ETF) al universo de M2. Motivo: mercado
 * de un pais con ciclo propio (exportaciones/semiconductores, macro
 * asiatica) -- podria dar dispersion real en periodos donde el S&P sube
 * parejo y no hay a donde rotar dentro de EE.UU. (el problema que
 * diagnosticamos en Validacion antes de sumar GLD/QQQ).
 *
 * LIMITACION CONOCIDA (deliberada, solo para ver si vale la pena antes
 * de invertir en parsear EDGAR real): EWY vive en un trust de iShares
 * (probablemente el mismo tipo de filer multi-fondo que TLT, no
 * verificado aun) -- caro de aislar de forma confiable como el Select
 * Sector SPDR Trust (11 fondos) o QQQ (un fondo solo). Para esta prueba
 * rapida, EWY usa market cap/shares ACTUALES (hoy) aplicados constante a
 * toda la serie -- el mismo sesgo de look-ahead que ya se arreglo para
 * el resto (mismo approach que se uso para TLT, que dio resultado
 * negativo). Si mejora igual con este dato debil, vale la pena parsear
 * EDGAR real. Si no ayuda ni con el mejor caso, no vale la pena.
 *
 * Correr con:
 *   node --experimental-strip-types scripts/testEwyUniverse.mjs
 */

import YahooFinance from 'yahoo-finance2';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engine = await import('../src/lib/densityLab/engine.ts');

const {
  SECTOR_ETFS,
  BACKTEST_START,
  BACKTEST_END,
  VALIDATION_START,
  VALIDATION_END,
  computeAllSectorsDensity,
  sliceWindow,
  simulateIcdExitStrategy,
  computeStrategyStats,
  buyAndHoldCurve,
} = engine;

const ROLLING_WINDOW = 42;
const LOOKBACK_DAYS = 9;
const FREE_FLOAT_RATIO = 0.95;

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

async function downloadPriceHistory(ticker, start, end) {
  try {
    const res = await yf.chart(ticker, { period1: start, period2: end, interval: '1d' });
    return res.quotes
      .filter((q) => q.close !== null && q.close !== undefined && q.volume !== null && q.volume !== undefined)
      .map((q) => ({
        date: q.date.toISOString().slice(0, 10),
        open: q.open ?? q.close,
        high: q.high ?? q.close,
        low: q.low ?? q.close,
        close: q.adjclose ?? q.close,
        volume: q.volume,
      }));
  } catch {
    return [];
  }
}

async function fetchTickerStaticInfo(ticker) {
  try {
    const qs = await yf.quoteSummary(ticker, { modules: ['defaultKeyStatistics', 'price'] });
    const dks = qs.defaultKeyStatistics ?? {};
    const price = qs.price ?? {};
    const totalAssets = dks.totalAssets;
    const lastPrice = price.regularMarketPrice;
    let marketCap = price.marketCap;
    let sharesOutstanding = dks.sharesOutstanding;
    if (marketCap === undefined) marketCap = totalAssets;
    if (sharesOutstanding === undefined) {
      if (totalAssets && lastPrice) sharesOutstanding = totalAssets / lastPrice;
      else if (marketCap && lastPrice) sharesOutstanding = marketCap / lastPrice;
    }
    if (!marketCap || !sharesOutstanding) return null;
    return { marketCap, sharesOutstanding };
  } catch {
    return null;
  }
}

function fmt(stats, curve) {
  const gain = curve.length >= 2 ? ((curve[curve.length - 1].value / curve[0].value - 1) * 100).toFixed(1) + '%' : 'n/a';
  const sharpe = stats.sharpe !== null ? stats.sharpe.toFixed(2) : 'n/a';
  const pf = stats.profitFactor === null ? 'n/a' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2);
  const rb = stats.riskReward !== null ? stats.riskReward.toFixed(2) : 'n/a';
  return `trades=${String(stats.trades).padStart(3)} sharpe=${sharpe.padStart(5)} PF=${pf.padStart(5)} R:B=${rb.padStart(5)} gain=${gain.padStart(8)}`;
}

async function main() {
  const allTickers = [...SECTOR_ETFS, 'EWY', 'SPY'];
  console.log(`Descargando OHLCV ${BACKTEST_START} -> ${VALIDATION_END} para ${allTickers.length} tickers...`);
  const [priceResults, tltStatic] = await Promise.all([
    Promise.all(allTickers.map((t) => downloadPriceHistory(t, BACKTEST_START, VALIDATION_END))),
    fetchTickerStaticInfo('EWY'),
  ]);
  const priceBars = {};
  allTickers.forEach((t, i) => {
    if (priceResults[i].length > 0) priceBars[t] = priceResults[i];
  });
  if (!tltStatic) {
    console.log('No se pudo obtener static info de EWY, abortando.');
    return;
  }
  console.log('EWY static info (hoy):', tltStatic);

  const historicalSize = JSON.parse(readFileSync(path.join(__dirname, '../src/lib/densityLab/historicalSize.json'), 'utf8'));
  const sizeSeriesWithTlt = { ...historicalSize, EWY: [{ date: '2018-01-01', marketCap: tltStatic.marketCap, sharesOutstanding: tltStatic.sharesOutstanding }] };

  const expandedBars = {};
  for (const t of [...SECTOR_ETFS, 'EWY']) if (priceBars[t]) expandedBars[t] = priceBars[t];
  const sectorOnlyBars = {};
  for (const t of SECTOR_ETFS) if (priceBars[t]) sectorOnlyBars[t] = priceBars[t];

  const fullExpanded = computeAllSectorsDensity(expandedBars, sizeSeriesWithTlt, FREE_FLOAT_RATIO, ROLLING_WINDOW);
  const fullSectorOnly = computeAllSectorsDensity(sectorOnlyBars, historicalSize, FREE_FLOAT_RATIO, ROLLING_WINDOW);

  for (const [label, start, end] of [
    ['BACKTEST (2018-2023)', BACKTEST_START, BACKTEST_END],
    ['VALIDACION (2024-2025)', VALIDATION_START, VALIDATION_END],
  ]) {
    console.log(`\n=== ${label} ===`);
    const winSectorOnly = {};
    for (const [t, rows] of Object.entries(fullSectorOnly)) winSectorOnly[t] = sliceWindow(rows, start, end);
    const curveSectorOnly = simulateIcdExitStrategy(winSectorOnly, LOOKBACK_DAYS);
    console.log('  M2 actual (13, sin EWY):   ' + fmt(computeStrategyStats(curveSectorOnly), curveSectorOnly));

    const winExpanded = {};
    for (const [t, rows] of Object.entries(fullExpanded)) winExpanded[t] = sliceWindow(rows, start, end);
    const curveExpanded = simulateIcdExitStrategy(winExpanded, LOOKBACK_DAYS);
    console.log('  M2 + EWY (14, dato hoy):   ' + fmt(computeStrategyStats(curveExpanded), curveExpanded));

    const spyWindow = priceBars.SPY.filter((b) => b.date >= start && (end === null || b.date <= end));
    const spyCurve = buyAndHoldCurve(spyWindow, curveExpanded.map((p) => p.date));
    console.log('  SPY buy&hold:              ' + fmt(computeStrategyStats(spyCurve), spyCurve));
  }

  // Foco: cuanto se usa EWY realmente vs solo diluir el universo -- si el
  // ICD nunca lo elige, no importa que tan descorrelacionado sea el activo.
  console.log('\n=== Foco: correlacion de precio EWY vs SPY (Backtest+Validacion) ===');
  const ewyAll = priceBars.EWY.filter((b) => b.date >= BACKTEST_START && b.date <= VALIDATION_END);
  const spyAll = priceBars.SPY.filter((b) => b.date >= BACKTEST_START && b.date <= VALIDATION_END);
  const spyByDate = new Map(spyAll.map((b) => [b.date, b.close]));
  const pairs = ewyAll.map((b) => [b.close, spyByDate.get(b.date)]).filter(([, s]) => s !== undefined);
  const retsEwy = [];
  const retsSpy = [];
  for (let i = 1; i < pairs.length; i++) {
    retsEwy.push(pairs[i][0] / pairs[i - 1][0] - 1);
    retsSpy.push(pairs[i][1] / pairs[i - 1][1] - 1);
  }
  const meanE = retsEwy.reduce((a, b) => a + b, 0) / retsEwy.length;
  const meanS = retsSpy.reduce((a, b) => a + b, 0) / retsSpy.length;
  let cov = 0, varE = 0, varS = 0;
  for (let i = 0; i < retsEwy.length; i++) {
    cov += (retsEwy[i] - meanE) * (retsSpy[i] - meanS);
    varE += (retsEwy[i] - meanE) ** 2;
    varS += (retsSpy[i] - meanS) ** 2;
  }
  const corr = cov / Math.sqrt(varE * varS);
  console.log('  Correlacion diaria EWY vs SPY (2018-2025):', corr.toFixed(3));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
