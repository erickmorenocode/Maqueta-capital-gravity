/**
 * Grid search de parametros del density lab maximizando el Sharpe ratio
 * (retorno ajustado por riesgo) SOLO en la ventana Backtest (2018-2023),
 * para las dos metodologias de la estrategia ICD:
 *   M1 = simulateIcdRotationStrategy (tenencia a plazo fijo holdDays)
 *   M2 = simulateIcdExitStrategy (sale cuando ICD < 0, sin plazo fijo)
 *
 * Por que Sharpe y no ganancia pura: la primera corrida (maximizando
 * ganancia total de M1) encontro un combo que hacia 247% en Backtest
 * pero 42.5% en Validacion (peor que SPY buy&hold ahi) -- sobreajuste
 * clasico, la ganancia pura premia el punto mas afortunado del training
 * set sin penalizar que ese resultado vino de pocos trades erraticos.
 * Sharpe = retorno medio por trade / desvio de esos retornos, anualizado
 * por trades/año -- castiga combos ruidosos aunque el trade ganador haya
 * sido enorme. Filtro MIN_TRADES para no rankear arriba un combo con
 * pocos trades y Sharpe artificialmente alto por muestra chica. Rf=0
 * (simplificacion, no resta tasa libre de riesgo).
 *
 * Anualizacion: en vez de asumir holdDays fijo (invalido para M2, que no
 * tiene plazo fijo), se usa el promedio real de dias calendario entre
 * trades de CADA curva -- mismo criterio para M1 y M2, comparacion justa.
 *
 * Metodologia: optimiza in-sample sobre Backtest (por diseno). Congela
 * cada combo ganador y lo corre SIN retocar en Validacion (2024-2025)
 * -- si el Sharpe se sostiene ahi, hay señal real; si se cae, estaba
 * sobreajustado. Reporta ambas metodologias y compara directo, sin
 * maquillar el resultado out-of-sample.
 *
 * Correr con:
 *   node --experimental-strip-types scripts/gridSearchBacktest.mjs
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
  simulateIcdRotationStrategy,
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

// ─── Grid ────────────────────────────────────────────────────────────────
// Rangos calcados de los sliders reales en DensityLab.tsx (min/max), con
// paso mas grueso -- resolucion completa (step=1 en todo) serian ~570k
// combos para M1, no vale la pena esa granularidad para elegir un default.
const ROLLING_WINDOWS = [5, 10, 15, 20, 25, 30, 40, 50, 60];
const FREE_FLOAT_RATIOS = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0];
const LOOKBACK_DAYS = [1, 2, 3, 5, 7, 10];
const HOLD_DAYS = [1, 2, 3, 5, 10, 15, 20]; // solo M1 -- M2 no tiene plazo fijo
const MIN_TRADES = 15; // debajo de esto el Sharpe es ruido de muestra chica

function tradeReturns(curve) {
  const rets = [];
  for (let i = 1; i < curve.length; i++) rets.push(curve[i].value / curve[i - 1].value - 1);
  return rets;
}

// Anualiza por dias calendario reales entre trades (no por holdDays
// nominal) -- funciona igual para M1 (plazo fijo) y M2 (plazo variable).
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

function fmtRow(r) {
  return `${String(r.rollingWindow).padStart(13)}  ${String(Math.round(r.freeFloatRatio * 100) + '%').padStart(9)}  ${String(r.lookbackDays).padStart(8)}  ${String(r.holdDays ?? '-').padStart(4)}  ${r.sharpe.toFixed(2).padStart(6)}  ${(r.finalGain * 100).toFixed(1).padStart(8)}%  ${String(r.trades).padStart(6)}`;
}

/** Corre el combo ganador SIN retocar en Validacion y reporta honesto. */
function outOfSampleCheck(label, winner, strategyFn, sectorBars, historicalSize, priceBars) {
  const fullMetricsWinner = computeAllSectorsDensity(sectorBars, historicalSize, winner.freeFloatRatio, winner.rollingWindow);
  const backtestMetrics = {};
  const validationMetrics = {};
  for (const [t, rows] of Object.entries(fullMetricsWinner)) {
    backtestMetrics[t] = sliceWindow(rows, BACKTEST_START, BACKTEST_END);
    validationMetrics[t] = sliceWindow(rows, VALIDATION_START, VALIDATION_END);
  }

  const backtestCurve = strategyFn(backtestMetrics, winner);
  const validationCurve = strategyFn(validationMetrics, winner);
  const validationTrades = validationCurve.length ? validationCurve.length - 1 : 0;
  const validationGain = validationCurve.length >= 2 ? validationCurve[validationCurve.length - 1].value - 1 : null;
  const validationSharpe = validationTrades >= MIN_TRADES ? sharpeRatioFromCurve(validationCurve) : null;

  const spyBacktest = sliceWindow(priceBars.SPY.map((b) => ({ ...b })), BACKTEST_START, BACKTEST_END);
  const spyValidation = sliceWindow(priceBars.SPY.map((b) => ({ ...b })), VALIDATION_START, VALIDATION_END);
  const spyBacktestCurve = buyAndHoldCurve(spyBacktest, backtestCurve.map((p) => p.date));
  const spyValidationCurve = buyAndHoldCurve(spyValidation, validationCurve.map((p) => p.date));
  const spyBacktestGain = spyBacktestCurve.length ? spyBacktestCurve[spyBacktestCurve.length - 1].value - 1 : null;
  const spyValidationGain = spyValidationCurve.length ? spyValidationCurve[spyValidationCurve.length - 1].value - 1 : null;

  console.log(`\n=== ${label}: mismo combo, SIN retocar, en Validacion (2024-2025) ===`);
  console.log(`Backtest:    Sharpe=${winner.sharpe.toFixed(2)}  ganancia=${(winner.finalGain * 100).toFixed(1)}%  vs  SPY buy&hold ${spyBacktestGain !== null ? (spyBacktestGain * 100).toFixed(1) + '%' : 'n/a'}  (${winner.trades} trades)`);
  console.log(
    `Validacion:  Sharpe=${validationSharpe !== null ? validationSharpe.toFixed(2) : `n/a (${validationTrades} trades, <${MIN_TRADES})`}  ganancia=${validationGain !== null ? (validationGain * 100).toFixed(1) + '%' : 'SIN TRADES'}  vs  SPY buy&hold ${spyValidationGain !== null ? (spyValidationGain * 100).toFixed(1) + '%' : 'n/a'}  (${validationTrades} trades)`
  );

  const sostenido = validationSharpe !== null && validationSharpe >= 0 && spyValidationGain !== null && (validationGain ?? -Infinity) >= spyValidationGain;
  if (!sostenido) {
    console.log('ADVERTENCIA: no se sostiene en Validacion (Sharpe invalido/negativo, o pierde contra SPY buy&hold ahi).');
  } else {
    console.log('Se sostiene en Validacion (Sharpe positivo y gana contra SPY buy&hold ahi tambien).');
  }
  return { validationSharpe, validationGain, spyValidationGain, sostenido };
}

