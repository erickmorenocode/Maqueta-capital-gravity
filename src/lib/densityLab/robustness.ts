/**
 * Pruebas de robustez del backtest ICD -- modulo aparte, NO toca la
 * logica de engine.ts ni las ventanas Backtest/Validacion/Live
 * originales. Solo consume las curvas/trades que ya producen las
 * simulate*Strategy existentes y las re-evalua bajo:
 *
 *  1. Ventanas In-Sample / Out-of-Sample alternativas (walk-forward
 *     rodante, anclado, inverso y personalizado por fechas) sobre el
 *     periodo en que TODOS los ETFs tienen datos reales completos (ver
 *     prepareCommonData) hasta 2025, sin la ventana Live (año en curso).
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

import type { DensityRow, EquityPoint, MarketRegime, PriceBar, SizeAnchor, Trade } from './engine';

/**
 * Desde donde se piden precios a Yahoo para esta pestana: todo el
 * historial que exista. Precios reales disponibles (verificado contra
 * Yahoo): XLK/XLF/XLE/XLV/XLY/XLP/XLI/XLB/XLU desde 1998-12-22, QQQ desde
 * 1999-03-10, GLD desde 2004-11, XLRE desde 2015-10, XLC desde 2018-06,
 * SPY desde 1993. El rango efectivo NO es este: prepareCommonData lo
 * recorta a la fecha en que TODOS los ETFs tienen precio + tamaño real
 * (hoy lo fija el ETF/ancla mas tardio). Pedir todo deja el rango listo
 * para crecer solo si en el futuro se agregan anclas EDGAR mas viejas.
 */
export const EXTENDED_FETCH_FROM = '1997-01-01';
/** Fin de los datos usados por las pruebas de robustez: excluye la ventana Live (año en curso). */
export const ROBUSTNESS_END = '2025-12-31';

export type RunStrategyFn = (
  win: Record<string, DensityRow[]>,
  lookbackDays: number,
  regimeMap: Map<string, MarketRegime>,
  outTrades: Trade[]
) => EquityPoint[];

interface RawRun {
  end: string;
  curve: EquityPoint[];
  trades: Trade[];
}

/**
 * Datos + estrategia de una sesion de pruebas. `cache` guarda la corrida
 * BRUTA (sin costos): cambiar comision, capital o slippage no re-simula
 * la estrategia, solo re-aplica costos.
 *
 * `prefixReuse`: M2/M3/M4 son causales (cada dia solo mira datos pasados
 * del propio recorte: ICD, vol. de precio 60d, retorno de lookback,
 * regimen), asi que la corrida sobre [inicio, B] es identica a la de
 * [inicio, A] hasta A, salvo la liquidacion forzada de la posicion
 * abierta en A. Con este flag, periodos con el mismo inicio se recortan
 * de UNA sola corrida larga (truncateRun) en vez de re-simular -- lo que
 * vuelve viable el walk-forward anclado optimizado sobre 25+ años. M1
 * (tenencia fija) NO es prefijo-seguro: en un recorte corto descarta el
 * ultimo trade si no le alcanzan los dias de tenencia, en vez de cerrarlo
 * al final -- por eso se desactiva para M1.
 */
export interface RobustnessContext {
  sectorMetrics: Record<string, DensityRow[]>;
  spyBars: PriceBar[];
  run: RunStrategyFn;
  regimeMap: Map<string, MarketRegime>;
  prefixReuse: boolean;
  cache: Map<string, RawRun>;
}

export function createContext(
  sectorMetrics: Record<string, DensityRow[]>,
  spyBars: PriceBar[],
  run: RunStrategyFn,
  regimeMap: Map<string, MarketRegime>,
  prefixReuse: boolean
): RobustnessContext {
  return { sectorMetrics, spyBars, run, regimeMap, prefixReuse, cache: new Map() };
}

/**
 * Recorta una corrida larga a `end`: mismos puntos de equity hasta `end`
 * y la posicion abierta en `end` se cierra al ultimo valor marcado a
 * mercado (equivalente a la liquidacion forzada que hace la propia
 * estrategia al final de un recorte).
 */
