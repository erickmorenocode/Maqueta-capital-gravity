/**
 * Motor cuantitativo puro del laboratorio de Rotacion Sectorial (Next.js).
 *
 * Equivalente TypeScript de capital-density-lab/analytics.py (proyecto
 * Streamlit descartado a favor de una pagina nativa del dashboard). Nada
 * aqui importa yahoo-finance2 ni nada server-only -- son funciones puras
 * sobre datos ya descargados, para poder recalcular todo en el navegador
 * (sliders instantaneos, sin ida y vuelta al servidor).
 */

export const SECTOR_ETFS = [
  'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLRE', 'XLU', 'XLC',
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

export function simulateIcdRotationStrategy(
  sectorMetrics: Record<string, DensityRow[]>,
  lookbackDays: number,
  holdDays: number
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

    equityValue *= 1 + tradeReturn;
    if (equity.length === 0) equity.push({ date: rebalanceDate, value: 1.0 });
    equity.push({ date: exitDate, value: equityValue });

    // Avanzar estrictamente DESPUES de la fecha de salida (no re-entrar el
    // mismo dia que se cierra la posicion) -- mismo criterio que la
    // version Python (np.searchsorted(..., side='right')).
    const exitIdx = dates.indexOf(exitDate);
    i = exitIdx >= i ? exitIdx + 1 : i + 1;
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
