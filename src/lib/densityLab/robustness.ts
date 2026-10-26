/**
 * Pruebas de robustez del backtest ICD -- modulo aparte, NO toca la
 * logica de engine.ts ni las ventanas Backtest/Validacion/Live
 * originales. Solo consume las curvas/trades que ya producen las
 * simulate*Strategy existentes y las re-evalua bajo:
 *
 *  1. Ventanas In-Sample / Out-of-Sample alternativas (walk-forward
 *     rodante, anclado, inverso y personalizado) sobre 2018-2025, sin la
 *     ventana Live (año en curso).
 *  2. Omision de los mejores / peores años calendario.
 *  3. Costos de transaccion: comision fija en USD por transaccion (compra
 *     o venta) sobre un capital inicial dado, mas slippage opcional en bps.
 *
 * Todas las metricas de este modulo se calculan sobre una GRILLA DIARIA
 * comun (dias de trading de SPY), con forward-fill de la equity de la
 * estrategia en los dias sin posicion abierta (retorno 0). Por eso el
 * Sharpe aca (anualizado con 252) puede diferir levemente del que muestra
 * la pestana Backtesting Cuantitativo, que anualiza sobre los puntos de
 * la curva -- las comparaciones validas son DENTRO de esta pestana.
 */

import type { DensityRow, EquityPoint, PriceBar, Trade } from './engine';

/** Fin de los datos usados por las pruebas de robustez: excluye la ventana Live (año en curso). */
export const ROBUSTNESS_START = '2018-01-01';
export const ROBUSTNESS_END = '2025-12-31';
export const ROBUSTNESS_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

export type RunStrategyFn = (win: Record<string, DensityRow[]>, lookbackDays: number, outTrades: Trade[]) => EquityPoint[];

export interface CostConfig {
  /** Capital inicial en USD -- la comision es fija en USD, asi que su impacto relativo depende del tamaño de la cuenta. */
  capital: number;
  /** USD por transaccion (cada compra y cada venta cuenta como una transaccion). */
  commission: number;
  /** Deslizamiento por transaccion en puntos basicos (1 bp = 0.01%). */
  slippageBps: number;
}

export const NO_COSTS: CostConfig = { capital: 10000, commission: 0, slippageBps: 0 };

export interface PeriodMetrics {
  totalReturnPct: number;
  cagrPct: number;
  sharpe: number | null;
  maxDrawdownPct: number;
  calmar: number | null;
  /** Numero de posiciones (entrada + salida). */
  trades: number;
  /** Numero de transacciones cobradas (2 por trade). */
  transactions: number;
  /** Costos totales pagados en USD (comision + slippage). */
  totalCostUsd: number;
}

export function sliceAll(sectorMetrics: Record<string, DensityRow[]>, start: string, end: string): Record<string, DensityRow[]> {
  const out: Record<string, DensityRow[]> = {};
  for (const [t, rows] of Object.entries(sectorMetrics)) {
    const sliced = rows.filter((r) => r.date >= start && r.date <= end);
    if (sliced.length > 0) out[t] = sliced;
  }
  return out;
}

/** Dias de trading de SPY en [start, end] -- grilla diaria comun para estrategia y benchmark. */
export function tradingGrid(spyBars: PriceBar[], start: string, end: string): string[] {
  return spyBars.filter((b) => b.date >= start && b.date <= end).map((b) => b.date);
}

/**
 * Lleva la curva de la estrategia (que solo tiene puntos mientras hay
 * posicion abierta) a la grilla diaria: forward-fill del ultimo valor
 * conocido, 1.0 antes del primer trade. Normalizada a 1.0 en el primer
 * dia de la grilla.
 */
export function toDailyGrid(curve: EquityPoint[], grid: string[]): EquityPoint[] {
  if (grid.length === 0) return [];
  const sorted = [...curve].sort((a, b) => a.date.localeCompare(b.date));
  const out: EquityPoint[] = [];
  let j = 0;
  let last = sorted.length > 0 ? sorted[0].value : 1;
  for (const d of grid) {
    while (j < sorted.length && sorted[j].date <= d) {
      last = sorted[j].value;
      j++;
    }
    out.push({ date: d, value: last });
  }
  const base = out[0].value || 1;
  return out.map((p) => ({ date: p.date, value: p.value / base }));
}

