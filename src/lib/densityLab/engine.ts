/**
 * Motor cuantitativo puro del laboratorio de Rotacion Sectorial (Next.js).
 *
 * Equivalente TypeScript de capital-density-lab/analytics.py (proyecto
 * Streamlit descartado a favor de una pagina nativa del dashboard). Nada
 * aqui importa yahoo-finance2 ni nada server-only -- son funciones puras
 * sobre datos ya descargados, para poder recalcular todo en el navegador
 * (sliders instantaneos, sin ida y vuelta al servidor).
 */

// Universo del laboratorio: los 11 sectores GICS del S&P 500 mas GLD
// (oro) y QQQ (Nasdaq-100) como diversificadores -- agregados (grid
// search offline, ver scripts/testExpandedUniverseGldQqq.mjs) porque
// rotar SOLO entre sectores del propio S&P casi no puede ganarle a SPY
// cuando el indice entero sube parejo (todo correlacionado); GLD/QQQ le
// dan a la estrategia algo genuinamente distinto para rotar en esos
// tramos. Un solo array alimenta route.ts y DensityLab.tsx (fetch,
// calculo, selector de ticker, heatmap, ranking, etc.) -- ampliarlo aca
// alcanza, no hace falta tocar nada mas.
export const SECTOR_ETFS = [
  'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLRE', 'XLU', 'XLC', 'GLD', 'QQQ',
] as const;

export type SectorTicker = (typeof SECTOR_ETFS)[number];

export const BENCHMARK = 'SPY';

export const SECTOR_NAMES: Record<string, string> = {
  XLK: 'Tecnologia',
  XLF: 'Financiero',
  XLE: 'Energia',
  XLV: 'Salud',
  XLY: 'Consumo Discrecional',
  XLP: 'Consumo Basico',
  XLI: 'Industrial',
  XLB: 'Materiales',
  XLRE: 'Bienes Raices',
  XLU: 'Servicios Publicos',
  XLC: 'Comunicaciones',
  GLD: 'Oro',
  QQQ: 'Nasdaq-100',
};

export const DEFAULT_FREE_FLOAT_RATIO = 0.95;

export const BACKTEST_START = '2018-01-01';
export const BACKTEST_END = '2023-12-31';
export const VALIDATION_START = '2024-01-01';
export const VALIDATION_END = '2025-12-31';
export const LIVE_START = '2026-01-01';

export type WindowKey = 'backtest' | 'validation' | 'live';

export const WINDOWS: Record<WindowKey, { label: string; start: string; end: string | null }> = {
  backtest: { label: 'Backtest (2018-2023)', start: BACKTEST_START, end: BACKTEST_END },
  validation: { label: 'Validacion Out-of-Sample (2024-2025)', start: VALIDATION_START, end: VALIDATION_END },
  live: { label: 'Tiempo Real (2026-Presente)', start: LIVE_START, end: null },
};

export interface PriceBar {
  date: string; // 'YYYY-MM-DD'
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TickerStaticInfo {
  ticker: string;
  marketCap: number;
  sharesOutstanding: number;
  floatSharesDirect?: number;
  source: 'info' | 'proxy';
}

/**
 * Punto real de tamano (market cap / shares outstanding) en una fecha
 * concreta -- viene de un N-CSR/N-CSRS de SEC EDGAR (ver
 * scripts/fetchEdgarHistoricalSize.mjs) o del fetch en vivo de Yahoo
 * Finance para el punto "hoy". `floatShares` solo esta poblado en el
 * punto en vivo (Yahoo a veces lo expone, EDGAR Financial Highlights no).
 */
export interface SizeAnchor {
  date: string; // 'YYYY-MM-DD'
  marketCap: number;
  sharesOutstanding: number;
  floatShares?: number;
}

/**
 * Ancla de tamano vigente en `date`: la mas reciente con date <= la
 * pedida (forward-fill). Si `date` es anterior a la primera ancla
 * conocida, usa la primera igual -- no hay dato mas viejo para extrapolar.
 */
export function sizeAt(anchors: SizeAnchor[], date: string): SizeAnchor | null {
  if (anchors.length === 0) return null;
  let result = anchors[0];
  for (const a of anchors) {
    if (a.date <= date) result = a;
    else break;
  }
  return result;
}

export interface DensityRow extends PriceBar {
  VMC: number;
  STR: number;
  FFT: number;
  zVMC: number | null;
  zSTR: number | null;
  zFFT: number | null;
  ICD: number | null;
  ICDzscore: number | null;
}

// ─── Utilidades numericas ───────────────────────────────────────────────

function rollingMeanStd(
  values: (number | null)[],
  window: number
): { mean: (number | null)[]; std: (number | null)[] } {
  const n = values.length;
  const mean: (number | null)[] = new Array(n).fill(null);
  const std: (number | null)[] = new Array(n).fill(null);

  for (let i = window - 1; i < n; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - window + 1; j <= i; j++) {
      const v = values[j];
      if (v === null || Number.isNaN(v)) { ok = false; break; }
      sum += v;
    }
    if (!ok) continue;
    const m = sum / window;
    let variance = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const v = values[j] as number;
      variance += (v - m) * (v - m);
    }
    variance = window > 1 ? variance / (window - 1) : 0;
    mean[i] = m;
    std[i] = Math.sqrt(variance);
  }
  return { mean, std };
}

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : num / denom;
}

// ─── Metricas de densidad de capital ────────────────────────────────────

