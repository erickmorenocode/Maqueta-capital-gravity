/**
 * Prueba OFFLINE RAPIDA (no toca engine.ts ni DensityLab.tsx) de sumar
 * DBMF (iMGP DBi Managed Futures Strategy Fund) al universo de M2.
 * Motivo: correlacion real medida vs SPY = 0.188 (baja) -- estrategia de
 * trend-following/CTA, la respuesta "de libro" para descorrelacion con
 * retorno esperado positivo (suele rendir bien justo cuando las acciones
 * caen en tendencia, complementa el hueco que dejo TLT en el crash COVID
 * por ser demasiado lento para reaccionar).
 *
 * LIMITACION REAL (no solo de esta prueba rapida): DBMF solo tiene
 * historia desde 2019-05-08 -- faltan ~16 meses del Backtest (ene-2018 a
 * abr-2019, incluye la correccion de dic-2018). El pipeline lo maneja
 * igual que XLC (que tampoco existe antes de jun-2018): sin barras antes
 * de su lanzamiento, sin ICD valido ahi, se incorpora solo cuando hay
 * datos. Ademas, para esta prueba rapida, DBMF usa market cap/shares
 * ACTUALES (hoy) aplicados constante a toda su serie disponible -- mismo
 * approach rapido que se uso para TLT/EWY/UUP (los tres dieron
 * negativo/mixto). Si DBMF mejora igual con este dato debil Y el hueco
 * de datos, vale la pena parsear EDGAR real para el.
 *
 * Correr con:
 *   node --experimental-strip-types scripts/testDbmfUniverse.mjs
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
  const allTickers = [...SECTOR_ETFS, 'DBMF', 'SPY'];
  console.log(`Descargando OHLCV ${BACKTEST_START} -> ${VALIDATION_END} para ${allTickers.length} tickers...`);
  const [priceResults, uupStatic] = await Promise.all([
    Promise.all(allTickers.map((t) => downloadPriceHistory(t, BACKTEST_START, VALIDATION_END))),
    fetchTickerStaticInfo('DBMF'),
  ]);
  const priceBars = {};
  allTickers.forEach((t, i) => {
    if (priceResults[i].length > 0) priceBars[t] = priceResults[i];
  });
  if (!uupStatic) {
    console.log('No se pudo obtener static info de DBMF, abortando.');
    return;
  }
  console.log('DBMF static info (hoy):', uupStatic);

  const historicalSize = JSON.parse(readFileSync(path.join(__dirname, '../src/lib/densityLab/historicalSize.json'), 'utf8'));
  const sizeSeriesWithUup = { ...historicalSize, DBMF: [{ date: '2018-01-01', marketCap: uupStatic.marketCap, sharesOutstanding: uupStatic.sharesOutstanding }] };

  const expandedBars = {};
  for (const t of [...SECTOR_ETFS, 'DBMF']) if (priceBars[t]) expandedBars[t] = priceBars[t];
  const sectorOnlyBars = {};
  for (const t of SECTOR_ETFS) if (priceBars[t]) sectorOnlyBars[t] = priceBars[t];

  const fullExpanded = computeAllSectorsDensity(expandedBars, sizeSeriesWithUup, FREE_FLOAT_RATIO, ROLLING_WINDOW);
  const fullSectorOnly = computeAllSectorsDensity(sectorOnlyBars, historicalSize, FREE_FLOAT_RATIO, ROLLING_WINDOW);

  for (const [label, start, end] of [
    ['BACKTEST (2018-2023)', BACKTEST_START, BACKTEST_END],
    ['VALIDACION (2024-2025)', VALIDATION_START, VALIDATION_END],
  ]) {
    console.log(`\n=== ${label} ===`);
    const winSectorOnly = {};
    for (const [t, rows] of Object.entries(fullSectorOnly)) winSectorOnly[t] = sliceWindow(rows, start, end);
    const curveSectorOnly = simulateIcdExitStrategy(winSectorOnly, LOOKBACK_DAYS);
    console.log('  M2 actual (13, sin DBMF):   ' + fmt(computeStrategyStats(curveSectorOnly), curveSectorOnly));

    const winExpanded = {};
    for (const [t, rows] of Object.entries(fullExpanded)) winExpanded[t] = sliceWindow(rows, start, end);
    const curveExpanded = simulateIcdExitStrategy(winExpanded, LOOKBACK_DAYS);
    console.log('  M2 + DBMF (14, dato hoy):   ' + fmt(computeStrategyStats(curveExpanded), curveExpanded));

    const spyWindow = priceBars.SPY.filter((b) => b.date >= start && (end === null || b.date <= end));
    const spyCurve = buyAndHoldCurve(spyWindow, curveExpanded.map((p) => p.date));
    console.log('  SPY buy&hold:              ' + fmt(computeStrategyStats(spyCurve), spyCurve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