/**
 * Aplica costos de transaccion a una curva diaria bruta. Cada trade cobra
 * dos transacciones: una en la fecha de entrada y otra en la de salida
 * (incluida la liquidacion forzada al final del periodo, criterio
 * conservador). Comision fija en USD sobre el valor en dolares de la
 * cuenta en ese momento + slippage proporcional. Si la fecha del evento no
 * esta en la grilla, se cobra en el siguiente dia de la grilla.
 */
export function applyCosts(
  dailyGross: EquityPoint[],
  trades: Trade[],
  costs: CostConfig
): { curve: EquityPoint[]; totalCostUsd: number; transactions: number } {
  if (dailyGross.length === 0) return { curve: [], totalCostUsd: 0, transactions: 0 };
  const events: string[] = [];
  const first = dailyGross[0].date;
  const last = dailyGross[dailyGross.length - 1].date;
  for (const t of trades) {
    if (t.entryDate >= first && t.entryDate <= last) events.push(t.entryDate);
    if (t.exitDate >= first && t.exitDate <= last) events.push(t.exitDate);
  }
  events.sort();

  const hasCosts = costs.commission > 0 || costs.slippageBps > 0;
  const slipFactor = 1 - costs.slippageBps / 10000;
  let mult = 1;
  let totalCostUsd = 0;
  let k = 0;
  const curve: EquityPoint[] = [];
  for (const p of dailyGross) {
    while (k < events.length && events[k] <= p.date) {
      if (hasCosts) {
        const dollars = costs.capital * p.value * mult;
        if (dollars > 0) {
          const afterCommission = Math.max(0, dollars - costs.commission);
          const after = afterCommission * slipFactor;
          totalCostUsd += dollars - after;
          mult *= after / dollars;
        }
      }
      k++;
    }
    curve.push({ date: p.date, value: p.value * mult });
  }
  return { curve, totalCostUsd, transactions: events.length };
}

/**
 * Retorno de un paso de la curva. Si la cuenta ya quedo en 0 (las
 * comisiones fijas se comieron todo el capital -- pasa con cuentas chicas
 * y mucha rotacion), los dias siguientes cuentan como retorno 0 en vez de
 * 0/0 = NaN: la cuenta quedo arruinada y ahi se queda.
 */
function stepReturn(prev: number, cur: number): number {
  return prev > 0 ? cur / prev - 1 : 0;
}

/** Metricas sobre una curva diaria (un punto por dia de trading). */
export function dailyMetrics(curve: EquityPoint[], trades = 0, transactions = 0, totalCostUsd = 0): PeriodMetrics | null {
  if (curve.length < 2) return null;
  const rets: number[] = [];
  for (let i = 1; i < curve.length; i++) rets.push(stepReturn(curve[i - 1].value, curve[i].value));
  return metricsFromReturns(rets, trades, transactions, totalCostUsd);
}

/**
 * Metricas desde una serie de retornos diarios (puede venir "cosida" de
 * años no contiguos en la prueba de omision de años). CAGR anualiza por
 * numero de dias de trading (252/año), no por calendario, para que la
 * serie cosida no cuente los huecos de los años omitidos.
 */
export function metricsFromReturns(rets: number[], trades = 0, transactions = 0, totalCostUsd = 0): PeriodMetrics | null {
  if (rets.length < 2) return null;
  let v = 1;
  let peak = 1;
  let maxDd = 0;
  for (const r of rets) {
    v *= 1 + r;
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }
  const years = rets.length / 252;
  const cagr = v > 0 ? Math.pow(v, 1 / years) - 1 : -1;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : null;
  const calmar = maxDd > 0 ? cagr / maxDd : cagr > 0 ? Infinity : null;
  return {
    totalReturnPct: (v - 1) * 100,
    cagrPct: cagr * 100,
    sharpe,
    maxDrawdownPct: maxDd * 100,
    calmar,
    trades,
    transactions,
    totalCostUsd,
  };
}