/**
 * Calcula VMC, STR, FFT y el Indicador Compuesto de Densidad (ICD).
 *
 * Nota metodologica: market_cap/shares_outstanding/free_float varian por
 * fecha usando `sizeSeries` (forward-fill sobre anclas reales de SEC EDGAR
 * N-CSR/N-CSRS -- ver scripts/fetchEdgarHistoricalSize.mjs -- mas el punto
 * "hoy" de Yahoo Finance en vivo). Antes se aplicaba el valor ACTUAL de
 * Yahoo constante a toda la serie 2018-presente -- sesgo de look-ahead en
 * Backtest/Validacion (denominador de 2026 aplicado a datos de 2018-2023).
 * Limitacion residual: la ultima ancla real de EDGAR es sep-2025 (el
 * formato HTML de los N-CSRS de 2026 partio los valores en spans no
 * parseables de forma confiable). El punto en vivo se fecha el dia
 * siguiente a esa ultima ancla (no "hoy" -- ver addDaysISO en
 * app/api/density-lab/route.ts), asi que cubre TODA la ventana Live
 * (ene-2026 en adelante) con el tamano actual, no solo el ultimo dia. Es
 * el trade-off correcto: para esos ~9 meses sin ancla real, el tamano
 * actual (creciendo/decreciendo hacia el valor real de esa fecha) es
 * mejor estimador que quedarse pegado en sep-2025. Sigue sin aplicar
 * nunca un valor de 2026 hacia atras en Backtest/Validacion.
 */
export function computeDensityMetrics(
  bars: PriceBar[],
  sizeSeries: SizeAnchor[],
  freeFloatRatio: number,
  rollingWindow: number
): DensityRow[] {
  const sizeFor = (date: string) => sizeAt(sizeSeries, date);

  const vmc = bars.map((b) => {
    const sz = sizeFor(b.date);
    return sz ? (b.volume * b.close) / sz.marketCap : NaN;
  });
  const str_ = bars.map((b) => {
    const sz = sizeFor(b.date);
    return sz ? b.volume / sz.sharesOutstanding : NaN;
  });
  const fft = bars.map((b) => {
    const sz = sizeFor(b.date);
    if (!sz) return NaN;
    const freeFloat = sz.floatShares ?? sz.sharesOutstanding * freeFloatRatio;
    return b.volume / freeFloat;
  });

  const { mean: mVMC, std: sVMC } = rollingMeanStd(vmc, rollingWindow);
  const { mean: mSTR, std: sSTR } = rollingMeanStd(str_, rollingWindow);
  const { mean: mFFT, std: sFFT } = rollingMeanStd(fft, rollingWindow);

  const zscore = (v: number, m: number | null, s: number | null): number | null =>
    m === null || s === null || s === 0 ? null : (v - m) / s;

  const zVMC = vmc.map((v, i) => zscore(v, mVMC[i], sVMC[i]));
  const zSTR = str_.map((v, i) => zscore(v, mSTR[i], sSTR[i]));
  const zFFT = fft.map((v, i) => zscore(v, mFFT[i], sFFT[i]));

  const icd: (number | null)[] = bars.map((_, i) => {
    const a = zVMC[i];
    const b = zSTR[i];
    const c = zFFT[i];
    if (a === null || b === null || c === null) return null;
    return (a + b + c) / 3;
  });

  const { mean: mICD, std: sICD } = rollingMeanStd(icd, rollingWindow);
  const icdZ = icd.map((v, i) => (v === null ? null : zscore(v, mICD[i], sICD[i])));

  return bars.map((bar, i) => ({
    ...bar,
    VMC: vmc[i],
    STR: str_[i],
    FFT: fft[i],
    zVMC: zVMC[i],
    zSTR: zSTR[i],
    zFFT: zFFT[i],
    ICD: icd[i],
    ICDzscore: icdZ[i],
  }));
}

export function computeAllSectorsDensity(
  priceBars: Record<string, PriceBar[]>,
  sizeSeries: Record<string, SizeAnchor[]>,
  freeFloatRatio: number,
  rollingWindow: number
): Record<string, DensityRow[]> {
  const out: Record<string, DensityRow[]> = {};
  for (const [ticker, bars] of Object.entries(priceBars)) {
    const series = sizeSeries[ticker];
    if (!series || series.length === 0) continue;
    out[ticker] = computeDensityMetrics(bars, series, freeFloatRatio, rollingWindow);
  }
  return out;
}

export function sliceWindow(rows: DensityRow[], start: string, end: string | null): DensityRow[] {
  return rows.filter((r) => r.date >= start && (end === null || r.date <= end));
}

// ─── Mapa de rotacion (heatmap) ─────────────────────────────────────────

export interface RotationMatrix {
  sectors: string[]; // nombres legibles, mismo orden que `values`
  tickers: string[];
  dates: string[];
  values: (number | null)[][]; // [sectorIndex][dateIndex]
}

export function buildRotationMatrix(
  sectorMetrics: Record<string, DensityRow[]>,
  windowDays: number
): RotationMatrix {
  const tickers = Object.keys(sectorMetrics).filter((t) => sectorMetrics[t].some((r) => r.ICD !== null));
  if (tickers.length === 0) return { sectors: [], tickers: [], dates: [], values: [] };

  // Fechas de referencia: union de las ultimas windowDays fechas con ICD valido de cada sector.
  const dateSet = new Set<string>();
  for (const t of tickers) {
    const withIcd = sectorMetrics[t].filter((r) => r.ICD !== null);
    for (const r of withIcd.slice(-windowDays)) dateSet.add(r.date);
  }
  const dates = Array.from(dateSet).sort().slice(-windowDays);

  const values = tickers.map((t) => {
    const byDate = new Map(sectorMetrics[t].map((r) => [r.date, r.ICD]));
    return dates.map((d) => byDate.get(d) ?? null);
  });

  return { sectors: tickers.map((t) => SECTOR_NAMES[t] ?? t), tickers, dates, values };
}

export interface RankingRow {
  ticker: string;
  sector: string;
  date: string;
  close: number;
  volume: number;
  zVMC: number | null;
  zSTR: number | null;
  zFFT: number | null;
  ICD: number | null;
}