function truncateRun(raw: RawRun, end: string): RawRun {
  const curve = raw.curve.filter((p) => p.date <= end);
  const trades: Trade[] = [];
  const lastPoint = curve[curve.length - 1];
  for (const t of raw.trades) {
    if (t.exitDate <= end) {
      trades.push(t);
    } else if (t.entryDate <= end && lastPoint) {
      const entryPoint = curve.find((p) => p.date === t.entryDate && p.value > 0);
      if (!entryPoint) continue;
      const exitPrice = t.entryPrice * (lastPoint.value / entryPoint.value);
      trades.push({ ...t, exitDate: lastPoint.date, exitPrice, returnPct: (exitPrice / t.entryPrice - 1) * 100 });
    }
  }
  return { end, curve: curve.length >= 2 ? curve : [], trades };
}

function getRawRun(ctx: RobustnessContext, lookbackDays: number, start: string, end: string, runTo?: string): RawRun {
  if (!ctx.prefixReuse) {
    const key = `${lookbackDays}|${start}|${end}`;
    let raw = ctx.cache.get(key);
    if (!raw) {
      const trades: Trade[] = [];
      raw = { end, curve: ctx.run(sliceAll(ctx.sectorMetrics, start, end), lookbackDays, ctx.regimeMap, trades), trades };
      ctx.cache.set(key, raw);
    }
    return raw;
  }
  const key = `${lookbackDays}|${start}`;
  let raw = ctx.cache.get(key);
  if (!raw || raw.end < end) {
    const to = runTo && runTo > end ? runTo : end;
    const trades: Trade[] = [];
    raw = { end: to, curve: ctx.run(sliceAll(ctx.sectorMetrics, start, to), lookbackDays, ctx.regimeMap, trades), trades };
    ctx.cache.set(key, raw);
  }
  return raw.end === end ? raw : truncateRun(raw, end);
}

// ─── Datos con cobertura comun (sin datos inventados) ──────────────────

export interface TickerCoverage {
  ticker: string;
  /** Primer cierre/volumen real de Yahoo. */
  firstPrice: string | null;
  /** Primer dia en que rige un ancla REAL de tamaño (dia siguiente a su publicacion en SEC EDGAR), sin el punto en vivo. */
  firstSize: string | null;
  /** max(firstPrice, firstSize): desde aca el ticker tiene TODOS sus insumos reales. */
  firstComplete: string | null;
}

export interface PreparedData {
  coverage: TickerCoverage[];
  /** Fecha desde la que TODOS los ETFs + SPY tienen todos sus insumos reales. null si alguno no tiene datos. */
  commonStart: string | null;
  /** Ticker(s) que fijan commonStart (el de cobertura mas tardia). */
  limiting: string[];
  /** Barras recortadas a [commonStart, end] y a las fechas que tienen TODOS los tickers. */
  priceBars: Record<string, PriceBar[]>;
  /** Solo anclas historicas reales con fecha <= end (sin el punto en vivo de hoy). */
  sizeSeries: Record<string, SizeAnchor[]>;
  /** Fechas descartadas porque al menos un ticker no tenia barra ese dia. */
  droppedDates: string[];
  /** Fallas del chequeo final de alineacion (ver checkAlignment). Si hay alguna, no se entrega ningun dato. */
  violations: string[];
}

