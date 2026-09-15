/**
 * Prueba OFFLINE (no toca engine.ts ni DensityLab.tsx) de Metodologia 4:
 * portafolio de estrategias -- cambia de regla de ENTRADA segun el
 * regimen de volatilidad del mercado (SPY), en vez de usar siempre la
 * misma regla.
 *
 * M2 y M3 comparten la MISMA regla de salida (ICD<0) y el MISMO ranking
 * (mayor delta de ICD) -- solo difieren en si exigen o no que el
 * movimiento de PRECIO del ganador supere k*su propia volatilidad
 * (filtro de M3). Eso simplifica M4: no hace falta alternar dos motores
 * distintos, alcanza con prender/apagar el filtro de M3 segun el
 * regimen:
 *
 *   - Regimen de ALTA volatilidad (crisis, tipo COVID/2022 -- donde el
 *     hallazgo de esta sesion fue que reaccionar RAPIDO sin esperar
 *     confirmacion protege capital): usa M2 puro, sin filtro.
 *   - Regimen de BAJA volatilidad (mercado calmo/rango, tipo
 *     Validacion/Live 2024-2026 -- donde el filtro de M3 evito el
 *     whipsaw de XLE): usa M3, con el filtro de vol. de precio (k=0.25).
 *
 * Regimen se mide de forma ADAPTATIVA, no con un numero magico fijo:
 * volatilidad diaria realizada de SPY (ventana VOL_WINDOW) comparada
 * contra su propia mediana movil de mas largo plazo (REGIME_WINDOW) --
 * "alto" o "bajo" relativo a la historia RECIENTE del propio SPY, no un
 * umbral absoluto que no generalizaria entre 2018 y 2026. Solo usa datos
 * pasados (sin look-ahead).
 *
 * Compara M4 contra M2 puro y M3 puro (k=0.25) en Backtest, Validacion y
 * Live con los defaults de produccion (rollingWindow=42, lookbackDays=9,
 * universo 13). Retorno de SPY siempre calculado real (ventana completa,
 * dia a dia -- ver fix de DensityLab.tsx), no recortado a fechas de
 * trade.
 *
 * Correr con:
 *   node --experimental-strip-types scripts/testRegimeSwitchM4.mjs
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
  LIVE_START,
  computeAllSectorsDensity,
  sliceWindow,
  simulateIcdExitStrategy,
  simulateIcdPriceVolFilterStrategy,
  computeStrategyStats,
  buyAndHoldCurve,
} = engine;

const ROLLING_WINDOW = 42;
const LOOKBACK_DAYS = 9;
const FREE_FLOAT_RATIO = 0.95;
const PRICE_VOL_K = 0.25;
const PRICE_VOL_WINDOW = 60; // igual que M3 en produccion
const SPY_VOL_WINDOW = 20; // volatilidad realizada de SPY, corto plazo
const REGIME_WINDOW = 252; // mediana movil de esa volatilidad, ~1 año

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

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Regimen por fecha: 'high' o 'low', segun vol realizada de SPY vs su propia mediana movil de mas largo plazo. Solo pasado. */
function buildRegimeMap(spyBars) {
  const dailyRets = [];
  for (let i = 1; i < spyBars.length; i++) dailyRets.push(spyBars[i].close / spyBars[i - 1].close - 1);

  const shortVol = new Map(); // date -> vol realizada 20d
  for (let i = SPY_VOL_WINDOW - 1; i < dailyRets.length; i++) {
    const window = dailyRets.slice(i - SPY_VOL_WINDOW + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1);
    shortVol.set(spyBars[i + 1].date, Math.sqrt(variance));
  }

  const shortVolDates = [...shortVol.keys()].sort();
  const shortVolVals = shortVolDates.map((d) => shortVol.get(d));

  const regime = new Map();
  for (let i = REGIME_WINDOW - 1; i < shortVolDates.length; i++) {
    const window = shortVolVals.slice(i - REGIME_WINDOW + 1, i + 1);
    const med = median(window);
    regime.set(shortVolDates[i], shortVolVals[i] > med ? 'high' : 'low');
  }
  return regime;
}