async function main() {
  console.log(`Descargando OHLCV ${BACKTEST_START} -> ${VALIDATION_END} para ${SECTOR_ETFS.length} ETFs sectoriales + SPY...`);
  const allTickers = [...SECTOR_ETFS, 'SPY'];
  const priceResults = await Promise.all(allTickers.map((t) => downloadPriceHistory(t, BACKTEST_START, VALIDATION_END)));
  const priceBars = {};
  allTickers.forEach((t, i) => {
    if (priceResults[i].length > 0) priceBars[t] = priceResults[i];
  });
  const missing = allTickers.filter((t) => !priceBars[t]);
  if (missing.length) console.log('  faltantes:', missing.join(', '));

  const historicalSize = JSON.parse(readFileSync(path.join(__dirname, '../src/lib/densityLab/historicalSize.json'), 'utf8'));

  const sectorBars = {};
  for (const t of SECTOR_ETFS) if (priceBars[t]) sectorBars[t] = priceBars[t];

  const totalM1 = ROLLING_WINDOWS.length * FREE_FLOAT_RATIOS.length * LOOKBACK_DAYS.length * HOLD_DAYS.length;
  const totalM2 = ROLLING_WINDOWS.length * FREE_FLOAT_RATIOS.length * LOOKBACK_DAYS.length;
  console.log(`Grid M1 (tenencia fija): ${totalM1} combinaciones`);
  console.log(`Grid M2 (sale si ICD<0): ${totalM2} combinaciones\n`);

  const resultsM1 = [];
  const resultsM2 = [];
  let heavyCount = 0;
  const heavyTotal = ROLLING_WINDOWS.length * FREE_FLOAT_RATIOS.length;

  for (const rollingWindow of ROLLING_WINDOWS) {
    for (const freeFloatRatio of FREE_FLOAT_RATIOS) {
      heavyCount++;
      const fullMetrics = computeAllSectorsDensity(sectorBars, historicalSize, freeFloatRatio, rollingWindow);
      const backtestMetrics = {};
      for (const [t, rows] of Object.entries(fullMetrics)) backtestMetrics[t] = sliceWindow(rows, BACKTEST_START, BACKTEST_END);

      for (const lookbackDays of LOOKBACK_DAYS) {
        // M2: no depende de holdDays.
        const curveM2 = simulateIcdExitStrategy(backtestMetrics, lookbackDays);
        if (curveM2.length >= 2) {
          const trades = curveM2.length - 1;
          const finalGain = curveM2[curveM2.length - 1].value - 1;
          const sharpe = trades >= MIN_TRADES ? sharpeRatioFromCurve(curveM2) : null;
          resultsM2.push({ rollingWindow, freeFloatRatio, lookbackDays, holdDays: null, finalGain, sharpe, trades });
        }

        for (const holdDays of HOLD_DAYS) {
          const curveM1 = simulateIcdRotationStrategy(backtestMetrics, lookbackDays, holdDays);
          if (curveM1.length < 2) continue;
          const trades = curveM1.length - 1;
          const finalGain = curveM1[curveM1.length - 1].value - 1;
          const sharpe = trades >= MIN_TRADES ? sharpeRatioFromCurve(curveM1) : null;
          resultsM1.push({ rollingWindow, freeFloatRatio, lookbackDays, holdDays, finalGain, sharpe, trades });
        }
      }
      process.stdout.write(`\r  progreso: ${heavyCount}/${heavyTotal} combos pesados`);
    }
  }
  console.log('\n');

  const withSharpeM1 = resultsM1.filter((r) => r.sharpe !== null).sort((a, b) => b.sharpe - a.sharpe);
  const withSharpeM2 = resultsM2.filter((r) => r.sharpe !== null).sort((a, b) => b.sharpe - a.sharpe);

  console.log(`M1 combos con >=${MIN_TRADES} trades: ${withSharpeM1.length}/${resultsM1.length}`);
  console.log(`M2 combos con >=${MIN_TRADES} trades: ${withSharpeM2.length}/${resultsM2.length}\n`);

  console.log('=== Top 10 M1 (tenencia fija) por Sharpe en Backtest ===');
  console.log('rollingWindow  freeFloat  lookback  hold  sharpe  ganancia%   trades');
  for (const r of withSharpeM1.slice(0, 10)) console.log(fmtRow(r));

  console.log('\n=== Top 10 M2 (sale si ICD<0) por Sharpe en Backtest ===');
  console.log('rollingWindow  freeFloat  lookback  hold  sharpe  ganancia%   trades');
  for (const r of withSharpeM2.slice(0, 10)) console.log(fmtRow(r));

  const winnerM1 = withSharpeM1[0];
  const winnerM2 = withSharpeM2[0];
  console.log(`\nGanador M1: rollingWindow=${winnerM1.rollingWindow} freeFloatRatio=${winnerM1.freeFloatRatio} lookbackDays=${winnerM1.lookbackDays} holdDays=${winnerM1.holdDays} -> Sharpe=${winnerM1.sharpe.toFixed(2)}`);
  console.log(`Ganador M2: rollingWindow=${winnerM2.rollingWindow} freeFloatRatio=${winnerM2.freeFloatRatio} lookbackDays=${winnerM2.lookbackDays} -> Sharpe=${winnerM2.sharpe.toFixed(2)}`);

  const outM1 = outOfSampleCheck(
    'M1',
    winnerM1,
    (metrics, w) => simulateIcdRotationStrategy(metrics, w.lookbackDays, w.holdDays),
    sectorBars,
    historicalSize,
    priceBars
  );
  const outM2 = outOfSampleCheck(
    'M2',
    winnerM2,
    (metrics, w) => simulateIcdExitStrategy(metrics, w.lookbackDays),
    sectorBars,
    historicalSize,
    priceBars
  );

  console.log('\n=== Comparacion directa M1 vs M2 (Sharpe out-of-sample en Validacion) ===');
  console.log(`M1: ${outM1.validationSharpe !== null ? outM1.validationSharpe.toFixed(2) : 'n/a'}  (${outM1.sostenido ? 'se sostiene' : 'no se sostiene'})`);
  console.log(`M2: ${outM2.validationSharpe !== null ? outM2.validationSharpe.toFixed(2) : 'n/a'}  (${outM2.sostenido ? 'se sostiene' : 'no se sostiene'})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