export interface PeriodResult {
  start: string;
  end: string;
  gross: PeriodMetrics | null;
  net: PeriodMetrics | null;
  spy: PeriodMetrics | null;
  /** Curvas diarias (para graficar). */
  grossCurve: EquityPoint[];
  netCurve: EquityPoint[];
  spyCurve: EquityPoint[];
  trades: Trade[];
}

/**
 * Corre la estrategia SOLO con los datos de [start, end] (mismo criterio
 * de recorte que las ventanas originales: la estrategia arranca de cero
 * en `start`) y devuelve metricas bruto/neto/SPY sobre la grilla diaria.
 */
export function evaluatePeriod(
  sectorMetrics: Record<string, DensityRow[]>,
  spyBars: PriceBar[],
  run: RunStrategyFn,
  lookbackDays: number,
  start: string,
  end: string,
  costs: CostConfig
): PeriodResult {
  const trades: Trade[] = [];
  const curve = run(sliceAll(sectorMetrics, start, end), lookbackDays, trades);
  const grid = tradingGrid(spyBars, start, end);
  const grossCurve = curve.length > 0 ? toDailyGrid(curve, grid) : grid.map((d) => ({ date: d, value: 1 }));
  const { curve: netCurve, totalCostUsd, transactions } = applyCosts(grossCurve, trades, costs);
  const spyWindow = spyBars.filter((b) => b.date >= start && b.date <= end);
  const spyBase = spyWindow[0]?.close;
  const spyCurve = spyBase ? spyWindow.map((b) => ({ date: b.date, value: b.close / spyBase })) : [];
  return {
    start,
    end,
    gross: dailyMetrics(grossCurve, trades.length, transactions, 0),
    net: dailyMetrics(netCurve, trades.length, transactions, totalCostUsd),
    spy: dailyMetrics(spyCurve),
    grossCurve,
    netCurve,
    spyCurve,
    trades,
  };
}

// ─── 1. Ventanas In-Sample / Out-of-Sample alternativas ─────────────────

export interface SplitDef {
  label: string;
  isStart: string;
  isEnd: string;
  oosStart: string;
  oosEnd: string;
}

export type SplitScheme = 'rolling' | 'anchored' | 'inverse' | 'custom';

const y0 = (y: number) => `${y}-01-01`;
const y1 = (y: number) => `${y}-12-31`;

/**
 * Esquemas de particion sobre 2018-2025 (sin Live):
 * - rolling: IS de 3 años que avanza 1 año, OOS = el año siguiente.
 * - anchored: IS siempre arranca en 2018 y se expande, OOS = año siguiente.
 * - inverse: el OOS va ANTES del IS (prueba si lo aprendido en datos
 *   recientes hubiera funcionado en el pasado -- otro regimen de mercado).
 */
export function buildSplits(scheme: SplitScheme, custom?: { isFrom: number; isTo: number; oosFrom: number; oosTo: number }): SplitDef[] {
  if (scheme === 'rolling') {
    const out: SplitDef[] = [];
    for (let oos = 2021; oos <= 2025; oos++) {
      out.push({ label: `IS ${oos - 3}-${oos - 1} / OOS ${oos}`, isStart: y0(oos - 3), isEnd: y1(oos - 1), oosStart: y0(oos), oosEnd: y1(oos) });
    }
    return out;
  }
  if (scheme === 'anchored') {
    const out: SplitDef[] = [];
    for (let oos = 2020; oos <= 2025; oos++) {
      out.push({ label: `IS 2018-${oos - 1} / OOS ${oos}`, isStart: y0(2018), isEnd: y1(oos - 1), oosStart: y0(oos), oosEnd: y1(oos) });
    }
    return out;
  }
  if (scheme === 'inverse') {
    return [
      { label: 'IS 2022-2025 / OOS 2018-2021', isStart: y0(2022), isEnd: y1(2025), oosStart: y0(2018), oosEnd: y1(2021) },
      { label: 'IS 2020-2025 / OOS 2018-2019', isStart: y0(2020), isEnd: y1(2025), oosStart: y0(2018), oosEnd: y1(2019) },
      { label: 'IS 2023-2025 / OOS 2020-2022', isStart: y0(2023), isEnd: y1(2025), oosStart: y0(2020), oosEnd: y1(2022) },
    ];
  }
  if (!custom) return [];
  return [
    {
      label: `IS ${custom.isFrom}-${custom.isTo} / OOS ${custom.oosFrom}-${custom.oosTo}`,
      isStart: y0(custom.isFrom),
      isEnd: y1(custom.isTo),
      oosStart: y0(custom.oosFrom),
      oosEnd: y1(custom.oosTo),
    },
  ];
}