/** M4: igual ranking/salida que M2/M3, pero solo exige el filtro de vol. de precio (M3) cuando el regimen de SPY es 'low'. En 'high', entra como M2 (sin filtro). */
function simulateRegimeSwitch(sectorMetrics, lookbackDays, k, priceVolWindow, regimeMap) {
  const tickers = Object.keys(sectorMetrics).filter((t) => sectorMetrics[t].some((r) => r.ICD !== null));
  if (tickers.length === 0) return [];

  const icdByTicker = {};
  const closeByTicker = {};
  const dailyVolByTicker = {};
  const priceReturnByTicker = {};

  for (const t of tickers) {
    const rows = sectorMetrics[t];
    icdByTicker[t] = new Map(rows.map((r) => [r.date, r.ICD]));
    closeByTicker[t] = new Map(rows.map((r) => [r.date, r.close]));

    const dailyVol = new Map();
    const dailyRets = [];
    for (let i = 1; i < rows.length; i++) dailyRets.push(rows[i].close / rows[i - 1].close - 1);
    for (let i = priceVolWindow - 1; i < dailyRets.length; i++) {
      const window = dailyRets.slice(i - priceVolWindow + 1, i + 1);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1);
      dailyVol.set(rows[i + 1].date, Math.sqrt(variance));
    }
    dailyVolByTicker[t] = dailyVol;

    const priceReturn = new Map();
    for (let i = lookbackDays; i < rows.length; i++) {
      const now = rows[i].close;
      const before = rows[i - lookbackDays].close;
      if (before === 0) continue;
      priceReturn.set(rows[i].date, now / before - 1);
    }
    priceReturnByTicker[t] = priceReturn;
  }

  const dateSet = new Set();
  for (const t of tickers) for (const r of sectorMetrics[t]) dateSet.add(r.date);
  const dates = Array.from(dateSet).sort();

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
  let position = null;
  let regimeCounts = { high: 0, low: 0, unknown: 0 };

  for (let i = lookbackDays; i < dates.length; i++) {
    const date = dates[i];

    if (position) {
      const icdNow = icdByTicker[position.ticker].get(date);
      const closeNow = closeByTicker[position.ticker].get(date);
      if (icdNow !== null && icdNow !== undefined && icdNow < 0 && closeNow !== undefined) {
        equityValue *= 1 + (closeNow / position.entryPrice - 1);
        equity.push({ date, value: equityValue });
        position = null;
      }
    }

    if (!position) {
      const lookbackDate = dates[i - lookbackDays];
      const bestTicker = pickBestTicker(date, lookbackDate);
      if (bestTicker !== null) {
        const regime = regimeMap.get(date);
        if (regime === 'high') regimeCounts.high++;
        else if (regime === 'low') regimeCounts.low++;
        else regimeCounts.unknown++;

        let qualifies;
        if (regime === 'low') {
          const priceReturn = priceReturnByTicker[bestTicker].get(date);
          const dailyVol = dailyVolByTicker[bestTicker].get(date);
          const sigmaLookback = dailyVol !== undefined ? dailyVol * Math.sqrt(lookbackDays) : undefined;
          qualifies = priceReturn !== undefined && sigmaLookback !== undefined && priceReturn >= k * sigmaLookback;
        } else {
          // regimen 'high' o desconocido (sin suficiente historia para clasificar): entra como M2, sin filtro.
          qualifies = true;
        }

        if (qualifies) {
          const entryPrice = closeByTicker[bestTicker].get(date);
          if (entryPrice !== undefined) {
            position = { ticker: bestTicker, entryPrice };
            if (equity.length === 0) equity.push({ date, value: 1.0 });
          }
        }
      }
    }
  }

  if (position) {
    const lastDate = dates[dates.length - 1];
    const lastClose = closeByTicker[position.ticker].get(lastDate);
    if (lastClose !== undefined) {
      equityValue *= 1 + (lastClose / position.entryPrice - 1);
      equity.push({ date: lastDate, value: equityValue });
    }
  }

  const curve = equity.length >= 2 ? equity : [];
  curve.regimeCounts = regimeCounts;
  return curve;
}