export function latestRanking(sectorMetrics: Record<string, DensityRow[]>): RankingRow[] {
  const rows: RankingRow[] = [];
  for (const [ticker, series] of Object.entries(sectorMetrics)) {
    const withIcd = series.filter((r) => r.ICD !== null);
    if (withIcd.length === 0) continue;
    const last = withIcd[withIcd.length - 1];
    rows.push({
      ticker,
      sector: SECTOR_NAMES[ticker] ?? ticker,
      date: last.date,
      close: last.close,
      volume: last.volume,
      zVMC: last.zVMC,
      zSTR: last.zSTR,
      zFFT: last.zFFT,
      ICD: last.ICD,
    });
  }
  return rows.sort((a, b) => (b.ICD ?? -Infinity) - (a.ICD ?? -Infinity));
}

export interface SectorReturnRow {
  ticker: string;
  sector: string;
  startDate: string;
  endDate: string;
  startClose: number;
  endClose: number;
  returnPct: number; // ej. 12.4 = +12.4%
}

/**
 * Retorno Buy & Hold por sector dentro de la ventana activa: cuanto se
 * hubiera ganado/perdido (%) si se hubiera puesto capital en el sector al
 * inicio del periodo y se hubiera mantenido hasta el final (o hasta hoy,
 * en la ventana de Tiempo Real). Independiente del ICD -- es el retorno
 * de precio puro, para poder comparar "densidad de capital alta" contra
 * "resultado real de haber invertido ahi".
 */
export function sectorBuyAndHoldReturns(sectorMetrics: Record<string, DensityRow[]>): SectorReturnRow[] {
  const rows: SectorReturnRow[] = [];
  for (const [ticker, series] of Object.entries(sectorMetrics)) {
    if (series.length < 2) continue;
    const first = series[0];
    const last = series[series.length - 1];
    if (first.close === 0) continue;
    rows.push({
      ticker,
      sector: SECTOR_NAMES[ticker] ?? ticker,
      startDate: first.date,
      endDate: last.date,
      startClose: first.close,
      endClose: last.close,
      returnPct: (last.close / first.close - 1) * 100,
    });
  }
  return rows.sort((a, b) => b.returnPct - a.returnPct);
}

// ─── Backtesting: correlacion rezagada ──────────────────────────────────

export const LAGS = [1, 3, 5, 10] as const;

export interface CorrelationMatrix {
  sectors: string[];
  tickers: string[];
  lags: number[];
  values: (number | null)[][]; // [sectorIndex][lagIndex]
}

export function lagCorrelationMatrix(
  sectorMetrics: Record<string, DensityRow[]>,
  lags: readonly number[] = LAGS
): CorrelationMatrix {
  const tickers = Object.keys(sectorMetrics);
  const values = tickers.map((t) => {
    const series = sectorMetrics[t];
    return lags.map((lag) => {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < series.length - lag; i++) {
        const icdZ = series[i].ICDzscore;
        const closeNow = series[i].close;
        const closeFuture = series[i + lag].close;
        if (icdZ === null || closeNow === 0) continue;
        xs.push(icdZ);
        ys.push(closeFuture / closeNow - 1);
      }
      if (xs.length < 30) return null;
      return pearsonCorrelation(xs, ys);
    });
  });
  return { sectors: tickers.map((t) => SECTOR_NAMES[t] ?? t), tickers, lags: [...lags], values };
}

export interface EventStudyRow {
  ticker: string;
  sector: string;
  nEvents: number;
  byLag: Record<number, { postEventMean: number | null; baseMean: number | null }>;
}

export function eventStudy(
  sectorMetrics: Record<string, DensityRow[]>,
  zThreshold: number,
  lags: readonly number[] = LAGS
): EventStudyRow[] {
  const rows: EventStudyRow[] = [];
  for (const [ticker, series] of Object.entries(sectorMetrics)) {
    const eventIdx = new Set<number>();
    series.forEach((r, i) => {
      if (r.ICDzscore !== null && r.ICDzscore > zThreshold) eventIdx.add(i);
    });

    const byLag: EventStudyRow['byLag'] = {};
    for (const lag of lags) {
      const condReturns: number[] = [];
      const allReturns: number[] = [];
      for (let i = 0; i < series.length - lag; i++) {
        const closeNow = series[i].close;
        if (closeNow === 0) continue;
        const ret = series[i + lag].close / closeNow - 1;
        allReturns.push(ret);
        if (eventIdx.has(i)) condReturns.push(ret);
      }
      byLag[lag] = {
        postEventMean: condReturns.length ? condReturns.reduce((a, b) => a + b, 0) / condReturns.length : null,
        baseMean: allReturns.length ? allReturns.reduce((a, b) => a + b, 0) / allReturns.length : null,
      };
    }

    rows.push({ ticker, sector: SECTOR_NAMES[ticker] ?? ticker, nEvents: eventIdx.size, byLag });
  }
  return rows;
}

// ─── Estrategia simulada: rotacion por delta de ICD ─────────────────────

export interface EquityPoint {
  date: string;
  value: number;
}

/**
 * Una posicion cerrada (entrada + salida) -- para exportar el detalle de
 * trades de cualquier metodologia. `outTrades` en cada simulate*Strategy
 * es un parametro de salida opcional: si se pasa un array, se le
 * empujan los trades como efecto secundario (no cambia el valor de
 * retorno, no rompe a los llamadores existentes que no lo usan).
 */
export interface Trade {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  returnPct: number;
  /** Solo poblado por M4 (simulateIcdRegimeSwitchStrategy): que sub-regla de entrada se aplico en este trade segun el regimen de SPY vigente. Indefinido en M1/M2/M3. */
  appliedMethod?: string;
}

