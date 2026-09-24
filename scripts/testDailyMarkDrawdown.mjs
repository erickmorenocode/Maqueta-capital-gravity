/**
 * Prueba OFFLINE (no toca engine.ts ni DensityLab.tsx) para responder:
 * el drawdown intra-posicion que aparecio al probar top-N (M5), ¿es un
 * artefacto de esa metodologia o afecta tambien a M1-M4 en produccion?
 *
 * Hipotesis: computeStrategyStats() calcula Max Drawdown/Calmar sobre la
 * curva de equity que le pasan -- y las curvas de produccion
 * (simulateIcd*Strategy) SOLO empujan un punto en cada evento de entrada
 * o salida, no dia a dia mientras la posicion esta abierta. Si el ticker
 * en cartera cae fuerte a mitad de la tenencia y se recupera antes de
 * salir, esa caida nunca se registra en la curva -- el Max Drawdown
 * queda subestimado independientemente de si la estrategia es N=1 o
 * top-N.
 *
 * Metodo: corre cada metodologia (M1-M4) normal, capturando los trades
 * reales con el parametro outTrades ya existente en el motor (mismos
 * entry/exit que produccion, cero logica nueva de trading). Reconstruye
 * una curva PARALELA marcando a mercado dia a dia durante cada tenencia
 * (usando los mismos precios de cierre), y compara Max Drawdown/Calmar
 * de esa curva densa contra la curva dispersa de produccion.
 *
 * Correr con:
 *   node --experimental-strip-types scripts/testDailyMarkDrawdown.mjs
 */

import YahooFinance from 'yahoo-finance2';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engine = await import('../src/lib/densityLab/engine.ts');

const {
  SECTOR_ETFS,
  BENCHMARK,
  BACKTEST_START,
  BACKTEST_END,
  VALIDATION_START,
  VALIDATION_END,
  LIVE_START,
  computeAllSectorsDensity,
  sliceWindow,
  simulateIcdRotationStrategy,
  simulateIcdExitStrategy,
  simulateIcdPriceVolFilterStrategy,
  simulateIcdRegimeSwitchStrategy,
  buildMarketRegimeMap,
  computeStrategyStats,
} = engine;

const ROLLING_WINDOW = 42;
const LOOKBACK_DAYS = 9;
const HOLD_DAYS = 5;
const FREE_FLOAT_RATIO = 0.95;
const PRICE_VOL_K = 0.25;

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
 * Reconstruye una curva marcada a mercado DIA A DIA a partir de la lista
 * real de trades (mismos entry/exit que produccion) -- entre trades
 * (sin posicion) no hace falta empujar puntos flat, no cambian
 * pico/valle. Dentro de cada trade, un punto por cada fecha con precio
 * disponible entre entryDate y exitDate (ambos inclusive).
 */
function dailyMarkFromTrades(trades, closeByTicker, allDatesSorted) {
  if (trades.length === 0) return [];
  const sorted = [...trades].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const curve = [];
  let equity = 1.0;

  for (const t of sorted) {
    const closes = closeByTicker[t.ticker];
    if (!closes) continue;
    for (const d of allDatesSorted) {
      if (d < t.entryDate) continue;
      if (d > t.exitDate) break;
      const c = closes.get(d);
      if (c === undefined) continue;
      curve.push({ date: d, value: equity * (c / t.entryPrice) });
    }
    equity *= t.exitPrice / t.entryPrice;
  }

  return curve.length >= 2 ? curve : [];
}

function fmt(stats) {
  const sharpe = stats.sharpe !== null ? stats.sharpe.toFixed(2) : 'n/a';
  const calmar = stats.calmarRatio === null ? 'n/a' : stats.calmarRatio === Infinity ? '∞' : stats.calmarRatio.toFixed(2);
  const dd = stats.maxDrawdownPct !== null ? '-' + stats.maxDrawdownPct.toFixed(1) + '%' : 'n/a';
  return `sharpe=${sharpe.padStart(5)} calmar=${calmar.padStart(5)} maxDD=${dd.padStart(7)}`;
}

