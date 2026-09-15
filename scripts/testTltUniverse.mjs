/**
 * Prueba OFFLINE RAPIDA (no toca engine.ts ni DensityLab.tsx) de sumar
 * TLT (iShares 20+ Year Treasury Bond, descorrelacionado/refugio) al
 * universo de M2.
 *
 * LIMITACION CONOCIDA (deliberada, solo para ver si vale la pena antes
 * de invertir en parsear EDGAR real): TLT vive en "iShares Trust" (CIK
 * 1100663), un filer con CIENTOS de fondos en cada N-CSR (1433 NPORT-P
 * historicos) -- mucho mas caro de aislar de forma confiable que el
 * Select Sector SPDR Trust (11 fondos) o QQQ (un fondo solo). No tiene
 * XBRL limpio tampoco (no es Exchange Act filer como GLD). Por eso, para
 * esta prueba rapida, TLT usa market cap/shares ACTUALES (hoy) aplicados
 * constante a toda la serie -- el mismo sesgo de look-ahead que ya se
 * arreglo para el resto. Si el resultado mejora igual con este dato
 * debil, vale la pena parsear EDGAR real para TLT antes de integrar
 * permanente. Si no ayuda ni con el mejor caso (dato de hoy), no vale la
 * pena.
 *
 * Correr con:
 *   node --experimental-strip-types scripts/testTltUniverse.mjs
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
  const allTickers = [...SECTOR_ETFS, 'TLT', 'SPY'];
  console.log(`Descargando OHLCV ${BACKTEST_START} -> ${VALIDATION_END} para ${allTickers.length} tickers...`);
  const [priceResults, tltStatic] = await Promise.all([
    Promise.all(allTickers.map((t) => downloadPriceHistory(t, BACKTEST_START, VALIDATION_END))),
    fetchTickerStaticInfo('TLT'),
  ]);
  const priceBars = {};
  allTickers.forEach((t, i) => {
    if (priceResults[i].length > 0) priceBars[t] = priceResults[i];
  });
  if (!tltStatic) {
    console.log('No se pudo obtener static info de TLT, abortando.');
    return;
  }
  console.log('TLT static info (hoy):', tltStatic);

  const historicalSize = JSON.parse(readFileSync(path.join(__dirname, '../src/lib/densityLab/historicalSize.json'), 'utf8'));
  const sizeSeriesWithTlt = { ...historicalSize, TLT: [{ date: '2018-01-01', marketCap: tltStatic.marketCap, sharesOutstanding: tltStatic.sharesOutstanding }] };

  const expandedBars = {};
  for (const t of [...SECTOR_ETFS, 'TLT']) if (priceBars[t]) expandedBars[t] = priceBars[t];
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
    console.log('  M2 actual (13, sin TLT):   ' + fmt(computeStrategyStats(curveSectorOnly), curveSectorOnly));

    const winExpanded = {};
    for (const [t, rows] of Object.entries(fullExpanded)) winExpanded[t] = sliceWindow(rows, start, end);
    const curveExpanded = simulateIcdExitStrategy(winExpanded, LOOKBACK_DAYS);
    console.log('  M2 + TLT (14, dato hoy):   ' + fmt(computeStrategyStats(curveExpanded), curveExpanded));

    const spyWindow = priceBars.SPY.filter((b) => b.date >= start && (end === null || b.date <= end));
    const spyCurve = buyAndHoldCurve(spyWindow, curveExpanded.map((p) => p.date));
    console.log('  SPY buy&hold:              ' + fmt(computeStrategyStats(spyCurve), spyCurve));
  }

  // Foco: crash COVID especifico, donde TLT deberia brillar (flight to safety)
  console.log('\n=== Foco: Crash COVID (19-feb a 23-mar-2020) ===');
  const winSO = {};
  for (const [t, rows] of Object.entries(fullSectorOnly)) winSO[t] = sliceWindow(rows, '2020-02-19', '2020-03-23');
  const curveSO = simulateIcdExitStrategy(winSO, LOOKBACK_DAYS);
  console.log('  M2 actual (sin TLT):  ' + fmt(computeStrategyStats(curveSO), curveSO));
  const winEx = {};
  for (const [t, rows] of Object.entries(fullExpanded)) winEx[t] = sliceWindow(rows, '2020-02-19', '2020-03-23');
  const curveEx = simulateIcdExitStrategy(winEx, LOOKBACK_DAYS);
  console.log('  M2 + TLT:             ' + fmt(computeStrategyStats(curveEx), curveEx));
  const tltBars = priceBars.TLT.filter((b) => b.date >= '2020-02-19' && b.date <= '2020-03-23');
  if (tltBars.length) console.log('  TLT retorno crudo en el crash:', ((tltBars[tltBars.length - 1].close / tltBars[0].close - 1) * 100).toFixed(1) + '%');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