export interface SplitResult {
  split: SplitDef;
  /** Lookback usado en este split (el de la barra lateral, o el optimizado en IS). */
  lookbackUsed: number;
  is: PeriodResult;
  oos: PeriodResult;
  /** Calmar neto OOS / Calmar neto IS -- 1.0 = sin degradacion. null si no es comparable. */
  calmarRetention: number | null;
}

export const LOOKBACK_GRID = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Evalua cada split. Con `optimizeLookback`, hace un walk-forward real:
 * elige el lookback (1-10d) que maximiza el Calmar NETO en el IS y lo
 * aplica sin cambios en el OOS. Sin optimizacion, usa el lookback de la
 * barra lateral en ambos (IS es solo una ventana de referencia).
 */
export function evaluateSplits(
  splits: SplitDef[],
  sectorMetrics: Record<string, DensityRow[]>,
  spyBars: PriceBar[],
  run: RunStrategyFn,
  lookbackDays: number,
  costs: CostConfig,
  optimizeLookback: boolean
): SplitResult[] {
  return splits.map((split) => {
    let lookbackUsed = lookbackDays;
    let isResult: PeriodResult | null = null;
    if (optimizeLookback) {
      let bestScore = -Infinity;
      for (const lb of LOOKBACK_GRID) {
        const r = evaluatePeriod(sectorMetrics, spyBars, run, lb, split.isStart, split.isEnd, costs);
        const c = r.net?.calmar;
        const score = c === null || c === undefined ? -Infinity : Number.isFinite(c) ? c : 1e6;
        if (score > bestScore) {
          bestScore = score;
          lookbackUsed = lb;
          isResult = r;
        }
      }
    }
    const is = isResult ?? evaluatePeriod(sectorMetrics, spyBars, run, lookbackUsed, split.isStart, split.isEnd, costs);
    const oos = evaluatePeriod(sectorMetrics, spyBars, run, lookbackUsed, split.oosStart, split.oosEnd, costs);
    const cIs = is.net?.calmar;
    const cOos = oos.net?.calmar;
    const calmarRetention =
      cIs !== null && cIs !== undefined && cOos !== null && cOos !== undefined && Number.isFinite(cIs) && Number.isFinite(cOos) && cIs > 0
        ? cOos / cIs
        : null;
    return { split, lookbackUsed, is, oos, calmarRetention };
  });
}

// ─── 2. Omitir mejores / peores años ────────────────────────────────────

export interface YearRow {
  year: number;
  grossPct: number;
  netPct: number;
  spyPct: number;
}

function dailyReturnsByYear(curve: EquityPoint[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let i = 1; i < curve.length; i++) {
    const y = Number(curve[i].date.slice(0, 4));
    const r = stepReturn(curve[i - 1].value, curve[i].value);
    if (!out.has(y)) out.set(y, []);
    out.get(y)!.push(r);
  }
  return out;
}

const compound = (rets: number[]) => rets.reduce((v, r) => v * (1 + r), 1) - 1;

export interface YearScenario {
  key: 'all' | 'noBest' | 'noWorst' | 'noBoth';
  label: string;
  excluded: number[];
  gross: PeriodMetrics | null;
  net: PeriodMetrics | null;
  spy: PeriodMetrics | null;
}

/**
 * Corre la estrategia de corrido sobre 2018-2025 (una sola simulacion, no
 * encadenada por ventanas), parte los retornos diarios por año calendario
 * y arma escenarios omitiendo los N mejores / peores años. El ranking de
 * años se hace por retorno NETO de la estrategia o por retorno de SPY
 * (`rankBy`). Los años restantes se "cosen" uno detras de otro y se
 * recalculan las metricas sobre esa serie.
 */
