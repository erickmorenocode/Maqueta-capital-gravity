/**
 * Prueba OFFLINE (no toca engine.ts ni DensityLab.tsx, no toca
 * historicalSize.json de produccion) de Opcion 2 con datos EDGAR reales:
 * universo 13 = 11 sectores + GLD + QQQ, usando historicalSizeExtra.json
 * (anclas reales -- GLD via XBRL trimestral, QQQ via N-30B-2 anual, ver
 * scripts/fetchEdgarHistoricalSizeExtra.mjs), NO el market cap actual
 * constante que se uso en la corrida anterior con TLT/EFA/EEM/HYG.
 *
 * Correr con:
 *   node --experimental-strip-types scripts/testExpandedUniverseGldQqq.mjs
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

const ROLLING_WINDOW = 44;
const LOOKBACK_DAYS = 9;
const FREE_FLOAT_RATIO = 0.95;
const EXTRA_TICKERS = ['GLD', 'QQQ'];

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

function fmt(stats, curve) {
  const gain = curve.length >= 2 ? ((curve[curve.length - 1].value / curve[0].value - 1) * 100).toFixed(1) + '%' : 'n/a';
  const sharpe = stats.sharpe !== null ? stats.sharpe.toFixed(2) : 'n/a';
  const pf = stats.profitFactor === null ? 'n/a' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2);
  const rb = stats.riskReward !== null ? stats.riskReward.toFixed(2) : 'n/a';
  return { trades: stats.trades, sharpe, pf, rb, gain };
}

function printRow(label, r) {
  console.log(`| ${label.padEnd(28)} | ${String(r.trades).padStart(6)} | ${String(r.sharpe).padStart(6)} | ${String(r.pf).padStart(6)} | ${String(r.rb).padStart(6)} | ${String(r.gain).padStart(8)} |`);
}

async function main() {
  const allTickers = [...SECTOR_ETFS, ...EXTRA_TICKERS, 'SPY'];
  console.log(`Descargando OHLCV ${BACKTEST_START} -> ${VALIDATION_END} para ${allTickers.length} tickers...`);
  const priceResults = await Promise.all(allTickers.map((t) => downloadPriceHistory(t, BACKTEST_START, VALIDATION_END)));
  const priceBars = {};
  allTickers.forEach((t, i) => {
    if (priceResults[i].length > 0) priceBars[t] = priceResults[i];
  });
  const missing = allTickers.filter((t) => !priceBars[t]);
  if (missing.length) console.log('  faltantes:', missing.join(', '));

  const historicalSize = JSON.parse(readFileSync(path.join(__dirname, '../src/lib/densityLab/historicalSize.json'), 'utf8'));
  const historicalSizeExtra = JSON.parse(readFileSync(path.join(__dirname, '../src/lib/densityLab/historicalSizeExtra.json'), 'utf8'));

  const sizeSeries = { ...historicalSize, ...historicalSizeExtra };

  const expandedBars = {};
  for (const t of [...SECTOR_ETFS, ...EXTRA_TICKERS]) if (priceBars[t]) expandedBars[t] = priceBars[t];
  const sectorOnlyBars = {};
  for (const t of SECTOR_ETFS) if (priceBars[t]) sectorOnlyBars[t] = priceBars[t];

  const fullMetricsExpanded = computeAllSectorsDensity(expandedBars, sizeSeries, FREE_FLOAT_RATIO, ROLLING_WINDOW);
  const fullMetricsSectorOnly = computeAllSectorsDensity(sectorOnlyBars, historicalSize, FREE_FLOAT_RATIO, ROLLING_WINDOW);

  for (const [label, start, end] of [
    ['BACKTEST (2018-2023)', BACKTEST_START, BACKTEST_END],
    ['VALIDACION (2024-2025)', VALIDATION_START, VALIDATION_END],
  ]) {
    console.log(`\n=== ${label} ===`);
    console.log('| Estrategia                   | trades | sharpe |     PF |    R:B |   gain   |');
    console.log('|-------------------------------|--------|--------|--------|--------|----------|');

    const winSectorOnly = {};
    for (const [t, rows] of Object.entries(fullMetricsSectorOnly)) winSectorOnly[t] = sliceWindow(rows, start, end);
    const curveSectorOnly = simulateIcdExitStrategy(winSectorOnly, LOOKBACK_DAYS);
    printRow('M2 universo 11 (actual)', fmt(computeStrategyStats(curveSectorOnly), curveSectorOnly));

    const winExpanded = {};
    for (const [t, rows] of Object.entries(fullMetricsExpanded)) winExpanded[t] = sliceWindow(rows, start, end);
    const curveExpanded = simulateIcdExitStrategy(winExpanded, LOOKBACK_DAYS);
    printRow('M2 universo 13 (+GLD+QQQ)', fmt(computeStrategyStats(curveExpanded), curveExpanded));

    const spyWindow = priceBars.SPY.filter((b) => b.date >= start && (end === null || b.date <= end));
    const spyCurveAligned = buyAndHoldCurve(spyWindow, curveExpanded.map((p) => p.date));
    printRow('SPY buy&hold', fmt(computeStrategyStats(spyCurveAligned), spyCurveAligned));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
