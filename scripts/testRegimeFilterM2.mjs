/**
 * Prueba OFFLINE (no toca engine.ts ni DensityLab.tsx) de la Opcion 1
 * propuesta para cerrar la brecha M2-vs-SPY en Validacion: filtro de
 * regimen -- si el sector con mejor delta de ICD no le esta ganando a
 * SPY en retorno de precio sobre el mismo lookback, no rotar ahi: quedarse
 * en SPY hasta que algun sector vuelva a superarlo. Regla estructural
 * (no un parametro mas para ajustar), sin necesidad de ICD/tamano
 * historico de SPY (que no existe -- SPY es un UIT, no filea N-CSR como
 * el Select Sector SPDR Trust) porque compara RETORNO DE PRECIO, no ICD.
 *
 * Compara contra la M2 actual (sin filtro) en Backtest y Validacion con
 * los defaults ya fijados (rollingWindow=44, lookbackDays=9) para ver si
 * de verdad cierra la brecha antes de tocar codigo de produccion.
 *
 * Correr con:
 *   node --experimental-strip-types scripts/testRegimeFilterM2.mjs
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

/**
 * M2 + filtro de regimen: entra en el sector de mejor delta ICD SOLO si
 * ese sector le esta ganando a SPY en retorno de precio sobre el mismo
 * lookback; si no, sostiene SPY hasta que algun sector vuelva a ganarle
 * (chequeado dia a dia, igual que la salida por ICD<0 de M2 normal).
 * Sale del sector igual que M2 (ICD<0). No requiere ICD de SPY.
 */
function simulateIcdExitWithRegimeFilter(sectorMetrics, spyBars, lookbackDays) {
  const tickers = Object.keys(sectorMetrics).filter((t) => sectorMetrics[t].some((r) => r.ICD !== null));
  if (tickers.length === 0) return [];

  const dateSet = new Set();
  for (const t of tickers) for (const r of sectorMetrics[t]) dateSet.add(r.date);
  const dates = Array.from(dateSet).sort();

  const icdByTicker = {};
  const closeByTicker = {};
  for (const t of tickers) {
    icdByTicker[t] = new Map(sectorMetrics[t].map((r) => [r.date, r.ICD]));
    closeByTicker[t] = new Map(sectorMetrics[t].map((r) => [r.date, r.close]));
  }
  const spyCloseByDate = new Map(spyBars.map((b) => [b.date, b.close]));

  function priceReturn(closeMap, dateNow, dateBefore) {
    const now = closeMap.get(dateNow);
    const before = closeMap.get(dateBefore);
    if (now === undefined || before === undefined || before === 0) return null;
    return now / before - 1;
  }

  function pickBestTicker(date, lookbackDate) {
    let bestTicker = null;
    let bestDelta = -Infinity;
    for (const t of tickers) {
      const now = icdByTicker[t].get(date);
      const before = icdByTicker[t].get(lookbackDate);
      if (now === null || now === undefined || before === null || before === undefined) continue;
      const delta = now - before;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestTicker = t;
      }
    }
    return bestTicker;
  }

  const equity = [];
  let equityValue = 1.0;
  let position = null; // { ticker, entryPrice, isSpy }

  for (let i = lookbackDays; i < dates.length; i++) {
    const date = dates[i];
    const lookbackDate = dates[i - lookbackDays];

    if (position && !position.isSpy) {
      const icdNow = icdByTicker[position.ticker].get(date);
      const closeNow = closeByTicker[position.ticker].get(date);
      if (icdNow !== null && icdNow !== undefined && icdNow < 0 && closeNow !== undefined) {
        equityValue *= 1 + (closeNow / position.entryPrice - 1);
        equity.push({ date, value: equityValue });
        position = null;
      }
    } else if (position && position.isSpy) {
      const bestTicker = pickBestTicker(date, lookbackDate);
      if (bestTicker !== null) {
        const secRet = priceReturn(closeByTicker[bestTicker], date, lookbackDate);
        const spyRet = priceReturn(spyCloseByDate, date, lookbackDate);
        if (secRet !== null && spyRet !== null && secRet > spyRet) {
          const closeNow = spyCloseByDate.get(date);
          if (closeNow !== undefined) {
            equityValue *= 1 + (closeNow / position.entryPrice - 1);
            equity.push({ date, value: equityValue });
            position = null;
          }
        }
      }
    }

    if (!position) {
      const bestTicker = pickBestTicker(date, lookbackDate);
      if (bestTicker !== null) {
        const secRet = priceReturn(closeByTicker[bestTicker], date, lookbackDate);
        const spyRet = priceReturn(spyCloseByDate, date, lookbackDate);
        if (secRet !== null && spyRet !== null && secRet > spyRet) {
          const entryPrice = closeByTicker[bestTicker].get(date);
          if (entryPrice !== undefined) {
            position = { ticker: bestTicker, entryPrice, isSpy: false };
            if (equity.length === 0) equity.push({ date, value: 1.0 });
          }
        } else {
          const entryPrice = spyCloseByDate.get(date);
          if (entryPrice !== undefined) {
            position = { ticker: 'SPY', entryPrice, isSpy: true };
            if (equity.length === 0) equity.push({ date, value: 1.0 });
          }
        }
      }
    }
  }

  if (position) {
    const lastDate = dates[dates.length - 1];
    const closeMap = position.isSpy ? spyCloseByDate : closeByTicker[position.ticker];
    const lastClose = closeMap.get(lastDate);
    if (lastClose !== undefined) {
      equityValue *= 1 + (lastClose / position.entryPrice - 1);
      equity.push({ date: lastDate, value: equityValue });
    }
  }

  return equity.length >= 2 ? equity : [];
}