/**
 * Genera puntos de equity marcados a mercado DIA A DIA durante una
 * tenencia, en vez de saltar directo de la fecha de entrada a la de
 * salida. Sin esto, Max Drawdown/Calmar (que escanean la curva completa
 * en computeStrategyStats) no ven ninguna caida que haya ocurrido
 * mientras la posicion estaba abierta y se recupero antes de salir --
 * verificado offline (scripts/testDailyMarkDrawdown.mjs) que esto
 * subestimaba el drawdown real hasta 5.5 puntos porcentuales en M2/M3/M4.
 */
function markToMarketDaily(
  dates: string[],
  closeMap: Map<string, number>,
  entryDate: string,
  exitDate: string,
  entryPrice: number,
  equityBeforeTrade: number
): EquityPoint[] {
  const points: EquityPoint[] = [];
  for (const d of dates) {
    if (d < entryDate) continue;
    if (d > exitDate) break;
    const close = closeMap.get(d);
    if (close === undefined) continue;
    points.push({ date: d, value: equityBeforeTrade * (close / entryPrice) });
  }
  return points;
}

export function simulateIcdRotationStrategy(
  sectorMetrics: Record<string, DensityRow[]>,
  lookbackDays: number,
  holdDays: number,
  outTrades?: Trade[]
): EquityPoint[] {
  const tickers = Object.keys(sectorMetrics).filter((t) => sectorMetrics[t].some((r) => r.ICD !== null));
  if (tickers.length === 0) return [];

  // Union ordenada de todas las fechas disponibles.
  const dateSet = new Set<string>();
  for (const t of tickers) for (const r of sectorMetrics[t]) dateSet.add(r.date);
  const dates = Array.from(dateSet).sort();

  const icdByTicker: Record<string, Map<string, number | null>> = {};
  const closeByTicker: Record<string, Map<string, number>> = {};
  for (const t of tickers) {
    icdByTicker[t] = new Map(sectorMetrics[t].map((r) => [r.date, r.ICD]));
    closeByTicker[t] = new Map(sectorMetrics[t].map((r) => [r.date, r.close]));
  }

  const equity: EquityPoint[] = [];
  let equityValue = 1.0;
  let i = lookbackDays;

  while (i < dates.length) {
    const rebalanceDate = dates[i];
    const lookbackDate = dates[i - lookbackDays];

    let bestTicker: string | null = null;
    let bestDelta = -Infinity;
    for (const t of tickers) {
      const now = icdByTicker[t].get(rebalanceDate);
      const before = icdByTicker[t].get(lookbackDate);
      if (now === null || now === undefined || before === null || before === undefined) continue;
      const delta = now - before;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestTicker = t;
      }
    }

    if (bestTicker === null) {
      i += 1;
      continue;
    }

    const closeMap = closeByTicker[bestTicker];
    const entryPrice = closeMap.get(rebalanceDate);
    const futureDates = dates.slice(i + 1).filter((d) => closeMap.has(d));
    if (entryPrice === undefined || futureDates.length < holdDays) break;

    const exitDate = futureDates[holdDays - 1];
    const exitPrice = closeMap.get(exitDate)!;
    const tradeReturn = exitPrice / entryPrice - 1;

    equity.push(...markToMarketDaily(dates, closeMap, rebalanceDate, exitDate, entryPrice, equityValue));
    equityValue *= 1 + tradeReturn;
    outTrades?.push({
      ticker: bestTicker,
      entryDate: rebalanceDate,
      entryPrice,
      exitDate,
      exitPrice,
      returnPct: tradeReturn * 100,
    });

    // Avanzar estrictamente DESPUES de la fecha de salida (no re-entrar el
    // mismo dia que se cierra la posicion) -- mismo criterio que la
    // version Python (np.searchsorted(..., side='right')).
    const exitIdx = dates.indexOf(exitDate);
    i = exitIdx >= i ? exitIdx + 1 : i + 1;
  }

  return equity.length >= 2 ? equity : [];
}

/**
 * Metodologia 2 de la estrategia ICD: en vez de tenencia a plazo fijo
 * (`simulateIcdRotationStrategy`, holdDays constante), sale de la
 * posicion apenas el ICD del sector en cartera cae por debajo de 0 --
 * "corta la posicion cuando el momento de densidad se apaga" -- y rota
 * el mismo dia a lo que tenga mejor delta de ICD en ese momento. Sin
 * plazo fijo: puede aguantar una posicion ganadora mucho mas que
 * holdDays si el ICD se mantiene positivo, o cortarla mucho antes si se
 * apaga rapido. Entrada usa la misma regla que la Metodologia 1 (mayor
 * delta de ICD en `lookbackDays`) para que la unica diferencia real entre
 * ambas sea la regla de salida.
 *
 * Funcion nueva e independiente -- no toca simulateIcdRotationStrategy.
 */