export function evaluateYearOmission(
  full: PeriodResult,
  n: number,
  rankBy: 'strategy' | 'spy'
): { years: YearRow[]; scenarios: YearScenario[] } {
  const g = dailyReturnsByYear(full.grossCurve);
  const ne = dailyReturnsByYear(full.netCurve);
  const s = dailyReturnsByYear(full.spyCurve);
  const yearsList = [...ne.keys()].sort((a, b) => a - b);
  const years: YearRow[] = yearsList.map((y) => ({
    year: y,
    grossPct: compound(g.get(y) ?? []) * 100,
    netPct: compound(ne.get(y) ?? []) * 100,
    spyPct: compound(s.get(y) ?? []) * 100,
  }));

  const ranked = [...years].sort((a, b) => (rankBy === 'strategy' ? b.netPct - a.netPct : b.spyPct - a.spyPct));
  const nEff = Math.max(0, Math.min(n, Math.floor((years.length - 1) / 2)));
  const best = ranked.slice(0, nEff).map((r) => r.year);
  const worst = ranked.slice(ranked.length - nEff).map((r) => r.year);

  const tradesInYears = (keep: Set<number>) => {
    const ts = full.trades.filter((t) => keep.has(Number(t.exitDate.slice(0, 4))));
    return ts.length;
  };

  const build = (key: YearScenario['key'], label: string, excluded: number[]): YearScenario => {
    const ex = new Set(excluded);
    const keep = new Set(yearsList.filter((y) => !ex.has(y)));
    const pick = (m: Map<number, number[]>) => yearsList.filter((y) => keep.has(y)).flatMap((y) => m.get(y) ?? []);
    const nTrades = tradesInYears(keep);
    return {
      key,
      label,
      excluded: [...excluded].sort((a, b) => a - b),
      gross: metricsFromReturns(pick(g), nTrades, nTrades * 2),
      net: metricsFromReturns(pick(ne), nTrades, nTrades * 2),
      spy: metricsFromReturns(pick(s)),
    };
  };

  const scenarios: YearScenario[] = [build('all', 'Todos los años', [])];
  if (nEff > 0) {
    scenarios.push(build('noBest', `Sin ${nEff} mejor${nEff > 1 ? 'es' : ''} año${nEff > 1 ? 's' : ''}`, best));
    scenarios.push(build('noWorst', `Sin ${nEff} peor${nEff > 1 ? 'es' : ''} año${nEff > 1 ? 's' : ''}`, worst));
    scenarios.push(build('noBoth', `Sin ${nEff} mejor${nEff > 1 ? 'es' : ''} ni ${nEff} peor${nEff > 1 ? 'es' : ''}`, [...best, ...worst]));
  }
  return { years, scenarios };
}

// ─── 3. Barrido de costos ───────────────────────────────────────────────

export const COMMISSION_LEVELS = [0, 0.5, 1, 1.5, 2];
export const CAPITAL_LEVELS = [1000, 5000, 10000, 25000, 100000];

/** Re-aplica costos sobre una curva bruta ya simulada (no re-corre la estrategia). */
export function netMetricsFor(full: PeriodResult, costs: CostConfig): PeriodMetrics | null {
  const { curve, totalCostUsd, transactions } = applyCosts(full.grossCurve, full.trades, costs);
  return dailyMetrics(curve, full.trades.length, transactions, totalCostUsd);
}

/**
 * Comision (USD/transaccion) a partir de la cual el CAGR neto de la
 * estrategia queda por debajo del CAGR de SPY buy&hold en el mismo
 * periodo. Biseccion en [0, maxCommission]. null si ni sin costos le gana
 * a SPY; Infinity si sigue ganando aun con maxCommission.
 */
export function breakEvenCommission(full: PeriodResult, capital: number, slippageBps: number, maxCommission = 100): number | null {
  const spyCagr = full.spy?.cagrPct;
  if (spyCagr === undefined) return null;
  const cagrAt = (c: number) => netMetricsFor(full, { capital, commission: c, slippageBps })?.cagrPct ?? -Infinity;
  if (cagrAt(0) <= spyCagr) return null;
  if (cagrAt(maxCommission) > spyCagr) return Infinity;
  let lo = 0;
  let hi = maxCommission;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (cagrAt(mid) > spyCagr) lo = mid;
    else hi = mid;
  }
  return lo;
}