async function main() {
  const allTickers = [...SECTOR_ETFS, BENCHMARK];
  const today = new Date().toISOString().slice(0, 10);
  console.log(`Descargando OHLCV ${BACKTEST_START} -> ${today} para ${allTickers.length} tickers...`);
  const priceResults = await Promise.all(allTickers.map((t) => downloadPriceHistory(t, BACKTEST_START, today)));
  const priceBars = {};
  allTickers.forEach((t, i) => {
    if (priceResults[i].length > 0) priceBars[t] = priceResults[i];
  });

  const historicalSize = JSON.parse(readFileSync(path.join(__dirname, '../src/lib/densityLab/historicalSize.json'), 'utf8'));
  const sectorBars = {};
  for (const t of SECTOR_ETFS) if (priceBars[t]) sectorBars[t] = priceBars[t];

  const fullMetrics = computeAllSectorsDensity(sectorBars, historicalSize, FREE_FLOAT_RATIO, ROLLING_WINDOW);
  const regimeMap = buildMarketRegimeMap(priceBars[BENCHMARK]);

  const methods = [
    { key: 'M1', label: 'M1 (tenencia fija 5d)', run: (win, trades) => simulateIcdRotationStrategy(win, LOOKBACK_DAYS, HOLD_DAYS, trades) },
    { key: 'M2', label: 'M2 (sale si ICD<0)   ', run: (win, trades) => simulateIcdExitStrategy(win, LOOKBACK_DAYS, trades) },
    { key: 'M3', label: 'M3 (filtro vol.precio)', run: (win, trades) => simulateIcdPriceVolFilterStrategy(win, LOOKBACK_DAYS, PRICE_VOL_K, 60, trades) },
    { key: 'M4', label: 'M4 (regimen SPY)     ', run: (win, trades) => simulateIcdRegimeSwitchStrategy(win, LOOKBACK_DAYS, PRICE_VOL_K, regimeMap, 60, trades) },
  ];

  const maxGap = { M1: 0, M2: 0, M3: 0, M4: 0 };

  for (const [label, start, end] of [
    ['BACKTEST (2018-2023)', BACKTEST_START, BACKTEST_END],
    ['VALIDACION (2024-2025)', VALIDATION_START, VALIDATION_END],
    ['LIVE (2026-presente)', LIVE_START, null],
  ]) {
    console.log(`\n=== ${label} ===`);
    const win = {};
    for (const [t, rows] of Object.entries(fullMetrics)) win[t] = sliceWindow(rows, start, end);

    const closeByTicker = {};
    for (const [t, rows] of Object.entries(win)) closeByTicker[t] = new Map(rows.map((r) => [r.date, r.close]));
    const allDatesSet = new Set();
    for (const rows of Object.values(win)) for (const r of rows) allDatesSet.add(r.date);
    const allDatesSorted = Array.from(allDatesSet).sort();

    for (const m of methods) {
      const trades = [];
      const sparseCurve = m.run(win, trades);
      const sparseStats = computeStrategyStats(sparseCurve);

      const denseCurve = dailyMarkFromTrades(trades, closeByTicker, allDatesSorted);
      const denseStats = computeStrategyStats(denseCurve);

      const ddGap =
        sparseStats.maxDrawdownPct !== null && denseStats.maxDrawdownPct !== null
          ? denseStats.maxDrawdownPct - sparseStats.maxDrawdownPct
          : null;
      if (ddGap !== null && ddGap > maxGap[m.key]) maxGap[m.key] = ddGap;

      console.log(`  ${m.label}  produccion (dispersa, ${sparseCurve.length}pts): ${fmt(sparseStats)}`);
      console.log(
        `  ${m.label}  daily mark  (densa,   ${denseCurve.length}pts): ${fmt(denseStats)}` +
          (ddGap !== null ? `   <- ${ddGap.toFixed(1)}pp mas de drawdown real` : '')
      );
    }
  }

  console.log('\n=== Resumen: peor brecha de Max Drawdown (densa - dispersa) por metodologia, entre las 3 ventanas ===');
  for (const [k, v] of Object.entries(maxGap)) {
    console.log(`  ${k}: hasta ${v.toFixed(1)} puntos porcentuales de drawdown no capturado por la curva de produccion`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
