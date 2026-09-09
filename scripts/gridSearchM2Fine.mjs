/**
 * Barrido fino de Metodologia 2 (simulateIcdExitStrategy) sobre sus dos
 * parametros reales -- rollingWindow (5-60, resolucion completa) x
 * lookbackDays (1-10, resolucion completa) = 560 combinaciones.
 * freeFloatRatio se fija en 0.95 porque ya se confirmo (dos corridas
 * distintas) que M2/M1 dan resultado identico para cualquier valor --
 * se cancela en el z-score, no aporta nada al barrido.
 *
 * Ranking por ROBUSTEZ, no por Sharpe de Backtest solo: robustScore =
 * min(Sharpe Backtest, Sharpe Validacion). La corrida anterior mostro
 * que el combo con mejor Sharpe en Backtest no es necesariamente el que
 * mejor generaliza (M1 se degrado 1.14->0.84, M2 mejoro 0.65->0.99) --
 * tomar el minimo de las dos ventanas premia combos que son buenos en
 * AMBAS, no solo afortunados en una. Evita repetir el error de optimizar
 * mirando una sola ventana.
 *
 * Correr con:
 *   node --experimental-strip-types scripts/gridSearchM2Fine.mjs
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
  buyAndHoldCurve,
} = engine;

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

const ROLLING_WINDOWS = Array.from({ length: 56 }, (_, i) => i + 5); // 5..60
const LOOKBACK_DAYS = Array.from({ length: 10 }, (_, i) => i + 1); // 1..10
const FREE_FLOAT_RATIO = 0.95; // irrelevante para M2/M1, confirmado
const MIN_TRADES = 15;

function tradeReturns(curve) {
  const rets = [];
  for (let i = 1; i < curve.length; i++) rets.push(curve[i].value / curve[i - 1].value - 1);
  return rets;
}

function sharpeRatioFromCurve(curve) {
  const rets = tradeReturns(curve);
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  const totalCalendarDays = (new Date(curve[curve.length - 1].date) - new Date(curve[0].date)) / 86400000;
  const avgCalendarDaysPerTrade = totalCalendarDays / rets.length;
  if (avgCalendarDaysPerTrade <= 0) return null;
  const periodsPerYear = 365 / avgCalendarDaysPerTrade;
  return (mean / std) * Math.sqrt(periodsPerYear);
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

  console.log(`Grid: ${ROLLING_WINDOWS.length} rollingWindow x ${LOOKBACK_DAYS.length} lookback = ${ROLLING_WINDOWS.length * LOOKBACK_DAYS.length} combinaciones (freeFloatRatio fijo en ${FREE_FLOAT_RATIO}, irrelevante)\n`);

  const results = [];
  let count = 0;
  for (const rollingWindow of ROLLING_WINDOWS) {
    const fullMetrics = computeAllSectorsDensity(sectorBars, historicalSize, FREE_FLOAT_RATIO, rollingWindow);
    const backtestMetrics = {};
    const validationMetrics = {};
    for (const [t, rows] of Object.entries(fullMetrics)) {
      backtestMetrics[t] = sliceWindow(rows, BACKTEST_START, BACKTEST_END);
      validationMetrics[t] = sliceWindow(rows, VALIDATION_START, VALIDATION_END);
    }

    for (const lookbackDays of LOOKBACK_DAYS) {
      count++;
      const curveBT = simulateIcdExitStrategy(backtestMetrics, lookbackDays);
      const curveVAL = simulateIcdExitStrategy(validationMetrics, lookbackDays);

      const tradesBT = curveBT.length ? curveBT.length - 1 : 0;
      const tradesVAL = curveVAL.length ? curveVAL.length - 1 : 0;
      const sharpeBT = tradesBT >= MIN_TRADES ? sharpeRatioFromCurve(curveBT) : null;
      const sharpeVAL = tradesVAL >= MIN_TRADES ? sharpeRatioFromCurve(curveVAL) : null;
      const gainBT = curveBT.length >= 2 ? curveBT[curveBT.length - 1].value - 1 : null;
      const gainVAL = curveVAL.length >= 2 ? curveVAL[curveVAL.length - 1].value - 1 : null;
      const robustScore = sharpeBT !== null && sharpeVAL !== null ? Math.min(sharpeBT, sharpeVAL) : null;

      results.push({ rollingWindow, lookbackDays, sharpeBT, sharpeVAL, robustScore, gainBT, gainVAL, tradesBT, tradesVAL });
    }
    process.stdout.write(`\r  progreso: ${count}/${ROLLING_WINDOWS.length * LOOKBACK_DAYS.length}`);
  }
  console.log('\n');

  const withRobust = results.filter((r) => r.robustScore !== null).sort((a, b) => b.robustScore - a.robustScore);
  console.log(`Combos con Sharpe valido en AMBAS ventanas: ${withRobust.length}/${results.length}\n`);

  console.log('=== Top 15 por robustez: min(Sharpe Backtest, Sharpe Validacion) ===');
  console.log('rollingWindow  lookback  SharpeBT  SharpeVAL  robusto  gainBT%  gainVAL%  tradesBT  tradesVAL');
  for (const r of withRobust.slice(0, 15)) {
    console.log(
      `${String(r.rollingWindow).padStart(13)}  ${String(r.lookbackDays).padStart(8)}  ${r.sharpeBT.toFixed(2).padStart(8)}  ${r.sharpeVAL.toFixed(2).padStart(9)}  ${r.robustScore.toFixed(2).padStart(7)}  ${(r.gainBT * 100).toFixed(1).padStart(7)}  ${(r.gainVAL * 100).toFixed(1).padStart(8)}  ${String(r.tradesBT).padStart(8)}  ${String(r.tradesVAL).padStart(9)}`
    );
  }

  // Comparar contra el mejor-solo-Backtest (lo que hubiera elegido el
  // criterio anterior) para que quede explicito por que importa el cambio.
  const bestBacktestOnly = results.filter((r) => r.sharpeBT !== null).sort((a, b) => b.sharpeBT - a.sharpeBT)[0];
  console.log(`\nMejor SOLO por Sharpe de Backtest (criterio anterior): rollingWindow=${bestBacktestOnly.rollingWindow} lookback=${bestBacktestOnly.lookbackDays} -> SharpeBT=${bestBacktestOnly.sharpeBT.toFixed(2)}, SharpeVAL=${bestBacktestOnly.sharpeVAL !== null ? bestBacktestOnly.sharpeVAL.toFixed(2) : 'n/a'}`);

  const winner = withRobust[0];
  console.log(`Mejor por ROBUSTEZ (min de ambas): rollingWindow=${winner.rollingWindow} lookback=${winner.lookbackDays} -> SharpeBT=${winner.sharpeBT.toFixed(2)}, SharpeVAL=${winner.sharpeVAL.toFixed(2)}`);

  // SPY de referencia en ambas ventanas para contexto.
  const spyBacktest = sliceWindow(priceBars.SPY, BACKTEST_START, BACKTEST_END);
  const spyValidation = sliceWindow(priceBars.SPY, VALIDATION_START, VALIDATION_END);
  const spyBTGain = spyBacktest.length ? spyBacktest[spyBacktest.length - 1].close / spyBacktest[0].close - 1 : null;
  const spyVALGain = spyValidation.length ? spyValidation[spyValidation.length - 1].close / spyValidation[0].close - 1 : null;
  console.log(`\nSPY buy&hold de referencia: Backtest ${spyBTGain !== null ? (spyBTGain * 100).toFixed(1) + '%' : 'n/a'}, Validacion ${spyVALGain !== null ? (spyVALGain * 100).toFixed(1) + '%' : 'n/a'}`);
  console.log(`Ganador robusto vs SPY: Backtest ${(winner.gainBT * 100).toFixed(1)}% vs ${spyBTGain !== null ? (spyBTGain * 100).toFixed(1) + '%' : 'n/a'}, Validacion ${(winner.gainVAL * 100).toFixed(1)}% vs ${spyVALGain !== null ? (spyVALGain * 100).toFixed(1) + '%' : 'n/a'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