export function simulateIcdExitStrategy(
  sectorMetrics: Record<string, DensityRow[]>,
  lookbackDays: number,
  outTrades?: Trade[]
): EquityPoint[] {
  const tickers = Object.keys(sectorMetrics).filter((t) => sectorMetrics[t].some((r) => r.ICD !== null));
  if (tickers.length === 0) return [];

  const dateSet = new Set<string>();
  for (const t of tickers) for (const r of sectorMetrics[t]) dateSet.add(r.date);
  const dates = Array.from(dateSet).sort();

  const icdByTicker: Record<string, Map<string, number | null>> = {};
  const closeByTicker: Record<string, Map<string, number>> = {};
  for (const t of tickers) {
    icdByTicker[t] = new Map(sectorMetrics[t].map((r) => [r.date, r.ICD]));
    closeByTicker[t] = new Map(sectorMetrics[t].map((r) => [r.date, r.close]));
  }

  function pickBestTicker(date: string, lookbackDate: string): string | null {
    let bestTicker: string | null = null;
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

  const equity: EquityPoint[] = [];
  let equityValue = 1.0;
  let position: { ticker: string; entryPrice: number; entryDate: string } | null = null;

  for (let i = lookbackDays; i < dates.length; i++) {
    const date = dates[i];

    if (position) {
      const icdNow = icdByTicker[position.ticker].get(date);
      const closeNow = closeByTicker[position.ticker].get(date);
      if (icdNow !== null && icdNow !== undefined && icdNow < 0 && closeNow !== undefined) {
        equity.push(...markToMarketDaily(dates, closeByTicker[position.ticker], position.entryDate, date, position.entryPrice, equityValue));
        outTrades?.push({
          ticker: position.ticker,
          entryDate: position.entryDate,
          entryPrice: position.entryPrice,
          exitDate: date,
          exitPrice: closeNow,
          returnPct: (closeNow / position.entryPrice - 1) * 100,
        });
        equityValue *= 1 + (closeNow / position.entryPrice - 1);
        position = null;
      }
    }

    if (!position) {
      const lookbackDate = dates[i - lookbackDays];
      const bestTicker = pickBestTicker(date, lookbackDate);
      if (bestTicker !== null) {
        const entryPrice = closeByTicker[bestTicker].get(date);
        if (entryPrice !== undefined) {
          position = { ticker: bestTicker, entryPrice, entryDate: date };
        }
      }
    }
  }

  // Mark-to-market de la posicion que quede abierta al final del periodo
  // -- si no, la curva ignora la ganancia/perdida no realizada del ultimo
  // tramo.
  if (position) {
    const lastDate = dates[dates.length - 1];
    const lastClose = closeByTicker[position.ticker].get(lastDate);
    if (lastClose !== undefined) {
      equity.push(...markToMarketDaily(dates, closeByTicker[position.ticker], position.entryDate, lastDate, position.entryPrice, equityValue));
      outTrades?.push({
        ticker: position.ticker,
        entryDate: position.entryDate,
        entryPrice: position.entryPrice,
        exitDate: lastDate,
        exitPrice: lastClose,
        returnPct: (lastClose / position.entryPrice - 1) * 100,
      });
    }
  }

  return equity.length >= 2 ? equity : [];
}

/**
 * Metodologia 3 de la estrategia ICD: mismo ranking que M2 (entra al
 * ticker de mayor delta de ICD, misma salida por ICD<0), pero exige
 * ADEMAS que el retorno de PRECIO de ese ticker sobre `lookbackDays`
 * supere `k` veces su propia volatilidad diaria historica (ventana de
 * `volWindow` dias) escalada a ese periodo -- confirma que el movimiento
 * de precio es genuinamente grande PARA ESE activo especifico, no solo
 * que el ICD lo marco.
 *
 * Por que precio y no ICD propio: se probo primero normalizar por la
 * distribucion historica del delta de ICD de cada ticker (ver
 * scripts/testPerTickerThresholdM3.mjs) -- no sirvio, porque el ICD ya
 * es un z-score por construccion (promedio de zVMC/zSTR/zFFT), asi que
 * su delta sale con media~0 y desvio~1.44 CASI IDENTICO para los 13
 * tickers -- "el umbral propio" terminaba siendo el mismo umbral fijo
 * para todos, sin diferenciar nada. La volatilidad de PRECIO si varia
 * genuinamente entre activos (Energia se mueve mas que Servicios
 * Publicos en terminos de precio), por eso filtra de verdad.
 *
 * Validado con grid search offline (scripts/testPriceVolFilterM3.mjs):
 * k=0.25 es el optimo por robustez -- el minimo de Sharpe entre
 * Backtest/Validacion/Live sube de 0.08 (M2 sin filtro) a 1.02.
 */
export function simulateIcdPriceVolFilterStrategy(
  sectorMetrics: Record<string, DensityRow[]>,
  lookbackDays: number,
  k: number,
  volWindow = 60,
  outTrades?: Trade[]
): EquityPoint[] {
  const tickers = Object.keys(sectorMetrics).filter((t) => sectorMetrics[t].some((r) => r.ICD !== null));
  if (tickers.length === 0) return [];

  const icdByTicker: Record<string, Map<string, number | null>> = {};
  const closeByTicker: Record<string, Map<string, number>> = {};
  const dailyVolByTicker: Record<string, Map<string, number>> = {};
  const priceReturnByTicker: Record<string, Map<string, number>> = {};

  for (const t of tickers) {
    const rows = sectorMetrics[t];
    icdByTicker[t] = new Map(rows.map((r) => [r.date, r.ICD]));
    closeByTicker[t] = new Map(rows.map((r) => [r.date, r.close]));

    const dailyVol = new Map<string, number>();
    const dailyRets: number[] = [];
    for (let i = 1; i < rows.length; i++) dailyRets.push(rows[i].close / rows[i - 1].close - 1);
    for (let i = volWindow - 1; i < dailyRets.length; i++) {
      const window = dailyRets.slice(i - volWindow + 1, i + 1);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1);
      dailyVol.set(rows[i + 1].date, Math.sqrt(variance));
    }
    dailyVolByTicker[t] = dailyVol;

    const priceReturn = new Map<string, number>();
    for (let i = lookbackDays; i < rows.length; i++) {
      const now = rows[i].close;
      const before = rows[i - lookbackDays].close;
      if (before === 0) continue;
      priceReturn.set(rows[i].date, now / before - 1);
    }
    priceReturnByTicker[t] = priceReturn;
  }

  const dateSet = new Set<string>();
  for (const t of tickers) for (const r of sectorMetrics[t]) dateSet.add(r.date);
  const dates = Array.from(dateSet).sort();

  function pickBestTicker(date: string, lookbackDate: string): string | null {
    let bestTicker: string | null = null;
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

  const equity: EquityPoint[] = [];
  let equityValue = 1.0;
  let position: { ticker: string; entryPrice: number; entryDate: string } | null = null;

  for (let i = lookbackDays; i < dates.length; i++) {
    const date = dates[i];

    if (position) {
      const icdNow = icdByTicker[position.ticker].get(date);
      const closeNow = closeByTicker[position.ticker].get(date);
      if (icdNow !== null && icdNow !== undefined && icdNow < 0 && closeNow !== undefined) {
        equity.push(...markToMarketDaily(dates, closeByTicker[position.ticker], position.entryDate, date, position.entryPrice, equityValue));
        outTrades?.push({
          ticker: position.ticker,
          entryDate: position.entryDate,
          entryPrice: position.entryPrice,
          exitDate: date,
          exitPrice: closeNow,
          returnPct: (closeNow / position.entryPrice - 1) * 100,
        });
        equityValue *= 1 + (closeNow / position.entryPrice - 1);
        position = null;
      }
    }

    if (!position) {
      const lookbackDate = dates[i - lookbackDays];
      const bestTicker = pickBestTicker(date, lookbackDate);
      if (bestTicker !== null) {
        const priceReturn = priceReturnByTicker[bestTicker].get(date);
        const dailyVol = dailyVolByTicker[bestTicker].get(date);
        const sigmaLookback = dailyVol !== undefined ? dailyVol * Math.sqrt(lookbackDays) : undefined;
        const qualifies = priceReturn !== undefined && sigmaLookback !== undefined && priceReturn >= k * sigmaLookback;
        if (qualifies) {
          const entryPrice = closeByTicker[bestTicker].get(date);
          if (entryPrice !== undefined) {
            position = { ticker: bestTicker, entryPrice, entryDate: date };
          }
        }
      }
    }
  }

  if (position) {
    const lastDate = dates[dates.length - 1];
    const lastClose = closeByTicker[position.ticker].get(lastDate);
    if (lastClose !== undefined) {
      equity.push(...markToMarketDaily(dates, closeByTicker[position.ticker], position.entryDate, lastDate, position.entryPrice, equityValue));
      outTrades?.push({
        ticker: position.ticker,
        entryDate: position.entryDate,
        entryPrice: position.entryPrice,
        exitDate: lastDate,
        exitPrice: lastClose,
        returnPct: (lastClose / position.entryPrice - 1) * 100,
      });
    }
  }

  return equity.length >= 2 ? equity : [];
}

export type MarketRegime = 'high' | 'low';

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * Clasifica el regimen de volatilidad de SPY en cada fecha: 'high' si la
 * volatilidad diaria realizada de SPY sobre `volWindow` dias supera su
 * propia mediana movil de `regimeWindow` dias, 'low' si no -- relativo a
 * la historia RECIENTE del propio SPY, no un umbral absoluto (que no
 * generalizaria entre 2018 y 2026, niveles de volatilidad distintos por
 * era). Solo usa datos pasados hasta cada fecha (sin look-ahead). Fechas
 * sin suficiente historia (los primeros ~`regimeWindow` dias de la
 * serie) no aparecen en el mapa.
 */
export function buildMarketRegimeMap(spyBars: PriceBar[], volWindow = 20, regimeWindow = 252): Map<string, MarketRegime> {
  const dailyRets: number[] = [];
  for (let i = 1; i < spyBars.length; i++) dailyRets.push(spyBars[i].close / spyBars[i - 1].close - 1);

  const shortVol = new Map<string, number>();
  for (let i = volWindow - 1; i < dailyRets.length; i++) {
    const window = dailyRets.slice(i - volWindow + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1);
    shortVol.set(spyBars[i + 1].date, Math.sqrt(variance));
  }

  const shortVolDates = [...shortVol.keys()].sort();
  const shortVolVals = shortVolDates.map((d) => shortVol.get(d) as number);

  const regime = new Map<string, MarketRegime>();
  for (let i = regimeWindow - 1; i < shortVolDates.length; i++) {
    const window = shortVolVals.slice(i - regimeWindow + 1, i + 1);
    const med = median(window);
    regime.set(shortVolDates[i], shortVolVals[i] > med ? 'high' : 'low');
  }
  return regime;
}

/**
 * Metodologia 4: portafolio de estrategias -- cambia la regla de ENTRADA
 * segun el regimen de volatilidad de SPY (`regimeMap`, ver
 * buildMarketRegimeMap), en vez de usar siempre la misma. M2 y M3
 * comparten el mismo ranking (mayor delta de ICD) y la misma salida
 * (ICD<0), solo difieren en si exigen o no el filtro de volatilidad de
 * precio de M3 -- asi que M4 no necesita alternar entre dos motores
 * distintos, alcanza con prender/apagar ese filtro segun el regimen:
 *
 * - Regimen 'high' (crisis, tipo COVID/2022): entra como M2, sin filtro
 *   -- reaccionar rapido sin esperar confirmacion protegio capital ahi.
 * - Regimen 'low' (mercado calmo/rango, tipo Validacion/Live
 *   2024-2026): entra como M3, con el filtro de vol. de precio -- evita
 *   el whipsaw de señales ICD sin confirmacion de precio real.
 * - Regimen desconocido (primeros ~252 dias de la serie, sin historia
 *   suficiente para clasificar): entra como M2, sin filtro.
 *
 * Validado con grid search offline (scripts/testRegimeSwitchM4.mjs): le
 * gana en Sharpe Y ganancia bruta a M2 solo Y a M3 solo en Backtest y
 * Validacion (no solo promedia entre los dos), y en Live queda mejor en
 * ganancia que M3 solo (12.4% vs 11.5%) aunque con Sharpe algo menor.
 * Primera variante de toda la sesion que le gana a SPY real en las tres
 * ventanas a la vez.
 */
export function simulateIcdRegimeSwitchStrategy(
  sectorMetrics: Record<string, DensityRow[]>,
  lookbackDays: number,
  k: number,
  regimeMap: Map<string, MarketRegime>,
  priceVolWindow = 60,
  outTrades?: Trade[]
): EquityPoint[] {
  const tickers = Object.keys(sectorMetrics).filter((t) => sectorMetrics[t].some((r) => r.ICD !== null));
  if (tickers.length === 0) return [];

  const icdByTicker: Record<string, Map<string, number | null>> = {};
  const closeByTicker: Record<string, Map<string, number>> = {};
  const dailyVolByTicker: Record<string, Map<string, number>> = {};
  const priceReturnByTicker: Record<string, Map<string, number>> = {};

  for (const t of tickers) {
    const rows = sectorMetrics[t];
    icdByTicker[t] = new Map(rows.map((r) => [r.date, r.ICD]));
    closeByTicker[t] = new Map(rows.map((r) => [r.date, r.close]));

    const dailyVol = new Map<string, number>();
    const dailyRets: number[] = [];
    for (let i = 1; i < rows.length; i++) dailyRets.push(rows[i].close / rows[i - 1].close - 1);
    for (let i = priceVolWindow - 1; i < dailyRets.length; i++) {
      const window = dailyRets.slice(i - priceVolWindow + 1, i + 1);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1);
      dailyVol.set(rows[i + 1].date, Math.sqrt(variance));
    }
    dailyVolByTicker[t] = dailyVol;

    const priceReturn = new Map<string, number>();
    for (let i = lookbackDays; i < rows.length; i++) {
      const now = rows[i].close;
      const before = rows[i - lookbackDays].close;
      if (before === 0) continue;
      priceReturn.set(rows[i].date, now / before - 1);
    }
    priceReturnByTicker[t] = priceReturn;
  }

  const dateSet = new Set<string>();
  for (const t of tickers) for (const r of sectorMetrics[t]) dateSet.add(r.date);
  const dates = Array.from(dateSet).sort();

  function pickBestTicker(date: string, lookbackDate: string): string | null {
    let bestTicker: string | null = null;
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

  const equity: EquityPoint[] = [];
  let equityValue = 1.0;
  let position: { ticker: string; entryPrice: number; entryDate: string; appliedMethod: string } | null = null;

  for (let i = lookbackDays; i < dates.length; i++) {
    const date = dates[i];

    if (position) {
      const icdNow = icdByTicker[position.ticker].get(date);
      const closeNow = closeByTicker[position.ticker].get(date);
      if (icdNow !== null && icdNow !== undefined && icdNow < 0 && closeNow !== undefined) {
        equity.push(...markToMarketDaily(dates, closeByTicker[position.ticker], position.entryDate, date, position.entryPrice, equityValue));
        outTrades?.push({
          ticker: position.ticker,
          entryDate: position.entryDate,
          entryPrice: position.entryPrice,
          exitDate: date,
          exitPrice: closeNow,
          returnPct: (closeNow / position.entryPrice - 1) * 100,
          appliedMethod: position.appliedMethod,
        });
        equityValue *= 1 + (closeNow / position.entryPrice - 1);
        position = null;
      }
    }

    if (!position) {
      const lookbackDate = dates[i - lookbackDays];
      const bestTicker = pickBestTicker(date, lookbackDate);
      if (bestTicker !== null) {
        const regime = regimeMap.get(date);

        let qualifies: boolean;
        if (regime === 'low') {
          const priceReturn = priceReturnByTicker[bestTicker].get(date);
          const dailyVol = dailyVolByTicker[bestTicker].get(date);
          const sigmaLookback = dailyVol !== undefined ? dailyVol * Math.sqrt(lookbackDays) : undefined;
          qualifies = priceReturn !== undefined && sigmaLookback !== undefined && priceReturn >= k * sigmaLookback;
        } else {
          // 'high' o sin clasificar (poca historia): entra como M2, sin filtro.
          qualifies = true;
        }

        if (qualifies) {
          const entryPrice = closeByTicker[bestTicker].get(date);
          if (entryPrice !== undefined) {
            const appliedMethod = regime === 'low' ? 'M3 (baja volatilidad, filtro precio)' : 'M2 (alta volatilidad, sin filtro)';
            position = { ticker: bestTicker, entryPrice, entryDate: date, appliedMethod };
          }
        }
      }
    }
  }

  if (position) {
    const lastDate = dates[dates.length - 1];
    const lastClose = closeByTicker[position.ticker].get(lastDate);
    if (lastClose !== undefined) {
      equity.push(...markToMarketDaily(dates, closeByTicker[position.ticker], position.entryDate, lastDate, position.entryPrice, equityValue));
      outTrades?.push({
        ticker: position.ticker,
        entryDate: position.entryDate,
        entryPrice: position.entryPrice,
        exitDate: lastDate,
        exitPrice: lastClose,
        returnPct: (lastClose / position.entryPrice - 1) * 100,
        appliedMethod: position.appliedMethod,
      });
    }
  }

  return equity.length >= 2 ? equity : [];
}

export function buyAndHoldCurve(bars: PriceBar[], alignedDates: string[]): EquityPoint[] {
  if (alignedDates.length === 0 || bars.length === 0) return [];
  const closeMap = new Map(bars.map((b) => [b.date, b.close]));
  const sortedBarDates = bars.map((b) => b.date).sort();

  // Para cada fecha alineada, usar el ultimo cierre conocido <= esa fecha (forward-fill).
  function lastKnownClose(targetDate: string): number | undefined {
    let result: number | undefined;
    for (const d of sortedBarDates) {
      if (d > targetDate) break;
      result = closeMap.get(d);
    }
    return result;
  }

  const base = lastKnownClose(alignedDates[0]);
  if (base === undefined || base === 0) return [];

  return alignedDates.map((d) => {
    const c = lastKnownClose(d) ?? base;
    return { date: d, value: c / base };
  });
}

// ─── Metricas de la curva de equity (Sharpe, Profit Factor, R:B) ────────

export interface StrategyStats {
  trades: number;
  wins: number;
  losses: number;
  sharpe: number | null;
  profitFactor: number | null; // ganancia bruta / |perdida bruta|. null si no hay perdidas Y no hay ganancias (sin trades utiles)
  riskReward: number | null; // ganancia promedio por trade ganador / |perdida promedio por trade perdedor|
  maxDrawdownPct: number | null; // 0-100, magnitud de la peor caida pico-a-valle de la curva (siempre positivo)
  calmarRatio: number | null; // CAGR / maxDrawdown -- retorno anualizado por unidad de peor caida soportada
}

/**
 * Metricas de riesgo/retorno de una curva de equity (EquityPoint[] de
 * cualquiera de las simulateIcd*Strategy, o de buyAndHoldCurve).
 *
 * `trades` (opcional): lista real de trades (Trade[], del parametro
 * outTrades de las simulate*Strategy) -- si se pasa, trades/wins/losses/
 * profitFactor/riskReward se calculan sobre el retorno REAL de cada trade
 * (returnPct), no sobre los deltas entre puntos consecutivos de `curve`.
 * Hace falta porque `curve` ahora viene marcada a mercado DIA A DIA (ver
 * markToMarketDaily) para que Max Drawdown/Calmar sean precisos -- sin
 * este parametro, "trades" contaria dias en vez de operaciones reales.
 * Si no se pasa (ej. SPY buy&hold, sin trades discretos), cae al
 * comportamiento anterior: retornos punto a punto de `curve`.
 *
 * Sharpe: SIEMPRE sobre los retornos punto a punto de `curve` completa
 * (dia a dia si viene de simulate*Strategy), anualizado por periodos/año
 * usando el promedio REAL de dias calendario entre puntos -- asi es
 * comparable entre metodologias con distinta frecuencia de rotacion y
 * con el benchmark (que siempre fue diario). Rf=0 (simplificacion, no
 * resta tasa libre de riesgo).
 *
 * Profit Factor: `Infinity` si hubo ganancias y CERO perdidas (caso
 * real, no bug) -- la UI lo debe mostrar como "∞", no como error.
 *
 * Calmar Ratio: CAGR (retorno anualizado, compuesto sobre TODO el periodo
 * de la curva) dividido por el maximo drawdown (la peor caida pico-a-valle
 * de la curva de equity completa, ahora capturando tambien caidas
 * intra-posicion gracias al marcado diario). A diferencia de Sharpe
 * (penaliza toda la volatilidad por igual, subidas y bajadas), Calmar
 * solo mira que tan profundo fue el peor momento real -- estandar en
 * managed futures/CTAs. `Infinity` si nunca hubo drawdown y el CAGR es
 * positivo (caso real, no bug).
 */
export function computeStrategyStats(curve: EquityPoint[], trades?: Trade[]): StrategyStats {
  if (curve.length < 2)
    return { trades: 0, wins: 0, losses: 0, sharpe: null, profitFactor: null, riskReward: null, maxDrawdownPct: null, calmarRatio: null };

  // Retornos punto a punto de la curva completa -- base de Sharpe siempre,
  // y de trades/wins/losses/PF/R:B cuando no hay lista de trades real.
  const curveReturns: number[] = [];
  for (let i = 1; i < curve.length; i++) curveReturns.push(curve[i].value / curve[i - 1].value - 1);

  const tradeReturns = trades && trades.length > 0 ? trades.map((t) => t.returnPct / 100) : curveReturns;
  const tradeCount = trades && trades.length > 0 ? trades.length : curve.length - 1;

  const winReturns = tradeReturns.filter((r) => r > 0);
  const lossReturns = tradeReturns.filter((r) => r < 0);
  const grossProfit = winReturns.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(lossReturns.reduce((a, b) => a + b, 0));

  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null;

  const avgWin = winReturns.length > 0 ? grossProfit / winReturns.length : null;
  const avgLoss = lossReturns.length > 0 ? grossLoss / lossReturns.length : null;
  const riskReward = avgWin !== null && avgLoss !== null && avgLoss > 0 ? avgWin / avgLoss : null;

  let sharpe: number | null = null;
  if (curveReturns.length >= 2) {
    const mean = curveReturns.reduce((a, b) => a + b, 0) / curveReturns.length;
    const variance = curveReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (curveReturns.length - 1);
    const std = Math.sqrt(variance);
    if (std > 0) {
      const totalCalendarDays = (new Date(curve[curve.length - 1].date).getTime() - new Date(curve[0].date).getTime()) / 86400000;
      const avgCalendarDaysPerPeriod = totalCalendarDays / curveReturns.length;
      if (avgCalendarDaysPerPeriod > 0) {
        const periodsPerYear = 365 / avgCalendarDaysPerPeriod;
        sharpe = (mean / std) * Math.sqrt(periodsPerYear);
      }
    }
  }

  // Max drawdown: sobre la curva de equity COMPLETA -- la peor caida desde
  // cualquier pico previo hasta cualquier valle posterior.
  let peak = curve[0].value;
  let maxDrawdown = 0; // fraccion 0-1
  for (const p of curve) {
    if (p.value > peak) peak = p.value;
    const dd = peak > 0 ? (peak - p.value) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  const maxDrawdownPct = maxDrawdown * 100;

  const totalCalendarDays = (new Date(curve[curve.length - 1].date).getTime() - new Date(curve[0].date).getTime()) / 86400000;
  const years = totalCalendarDays / 365;
  let calmarRatio: number | null = null;
  if (years > 0) {
    const totalReturn = curve[curve.length - 1].value / curve[0].value;
    const cagr = Math.pow(totalReturn, 1 / years) - 1;
    if (maxDrawdown > 0) {
      calmarRatio = cagr / maxDrawdown;
    } else if (cagr > 0) {
      calmarRatio = Infinity;
    }
  }

  return { trades: tradeCount, wins: winReturns.length, losses: lossReturns.length, sharpe, profitFactor, riskReward, maxDrawdownPct, calmarRatio };
}