function fmt(stats, curve) {
  const gain = curve.length >= 2 ? ((curve[curve.length - 1].value / curve[0].value - 1) * 100).toFixed(1) + '%' : 'n/a';
  const sharpe = stats.sharpe !== null ? stats.sharpe.toFixed(2) : 'n/a';
  const pf = stats.profitFactor === null ? 'n/a' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2);
  const rb = stats.riskReward !== null ? stats.riskReward.toFixed(2) : 'n/a';
  return `trades=${String(stats.trades).padStart(3)} sharpe=${sharpe.padStart(5)} PF=${pf.padStart(5)} R:B=${rb.padStart(5)} gain=${gain.padStart(8)}`;
}

async function main() {
  const allTickers = [...SECTOR_ETFS, 'SPY'];
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
  const regimeMap = buildRegimeMap(priceBars.SPY);

  const sharpes = { M2: [], M3: [], M4: [] };
  const gains = { M2: [], M3: [], M4: [] };

  for (const [label, start, end] of [
    ['BACKTEST (2018-2023)', BACKTEST_START, BACKTEST_END],
    ['VALIDACION (2024-2025)', VALIDATION_START, VALIDATION_END],
    ['LIVE (2026-presente)', LIVE_START, null],
  ]) {
    console.log(`\n=== ${label} ===`);
    const win = {};
    for (const [t, rows] of Object.entries(fullMetrics)) win[t] = sliceWindow(rows, start, end);

    const curveM2 = simulateIcdExitStrategy(win, LOOKBACK_DAYS);
    const statsM2 = computeStrategyStats(curveM2);
    console.log('  M2 (sin filtro):        ' + fmt(statsM2, curveM2));
    sharpes.M2.push(statsM2.sharpe ?? NaN);
    gains.M2.push(curveM2.length >= 2 ? curveM2[curveM2.length - 1].value / curveM2[0].value - 1 : NaN);

    const curveM3 = simulateIcdPriceVolFilterStrategy(win, LOOKBACK_DAYS, PRICE_VOL_K);
    const statsM3 = computeStrategyStats(curveM3);
    console.log('  M3 (filtro vol. precio):' + fmt(statsM3, curveM3));
    sharpes.M3.push(statsM3.sharpe ?? NaN);
    gains.M3.push(curveM3.length >= 2 ? curveM3[curveM3.length - 1].value / curveM3[0].value - 1 : NaN);

    const curveM4 = simulateRegimeSwitch(win, LOOKBACK_DAYS, PRICE_VOL_K, PRICE_VOL_WINDOW, regimeMap);
    const statsM4 = computeStrategyStats(curveM4);
    console.log('  M4 (regimen SPY):       ' + fmt(statsM4, curveM4) + `  [regimen en entradas: alto=${curveM4.regimeCounts.high} bajo=${curveM4.regimeCounts.low} sin-clasificar=${curveM4.regimeCounts.unknown}]`);
    sharpes.M4.push(statsM4.sharpe ?? NaN);
    gains.M4.push(curveM4.length >= 2 ? curveM4[curveM4.length - 1].value / curveM4[0].value - 1 : NaN);

    const spyWindow = priceBars.SPY.filter((b) => b.date >= start && (end === null || b.date <= end));
    const spyFull = buyAndHoldCurve(spyWindow, spyWindow.map((b) => b.date));
    const spyGain = spyFull.length >= 2 ? ((spyFull[spyFull.length - 1].value / spyFull[0].value - 1) * 100).toFixed(1) + '%' : 'n/a';
    console.log('  SPY real (ventana completa): ' + spyGain);
  }

  console.log('\n=== Resumen de robustez: minimo de Sharpe y ganancia entre las 3 ventanas ===');
  for (const name of ['M2', 'M3', 'M4']) {
    const minSharpe = Math.min(...sharpes[name]);
    const minGain = Math.min(...gains[name]) * 100;
    console.log(`  ${name}: minSharpe=${minSharpe.toFixed(2)}  minGain=${minGain.toFixed(1)}%  (Backtest/Validacion/Live sharpe: ${sharpes[name].map((s) => s.toFixed(2)).join('/')})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