function nextDayISO(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Prepara los datos de la pestana de robustez con una regla estricta: el
 * modelo arranca recien cuando TODOS los ETFs del universo (y SPY) tienen
 * todos sus insumos reales -- cierre y volumen de Yahoo + ancla real de
 * tamaño (EDGAR). Antes de esa fecha no se usa nada:
 *  - ningun ETF entra "tarde" al universo (todos rotan desde el mismo dia);
 *  - no se rellena hacia atras el tamaño de fondo (sizeAt usaria la
 *    primera ancla para fechas anteriores a ella -- valor que todavia no
 *    existia);
 *  - cada ancla EDGAR rige desde el dia SIGUIENTE a su publicacion
 *    (`filed`), no desde el cierre del periodo que reporta (`date`): el
 *    N-CSR de los XL* sale 61-68 dias despues del cierre, el N-30B-2 de
 *    QQQ 81-95. Usar `date` aplicaria un valor que todavia no era
 *    publico. Un ancla sin `filed` se descarta;
 *  - se descarta el ancla "en vivo" (tamaño de HOY fechado despues de la
 *    ultima ancla EDGAR), que aplicaria un dato futuro al periodo
 *    historico; despues de la ultima ancla real se hace forward-fill del
 *    ultimo valor real conocido (dato ya publicado en esa fecha);
 *  - solo se usan fechas en que TODOS los tickers tienen barra (si a uno
 *    le falta un dia, ese dia se descarta para todos, nunca se interpola);
 *  - las medias moviles (ICD, vol. de precio, regimen de SPY) se calculan
 *    solo con datos desde commonStart, sin historia previa de otros
 *    insumos.
 * Insumos del modelo: close (ajustado) y volume de Yahoo, marketCap y
 * sharesOutstanding de EDGAR. open/high/low no entran en ningun calculo.
 * El free float sigue siendo shares x proxy de la barra lateral (parametro
 * del modelo, no un dato).
 */
export function prepareCommonData(
  priceBars: Record<string, PriceBar[]>,
  sizeSeries: Record<string, SizeAnchor[]>,
  liveSizeAnchorDates: Record<string, string>,
  etfs: readonly string[],
  benchmark: string,
  end: string
): PreparedData {
  const realSize: Record<string, SizeAnchor[]> = {};
  for (const t of etfs) {
    const live = liveSizeAnchorDates[t];
    realSize[t] = (sizeSeries[t] ?? [])
      .filter((a) => a.date !== live && a.filed !== undefined)
      .map((a) => ({ ...a, date: nextDayISO(a.filed as string) }))
      .filter((a) => a.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  const coverage: TickerCoverage[] = [...etfs, benchmark].map((t) => {
    const firstPrice = priceBars[t]?.[0]?.date ?? null;
    const firstSize = t === benchmark ? firstPrice : realSize[t]?.[0]?.date ?? null;
    const firstComplete = firstPrice && firstSize ? (firstPrice > firstSize ? firstPrice : firstSize) : null;
    return { ticker: t, firstPrice, firstSize: t === benchmark ? null : firstSize, firstComplete };
  });

  const empty = { coverage, commonStart: null, limiting: [], priceBars: {}, sizeSeries: realSize, droppedDates: [], violations: [] };
  if (coverage.some((c) => c.firstComplete === null)) {
    return { ...empty, limiting: coverage.filter((c) => c.firstComplete === null).map((c) => c.ticker) };
  }
  const commonStart = coverage.map((c) => c.firstComplete as string).sort()[coverage.length - 1];
  const limiting = coverage.filter((c) => c.firstComplete === commonStart).map((c) => c.ticker);

  const tickers = [...etfs, benchmark];
  const inRange: Record<string, PriceBar[]> = {};
  for (const t of tickers) inRange[t] = priceBars[t].filter((b) => b.date >= commonStart && b.date <= end);
  const dateSets = tickers.map((t) => new Set(inRange[t].map((b) => b.date)));
  const union = new Set<string>();
  for (const ds of dateSets) for (const d of ds) union.add(d);
  const common = new Set([...union].filter((d) => dateSets.every((ds) => ds.has(d))));
  const droppedDates = [...union].filter((d) => !common.has(d)).sort();
  const aligned: Record<string, PriceBar[]> = {};
  for (const t of tickers) aligned[t] = inRange[t].filter((b) => common.has(b.date));

  const violations = checkAlignment(aligned, realSize, commonStart, etfs, benchmark);
  if (violations.length > 0) return { ...empty, violations };
  return { coverage, commonStart, limiting, priceBars: aligned, sizeSeries: realSize, droppedDates, violations };
}

/**
 * Chequeo final, independiente de como se armaron los datos: todos los
 * tickers tienen exactamente la misma secuencia de fechas, ninguna barra
 * es anterior a commonStart, no hay fechas repetidas y cada ETF ya tiene
 * un tamaño real publicado el primer dia (sin relleno hacia atras).
 */
function checkAlignment(
  aligned: Record<string, PriceBar[]>,
  realSize: Record<string, SizeAnchor[]>,
  commonStart: string,
  etfs: readonly string[],
  benchmark: string
): string[] {
  const out: string[] = [];
  const ref = aligned[benchmark].map((b) => b.date);
  if (ref.length === 0) out.push('Sin fechas en comun para todos los tickers');
  if (new Set(ref).size !== ref.length) out.push('Fechas repetidas');
  if (ref.length > 0 && ref[0] < commonStart) out.push(`Barras antes del inicio comun ${commonStart}`);
  for (const t of etfs) {
    const dates = aligned[t].map((b) => b.date);
    if (dates.length !== ref.length || dates.some((d, i) => d !== ref[i])) out.push(`${t}: fechas distintas al resto`);
    const firstAnchor = realSize[t]?.[0]?.date;
    if (ref.length > 0 && (!firstAnchor || firstAnchor > ref[0])) out.push(`${t}: sin tamaño real publicado al ${ref[0]}`);
  }
  return out;
}

/**
 * Primera fecha en que TODOS los ETFs tienen ICD calculado (la media movil
 * necesita `rollingWindow` dias desde commonStart) -- inicio real del
 * rango de pruebas: desde aca la estrategia elige entre el universo
 * completo, no entre un subconjunto.
 */
export function firstUsableDate(sectorMetrics: Record<string, DensityRow[]>): string | null {
  const series = Object.values(sectorMetrics);
  if (series.length === 0) return null;
  const firsts = series.map((rows) => rows.find((r) => r.ICD !== null)?.date);
  if (firsts.some((d) => d === undefined)) return null;
  return (firsts as string[]).sort()[firsts.length - 1];
}

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
  ctx: RobustnessContext,
  lookbackDays: number,
  start: string,
  end: string,
  costs: CostConfig,
  /** Con prefixReuse: simular de una vez hasta esta fecha (otros periodos con el mismo inicio la reutilizan). */
  runTo?: string
): PeriodResult {
  const { spyBars } = ctx;
  const { curve, trades } = getRawRun(ctx, lookbackDays, start, end, runTo);
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
const maxDate = (a: string, b: string) => (a > b ? a : b);

/**
 * Esquemas de particion sobre [firstDate, lastYear] (sin Live). Los
 * limites se recortan a firstDate, asi el primer IS arranca donde
 * realmente hay datos (1999 parcial) en vez de un 1-ene vacio.
 * - rolling: IS de 3 años que avanza 1 año, OOS = el año siguiente.
 * - anchored: IS siempre arranca al inicio de los datos y se expande,
 *   OOS = el año siguiente.
 * - inverse: IS fijo en los ultimos 4 años; OOS = cada bloque de 4 años
 *   ANTERIOR (prueba si lo aprendido en datos recientes hubiera
 *   funcionado en cada era previa: burbuja .com, 2008, etc.).
 */
export function buildSplits(scheme: Exclude<SplitScheme, 'custom'>, firstDate: string, lastYear: number): SplitDef[] {
  const firstYear = Number(firstDate.slice(0, 4));
  const out: SplitDef[] = [];
  if (scheme === 'rolling') {
    for (let oos = firstYear + 3; oos <= lastYear; oos++) {
      out.push({
        label: `IS ${oos - 3}-${oos - 1} / OOS ${oos}`,
        isStart: maxDate(y0(oos - 3), firstDate),
        isEnd: y1(oos - 1),
        oosStart: y0(oos),
        oosEnd: y1(oos),
      });
    }
  } else if (scheme === 'anchored') {
    for (let oos = firstYear + 2; oos <= lastYear; oos++) {
      out.push({ label: `IS ${firstYear}-${oos - 1} / OOS ${oos}`, isStart: firstDate, isEnd: y1(oos - 1), oosStart: y0(oos), oosEnd: y1(oos) });
    }
  } else {
    const isFrom = lastYear - 3;
    for (let to = isFrom - 1; to >= firstYear; to -= 4) {
      const from = Math.max(firstYear, to - 3);
      out.push({
        label: `IS ${isFrom}-${lastYear} / OOS ${from}-${to}`,
        isStart: y0(isFrom),
        isEnd: y1(lastYear),
        oosStart: maxDate(y0(from), firstDate),
        oosEnd: y1(to),
      });
    }
  }
  return out;
}

export interface CustomSplit {
  id: number;
  isStart: string;
  isEnd: string;
  oosStart: string;
  oosEnd: string;
}

export function customSplitIssue(c: CustomSplit, minDate: string, maxDateAllowed: string): string | null {
  const all = [c.isStart, c.isEnd, c.oosStart, c.oosEnd];
  if (all.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) return 'Fecha incompleta';
  if (all.some((d) => d < minDate || d > maxDateAllowed)) return `Fuera de rango (${minDate} a ${maxDateAllowed})`;
  if (c.isEnd <= c.isStart || c.oosEnd <= c.oosStart) return 'Fin antes que inicio';
  return null;
}

export function customSplitOverlaps(c: CustomSplit): boolean {
  return c.isStart <= c.oosEnd && c.oosStart <= c.isEnd;
}

export function customToSplitDef(c: CustomSplit): SplitDef {
  return { label: `IS ${c.isStart} a ${c.isEnd} / OOS ${c.oosStart} a ${c.oosEnd}`, isStart: c.isStart, isEnd: c.isEnd, oosStart: c.oosStart, oosEnd: c.oosEnd };
}

const DAY_MS = 86400000;
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Split aleatorio dentro de [minDate, maxDate]: IS de 2 a 6 años, OOS de
 * 6 meses a 3 años, sin superponerse; el OOS cae despues del IS con
 * probabilidad 70% y antes con 30% (variante inversa). Fechas al dia.
 */
export function randomSplit(id: number, minDate: string, maxDateAllowed: string, rand: () => number = Math.random): CustomSplit {
  const lo = new Date(`${minDate}T00:00:00Z`).getTime();
  const hi = new Date(`${maxDateAllowed}T00:00:00Z`).getTime();
  const span = hi - lo;
  const isLen = Math.min(span * 0.6, (2 + rand() * 4) * 365 * DAY_MS);
  const oosLen = Math.min(span - isLen - 2 * DAY_MS, (0.5 + rand() * 2.5) * 365 * DAY_MS);
  const slack = Math.max(0, span - isLen - oosLen - DAY_MS);
  const offset = lo + rand() * slack;
  if (rand() < 0.3) {
    const oosStart = offset;
    const oosEnd = oosStart + oosLen;
    const isStart = oosEnd + DAY_MS;
    return { id, oosStart: isoOf(oosStart), oosEnd: isoOf(oosEnd), isStart: isoOf(isStart), isEnd: isoOf(isStart + isLen) };
  }
  const isStart = offset;
  const isEnd = isStart + isLen;
  const oosStart = isEnd + DAY_MS;
  return { id, isStart: isoOf(isStart), isEnd: isoOf(isEnd), oosStart: isoOf(oosStart), oosEnd: isoOf(oosStart + oosLen) };
}

export interface SplitResult {
  split: SplitDef;
  /** Lookback usado en este split (el de la barra lateral, o el optimizado en IS). */
  lookbackUsed: number;
  is: PeriodResult;
  oos: PeriodResult;
  degradation: DegradationVerdict;
}

export interface DegradationVerdict {
  /** 'real': Calmar OOS < 80% del Calmar IS. 'none': retiene >= 80%. 'na': IS sin ventaja, infinito o sin datos. */
  kind: 'real' | 'none' | 'na';
  /** Comentario legible: motivos de la degradacion, o por que no aplica. */
  comment: string;
}

/** Retencion minima de Calmar OOS/IS -- mismo umbral que la Robustez Calmar de la pestana principal (min/max >= 0.8). */
export const CALMAR_RETENTION_MIN = 0.8;

/**
 * Degradacion por Calmar (neto de costos): hay degradacion real si el
 * Calmar OOS retiene menos del 80% del Calmar IS. Calmar OOS null (sin
 * drawdown y sin ganancia) cuenta como 0; infinito (gana sin drawdown) no
 * degrada. Si el IS no tiene ventaja (Calmar <= 0) o es infinito, la
 * razon no es comparable.
 */
export function assessDegradation(is: PeriodResult, oos: PeriodResult): DegradationVerdict {
  const cIs = is.net?.calmar;
  if (!is.net || !oos.net) return { kind: 'na', comment: 'Sin datos suficientes' };
  if (cIs === null || cIs === undefined || cIs <= 0) return { kind: 'na', comment: 'Calmar IS <= 0: sin ventaja que degradar' };
  if (!Number.isFinite(cIs)) return { kind: 'na', comment: 'Calmar IS infinito (sin drawdown): no comparable' };

  const cOos = oos.net.calmar ?? 0;
  if (!Number.isFinite(cOos) || cOos / cIs >= CALMAR_RETENTION_MIN) return { kind: 'none', comment: '' };
  const retention = cOos / cIs;
  return {
    kind: 'real',
    comment: `Degradacion real: Calmar ${cIs.toFixed(2)} -> ${cOos.toFixed(2)} (retiene ${(retention * 100).toFixed(0)}%, minimo ${CALMAR_RETENTION_MIN * 100}%)`,
  };
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
  ctx: RobustnessContext,
  lookbackDays: number,
  costs: CostConfig,
  optimizeLookback: boolean
): SplitResult[] {
  // Fin mas lejano por fecha de inicio: los periodos que comparten inicio
  // (IS del walk-forward anclado, p. ej.) se simulan una sola vez hasta ahi.
  const runTo = new Map<string, string>();
  for (const sp of splits) {
    for (const [st, en] of [
      [sp.isStart, sp.isEnd],
      [sp.oosStart, sp.oosEnd],
    ]) {
      if ((runTo.get(st) ?? '') < en) runTo.set(st, en);
    }
  }
  return splits.map((split) => {
    let lookbackUsed = lookbackDays;
    let isResult: PeriodResult | null = null;
    if (optimizeLookback) {
      let bestScore = -Infinity;
      for (const lb of LOOKBACK_GRID) {
        const r = evaluatePeriod(ctx, lb, split.isStart, split.isEnd, costs, runTo.get(split.isStart));
        const c = r.net?.calmar;
        const score = c === null || c === undefined ? -Infinity : Number.isFinite(c) ? c : 1e6;
        if (score > bestScore) {
          bestScore = score;
          lookbackUsed = lb;
          isResult = r;
        }
      }
    }
    const is = isResult ?? evaluatePeriod(ctx, lookbackUsed, split.isStart, split.isEnd, costs, runTo.get(split.isStart));
    const oos = evaluatePeriod(ctx, lookbackUsed, split.oosStart, split.oosEnd, costs, runTo.get(split.oosStart));
    return { split, lookbackUsed, is, oos, degradation: assessDegradation(is, oos) };
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

export const MIN_YEAR_DAYS = 126;

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
 * Corre la estrategia de corrido sobre todo el rango (una sola simulacion, no
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
  // Solo años con al menos medio año de datos (126 dias de trading): un
  // primer año parcial de pocas semanas distorsionaria el ranking de
  // mejores/peores años.
  const yearsList = [...ne.keys()].filter((y) => (ne.get(y)?.length ?? 0) >= MIN_YEAR_DAYS).sort((a, b) => a - b);
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