function fmt(stats, curve) {
  const gain = curve.length >= 2 ? ((curve[curve.length - 1].value / curve[0].value - 1) * 100).toFixed(1) + '%' : 'n/a';
  const sharpe = stats.sharpe !== null ? stats.sharpe.toFixed(2) : 'n/a';
  const pf = stats.profitFactor === null ? 'n/a' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2);
  const rb = stats.riskReward !== null ? stats.riskReward.toFixed(2) : 'n/a';
  return `trades=${stats.trades} sharpe=${sharpe} PF=${pf} R:B=${rb} gain=${gain}`;
}

async function main() {
  console.log(`Descargando OHLCV ${BACKTEST_START} -> ${VALIDATION_END} para ${SECTOR_ETFS.length} ETFs sectoriales + SPY...`);
  const allTickers = [...SECTOR_ETFS, 'SPY'];
  const priceResults = await Promise.all(allTickers.map((t) => downloadPriceHistory(t, BACKTEST_START, VALIDATION_END)));
  const priceBars = {};
  allTickers.forEach((t, i) => {
    if (priceResults[i].length > 0) priceBars[t] = priceResults[i];
  });

  const historicalSize = JSON.parse(readFileSync(path.join(__dirname, '../src/lib/densityLab/historicalSize.json'), 'utf8'));
  const sectorBars = {};
  for (const t of SECTOR_ETFS) if (priceBars[t]) sectorBars[t] = priceBars[t];

  const fullMetrics = computeAllSectorsDensity(sectorBars, historicalSize, FREE_FLOAT_RATIO, ROLLING_WINDOW);

  for (const [label, start, end] of [
    ['BACKTEST', BACKTEST_START, BACKTEST_END],
    ['VALIDATION', VALIDATION_START, VALIDATION_END],
  ]) {
    console.log(`\n=== ${label} (rollingWindow=${ROLLING_WINDOW}, lookback=${LOOKBACK_DAYS}) ===`);
    const windowMetrics = {};
    for (const [t, rows] of Object.entries(fullMetrics)) windowMetrics[t] = sliceWindow(rows, start, end);
    const spyWindow = priceBars.SPY.filter((b) => b.date >= start && (end === null || b.date <= end));

    const curveM2 = simulateIcdExitStrategy(windowMetrics, LOOKBACK_DAYS);
    const curveFiltered = simulateIcdExitWithRegimeFilter(windowMetrics, spyWindow, LOOKBACK_DAYS);
    const spyCurveAligned = buyAndHoldCurve(spyWindow, curveM2.map((p) => p.date));

    console.log('  M2 (sin filtro):     ' + fmt(computeStrategyStats(curveM2), curveM2));
    console.log('  M2 + filtro regimen: ' + fmt(computeStrategyStats(curveFiltered), curveFiltered));
    console.log('  SPY buy&hold:        ' + fmt(computeStrategyStats(spyCurveAligned), spyCurveAligned));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
