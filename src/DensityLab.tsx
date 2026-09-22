'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Compass, Sun, Moon, RefreshCw, AlertTriangle, Download } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import {
  SECTOR_ETFS,
  SECTOR_NAMES,
  BENCHMARK,
  DEFAULT_FREE_FLOAT_RATIO,
  WINDOWS,
  VALIDATION_START,
  LIVE_START,
  computeAllSectorsDensity,
  sliceWindow,
  buildRotationMatrix,
  latestRanking,
  lagCorrelationMatrix,
  eventStudy,
  simulateIcdRotationStrategy,
  simulateIcdExitStrategy,
  simulateIcdPriceVolFilterStrategy,
  simulateIcdRegimeSwitchStrategy,
  buildMarketRegimeMap,
  computeStrategyStats,
  buyAndHoldCurve,
  sectorBuyAndHoldReturns,
  type WindowKey,
  type PriceBar,
  type SizeAnchor,
  type TickerStaticInfo,
  type DensityRow,
  type Trade,
  type MarketRegime,
  type EquityPoint,
} from '@/src/lib/densityLab/engine';
import PriceIcdChart from '@/src/components/density/PriceIcdChart';
import Heatmap from '@/src/components/density/Heatmap';
import EquityCurveChart from '@/src/components/density/EquityCurveChart';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type StrategyMethod = 'fixed' | 'icdExit' | 'priceVolFilter' | 'regimeSwitch';

// Corre la metodologia activa sobre un recorte de sectorMetrics (una
// ventana). Extraido para no repetir el switch en calmarByWindow,
// tradesByWindow y el panel consolidado de equity (3 ventanas).
function runStrategyCurve(
  win: Record<string, DensityRow[]>,
  method: StrategyMethod,
  lookbackDays: number,
  holdDays: number,
  priceVolK: number,
  regimeMap: Map<string, MarketRegime>,
  outTrades?: Trade[]
): EquityPoint[] {
  if (method === 'fixed') return simulateIcdRotationStrategy(win, lookbackDays, holdDays, outTrades);
  if (method === 'icdExit') return simulateIcdExitStrategy(win, lookbackDays, outTrades);
  if (method === 'priceVolFilter') return simulateIcdPriceVolFilterStrategy(win, lookbackDays, priceVolK, 60, outTrades);
  return simulateIcdRegimeSwitchStrategy(win, lookbackDays, priceVolK, regimeMap, 60, outTrades);
}

const WINDOW_ORDER: WindowKey[] = ['backtest', 'validation', 'live'];

// Colores por ventana para el panel consolidado -- distinguen visualmente
// que tramo de la curva de equity corresponde a Backtest/Validacion/Live.
const WINDOW_COLORS: Record<WindowKey, string> = {
  backtest: '#f97316',
  validation: '#3b82f6',
  live: '#10b981',
};

// Fechas de corte entre ventanas, para las lineas verticales entrecortadas
// del panel consolidado.
const WINDOW_BOUNDARIES: { date: string; label: string }[] = [
  { date: VALIDATION_START, label: WINDOWS.validation.label },
  { date: LIVE_START, label: WINDOWS.live.label },
];

interface ApiResponse {
  asOf: string;
  priceBars: Record<string, PriceBar[]>;
  sizeSeries: Record<string, SizeAnchor[]>;
  staticInfos: Record<string, TickerStaticInfo>;
  missingPrice: string[];
  missingStatic: string[];
}

type TabKey = 'grafico' | 'mapa' | 'ranking' | 'backtest';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'backtest', label: 'Backtesting Cuantitativo' },
  { key: 'grafico', label: 'Grafico Principal' },
  { key: 'mapa', label: 'Mapa de Rotacion' },
  { key: 'ranking', label: 'Ranking de Sectores' },
];

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix = '',
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn('space-y-1.5', disabled && 'opacity-40')}>
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-ink/60">
        <span>{label}</span>
        <span className="text-accent">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
    </div>
  );
}

export default function DensityLab() {
  const [darkMode, setDarkMode] = useState(true);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [windowKey, setWindowKey] = useState<WindowKey>('backtest');
  const [rollingWindow, setRollingWindow] = useState(42);
  const [zThreshold, setZThreshold] = useState(2.0);
  const [freeFloatRatio, setFreeFloatRatio] = useState(DEFAULT_FREE_FLOAT_RATIO);
  const [heatmapDays, setHeatmapDays] = useState(30);
  const [lookbackDays, setLookbackDays] = useState(9);
  const [holdDays, setHoldDays] = useState(5);
  const [priceVolK, setPriceVolK] = useState(0.25);
  const [strategyMethod, setStrategyMethod] = useState<'fixed' | 'icdExit' | 'priceVolFilter' | 'regimeSwitch'>('regimeSwitch');
  const [selectedTicker, setSelectedTicker] = useState<string>('XLK');
  const [activeTab, setActiveTab] = useState<TabKey>('backtest');

  useEffect(() => {
    document.documentElement.classList.toggle('light', !darkMode);
  }, [darkMode]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/density-lab');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sectorMetricsFull = useMemo<Record<string, DensityRow[]>>(() => {
    if (!data) return {};
    const sectorBars: Record<string, PriceBar[]> = {};
    for (const t of SECTOR_ETFS) {
      if (data.priceBars[t]) sectorBars[t] = data.priceBars[t];
    }
    return computeAllSectorsDensity(sectorBars, data.sizeSeries, freeFloatRatio, rollingWindow);
  }, [data, freeFloatRatio, rollingWindow]);

  const activeWindow = WINDOWS[windowKey];

  const sectorMetricsWindow = useMemo<Record<string, DensityRow[]>>(() => {
    const out: Record<string, DensityRow[]> = {};
    for (const [t, rows] of Object.entries(sectorMetricsFull)) {
      const sliced = sliceWindow(rows, activeWindow.start, activeWindow.end);
      if (sliced.length > 0) out[t] = sliced;
    }
    return out;
  }, [sectorMetricsFull, activeWindow]);

  const rotationMatrix = useMemo(() => buildRotationMatrix(sectorMetricsWindow, heatmapDays), [sectorMetricsWindow, heatmapDays]);
  const ranking = useMemo(() => latestRanking(sectorMetricsWindow), [sectorMetricsWindow]);
  const corrMatrix = useMemo(() => lagCorrelationMatrix(sectorMetricsWindow), [sectorMetricsWindow]);
  const sectorReturns = useMemo(() => sectorBuyAndHoldReturns(sectorMetricsWindow), [sectorMetricsWindow]);
  const events = useMemo(() => eventStudy(sectorMetricsWindow, zThreshold), [sectorMetricsWindow, zThreshold]);
  const fixedHoldCurve = useMemo(
    () => simulateIcdRotationStrategy(sectorMetricsWindow, lookbackDays, holdDays),
    [sectorMetricsWindow, lookbackDays, holdDays]
  );
  const icdExitCurve = useMemo(
    () => simulateIcdExitStrategy(sectorMetricsWindow, lookbackDays),
    [sectorMetricsWindow, lookbackDays]
  );
  const priceVolFilterCurve = useMemo(
    () => simulateIcdPriceVolFilterStrategy(sectorMetricsWindow, lookbackDays, priceVolK),
    [sectorMetricsWindow, lookbackDays, priceVolK]
  );
  // Regimen de SPY sobre la serie COMPLETA (no la ventana activa) -- la
  // mediana movil de 252 dias necesita historia previa al inicio de la
  // ventana para clasificar correctamente los primeros dias de esta.
  const regimeMap = useMemo(() => {
    if (!data) return new Map();
    const spyBars = data.priceBars[BENCHMARK];
    if (!spyBars) return new Map();
    return buildMarketRegimeMap(spyBars);
  }, [data]);
  const regimeSwitchCurve = useMemo(
    () => simulateIcdRegimeSwitchStrategy(sectorMetricsWindow, lookbackDays, priceVolK, regimeMap),
    [sectorMetricsWindow, lookbackDays, priceVolK, regimeMap]
  );
  const strategyCurve =
    strategyMethod === 'fixed'
      ? fixedHoldCurve
      : strategyMethod === 'icdExit'
        ? icdExitCurve
        : strategyMethod === 'priceVolFilter'
          ? priceVolFilterCurve
          : regimeSwitchCurve;
  const strategyStats = useMemo(() => computeStrategyStats(strategyCurve), [strategyCurve]);
  // SPY real: dia a dia, TODA la ventana (no recortado a las fechas de
  // trade de la estrategia). Es el buy&hold real -- el "Retorno SPY" y el
  // "Alpha simple" mostrados en pantalla se calculan sobre esto, no sobre
  // benchmarkCurve. Si se usara benchmarkCurve ahi, el retorno de SPY
  // mostrado quedaria recortado al primer trade de la estrategia -- con
  // M3 (filtro de vol. de precio, mas exigente para entrar) esto llego a
  // subestimar a SPY en Validacion por 14.7pp (perdia ene-mar 2024 porque
  // la estrategia recien entro el 28-mar).
  const spyFullCurve = useMemo(() => {
    if (!data) return [];
    const spyBars = data.priceBars[BENCHMARK];
    if (!spyBars) return [];
    const spyWindow = spyBars.filter((b) => b.date >= activeWindow.start && (activeWindow.end === null || b.date <= activeWindow.end));
    return buyAndHoldCurve(spyWindow, spyWindow.map((b) => b.date));
  }, [data, activeWindow]);
  // Max drawdown/Calmar de SPY sobre la ventana REAL (dia a dia), igual
  // criterio que Retorno/Alpha -- no el recorte a fechas de trade
  // (benchmarkStats mas abajo), que subestimaria el drawdown real al
  // saltarse los dias entre trades de la estrategia.
  const spyFullStats = useMemo(() => computeStrategyStats(spyFullCurve), [spyFullCurve]);
  // SPY recortado a las fechas de trade de la estrategia -- solo para
  // Sharpe/PF/R:B de SPY (comparacion de riesgo bajo la MISMA exposicion
  // temporal que tuvo la estrategia, no el retorno real de SPY).
  const benchmarkCurve = useMemo(() => {
    if (!data || strategyCurve.length === 0) return [];
    const spyBars = data.priceBars[BENCHMARK];
    if (!spyBars) return [];
    const spyWindow = spyBars.filter((b) => b.date >= activeWindow.start && (activeWindow.end === null || b.date <= activeWindow.end));
    return buyAndHoldCurve(spyWindow, strategyCurve.map((p) => p.date));
  }, [data, strategyCurve, activeWindow]);
  const benchmarkStats = useMemo(() => computeStrategyStats(benchmarkCurve), [benchmarkCurve]);

  // Calmar de la metodologia activa en CADA ventana (no solo la ventana en
  // pantalla) -- para el chequeo de robustez/degradacion: si el Calmar cae
  // mucho de Backtest a Validacion/Live, la estrategia esta sobreajustada
  // al backtest y no es confiable en tiempo real.
  const calmarByWindow = useMemo<Record<WindowKey, number | null>>(() => {
    const result: Record<WindowKey, number | null> = { backtest: null, validation: null, live: null };
    for (const key of Object.keys(WINDOWS) as WindowKey[]) {
      const w = WINDOWS[key];
      const win: Record<string, DensityRow[]> = {};
      for (const [t, rows] of Object.entries(sectorMetricsFull)) {
        const sliced = sliceWindow(rows, w.start, w.end);
        if (sliced.length > 0) win[t] = sliced;
      }
      const curve = runStrategyCurve(win, strategyMethod, lookbackDays, holdDays, priceVolK, regimeMap as Map<string, MarketRegime>);
      result[key] = computeStrategyStats(curve).calmarRatio;
    }
    return result;
  }, [sectorMetricsFull, strategyMethod, lookbackDays, holdDays, priceVolK, regimeMap]);

  // Robustez = minimo Calmar entre ventanas / maximo Calmar entre ventanas.
  // Umbral 80%: si la peor ventana no llega al 80% del Calmar de la mejor
  // ventana, se marca como degradada (posible sobreajuste al backtest).
  // Solo se consideran valores finitos (Infinity = drawdown cero, no
  // comparable con las demas ventanas por division).
  const calmarRobustness = useMemo(() => {
    const finite = (Object.values(calmarByWindow) as (number | null)[]).filter(
      (v): v is number => v !== null && Number.isFinite(v)
    );
    if (finite.length < 2) return null;
    const max = Math.max(...finite);
    const min = Math.min(...finite);
    const ratio = max > 0 ? min / max : null;
    return { min, max, ratio, isRobust: ratio !== null && ratio >= 0.8 };
  }, [calmarByWindow]);

  // Panel consolidado: encadena la curva de equity de la metodologia activa
  // en las 3 ventanas (cada simulate*Strategy resetea a 1.0 al inicio de
  // su propia ventana) multiplicando por el valor acumulado de la ventana
  // anterior -- asi la curva es continua 2018-presente en vez de 3 curvas
  // separadas que reinician en 1.0. Un tramo (segment) por ventana, con
  // color propio, para que se distingan Backtest/Validacion/Live sin
  // cortar el grafico en 3.
  const combinedStrategySegments = useMemo(() => {
    const segments: { key: WindowKey; label: string; color: string; points: EquityPoint[] }[] = [];
    let carry = 1;
    for (const key of WINDOW_ORDER) {
      const w = WINDOWS[key];
      const win: Record<string, DensityRow[]> = {};
      for (const [t, rows] of Object.entries(sectorMetricsFull)) {
        const sliced = sliceWindow(rows, w.start, w.end);
        if (sliced.length > 0) win[t] = sliced;
      }
      const curve = runStrategyCurve(win, strategyMethod, lookbackDays, holdDays, priceVolK, regimeMap as Map<string, MarketRegime>);
      if (curve.length === 0) continue;
      const base = curve[0].value;
      const points = curve.map((p) => ({ date: p.date, value: (p.value / base) * carry }));
      // Anclas de continuidad: el primer trade real puede caer varios dias
      // despues del inicio de la ventana (espera el lookback) y el ultimo
      // trade puede cerrar antes del fin de la ventana (sin señal de
      // reentrada) -- sin estas anclas el tramo no llega a los bordes de su
      // ventana y se ve un corte/hueco en vez de linea continua con el
      // tramo vecino. El valor es plano (sin posicion abierta = equity no
      // cambia) hasta el primer trade y desde el ultimo.
      if (points[0].date > w.start) points.unshift({ date: w.start, value: points[0].value });
      const windowEnd = w.end ?? points[points.length - 1].date;
      if (points[points.length - 1].date < windowEnd) points.push({ date: windowEnd, value: points[points.length - 1].value });
      carry = points[points.length - 1].value;
      segments.push({ key, label: WINDOWS[key].label, color: WINDOW_COLORS[key], points });
    }
    return segments;
  }, [sectorMetricsFull, strategyMethod, lookbackDays, holdDays, priceVolK, regimeMap]);

  // SPY buy&hold continuo 2018-presente (sin cortar por ventana) -- sirve
  // de referencia unica para todo el panel consolidado.
  const combinedBenchmarkCurve = useMemo(() => {
    if (!data) return [];
    const spyBars = data.priceBars[BENCHMARK];
    if (!spyBars) return [];
    const spyFull = spyBars.filter((b) => b.date >= WINDOWS.backtest.start);
    return buyAndHoldCurve(spyFull, spyFull.map((b) => b.date));
  }, [data]);

  // Trades de la metodologia activa en CADA ventana (no solo la activa en
  // pantalla) -- para el export a Excel. sectorMetricsFull ya tiene la
  // serie completa calculada una vez (mismos rollingWindow/freeFloatRatio
  // que el resto de la UI), solo hace falta cortarla y correr la
  // estrategia 3 veces.
  const tradesByWindow = (): Record<WindowKey, Trade[]> => {
    const result: Record<WindowKey, Trade[]> = { backtest: [], validation: [], live: [] };
    for (const key of Object.keys(WINDOWS) as WindowKey[]) {
      const w = WINDOWS[key];
      const win: Record<string, DensityRow[]> = {};
      for (const [t, rows] of Object.entries(sectorMetricsFull)) {
        const sliced = sliceWindow(rows, w.start, w.end);
        if (sliced.length > 0) win[t] = sliced;
      }
      const trades: Trade[] = [];
      runStrategyCurve(win, strategyMethod, lookbackDays, holdDays, priceVolK, regimeMap as Map<string, MarketRegime>, trades);
      result[key] = trades;
    }
    return result;
  };

  const strategyMethodLabel = () =>
    strategyMethod === 'fixed'
      ? `M1 (tenencia fija ${holdDays}d)`
      : strategyMethod === 'icdExit'
        ? 'M2 (sale si ICD < 0)'
        : strategyMethod === 'priceVolFilter'
          ? `M3 (filtro vol. precio k=${priceVolK})`
          : `M4 (portafolio segun regimen SPY, k=${priceVolK})`;

  const SHEET_NAMES: Record<WindowKey, string> = { backtest: 'Backtest', validation: 'Validacion', live: 'Live' };

  const handleExportExcel = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Capital Gravity';
      workbook.created = new Date();

      const byWindow = tradesByWindow();

      const isRegimeSwitch = strategyMethod === 'regimeSwitch';

      for (const key of Object.keys(WINDOWS) as WindowKey[]) {
        const sheet = workbook.addWorksheet(SHEET_NAMES[key]);
        sheet.columns = [
          { header: 'Ticker', key: 'ticker', width: 10 },
          { header: 'Sector', key: 'sector', width: 24 },
          { header: 'Fecha entrada', key: 'entryDate', width: 14 },
          { header: 'Precio entrada', key: 'entryPrice', width: 14 },
          { header: 'Fecha salida', key: 'exitDate', width: 14 },
          { header: 'Precio salida', key: 'exitPrice', width: 14 },
          { header: 'Retorno %', key: 'returnPct', width: 12 },
          { header: 'Retorno acumulado %', key: 'cumulativePct', width: 18 },
          { header: 'Dias en posicion', key: 'days', width: 16 },
          ...(isRegimeSwitch ? [{ header: 'Metodologia aplicada', key: 'appliedMethod', width: 32 }] : []),
        ];
        sheet.getRow(1).font = { bold: true };

        // Compuesto fila a fila (no suma simple) -- (1+r1)*(1+r2)*...-1. La
        // ultima fila de esta columna coincide con el "Retorno" que muestra
        // el dashboard para esta ventana; sumar la columna "Retorno %" a
        // mano NO da ese numero, los retornos se componen, no se suman.
        let cumulative = 1;
        for (const t of byWindow[key]) {
          const days = Math.round((new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / 86400000);
          cumulative *= 1 + t.returnPct / 100;
          sheet.addRow({
            ticker: t.ticker,
            sector: SECTOR_NAMES[t.ticker] ?? t.ticker,
            entryDate: t.entryDate,
            entryPrice: Number(t.entryPrice.toFixed(2)),
            exitDate: t.exitDate,
            exitPrice: Number(t.exitPrice.toFixed(2)),
            returnPct: Number(t.returnPct.toFixed(2)),
            cumulativePct: Number(((cumulative - 1) * 100).toFixed(2)),
            days,
            ...(isRegimeSwitch ? { appliedMethod: t.appliedMethod ?? '' } : {}),
          });
        }
        if (byWindow[key].length === 0) {
          sheet.addRow(['Sin trades en esta ventana con la metodologia/parametros actuales']);
        }
      }

      const infoSheet = workbook.addWorksheet('Info');
      infoSheet.columns = [
        { header: 'Parametro', key: 'k', width: 28 },
        { header: 'Valor', key: 'v', width: 50 },
      ];
      infoSheet.getRow(1).font = { bold: true };
      infoSheet.addRow({ k: 'Metodologia', v: strategyMethodLabel() });
      infoSheet.addRow({ k: 'Lookback delta ICD (dias)', v: lookbackDays });
      infoSheet.addRow({ k: 'Media movil ICD (dias)', v: rollingWindow });
      infoSheet.addRow({ k: 'Universo', v: SECTOR_ETFS.join(', ') });
      infoSheet.addRow({ k: 'Generado', v: new Date().toISOString() });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `posiciones_${strategyMethod}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const selectedInfo = data?.staticInfos[selectedTicker];
  const selectedSeries = sectorMetricsWindow[selectedTicker] ?? [];

  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-accent/30 selection:text-accent">
      <header className="border-b border-border h-16 flex items-center px-8 justify-between glass sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2 rounded border border-border hover:border-accent/40 hover:bg-accent/5 transition-all"
            title="Volver a Capital Gravity"
          >
            <ArrowLeft className="w-4 h-4 text-ink/60" />
          </Link>
          <div className="w-8 h-8 rounded bg-accent/20 flex items-center justify-center border border-accent/30">
            <Compass className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tighter uppercase">Densidad de Capital</h1>
            <p className="text-[10px] font-mono text-ink/40 uppercase tracking-widest">
              Rotacion Sectorial · Momento de Liquidez
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            disabled={loading}
            className={cn(
              'flex items-center gap-2 px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all',
              loading ? 'bg-ink/10 text-ink/40 cursor-not-allowed' : 'bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30'
            )}
          >
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
            {loading ? 'Descargando...' : 'Actualizar datos'}
          </button>
          <button
            onClick={handleExportExcel}
            disabled={!data || exporting}
            title="Descargar posiciones de la estrategia activa en las 3 ventanas (Backtest/Validacion/Live)"
            className={cn(
              'flex items-center gap-2 px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all',
              !data || exporting ? 'bg-ink/10 text-ink/40 cursor-not-allowed' : 'bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30'
            )}
          >
            <Download className={cn('w-3 h-3', exporting && 'animate-pulse')} />
            {exporting ? 'Generando...' : 'Exportar Excel'}
          </button>
          <button
            onClick={() => setDarkMode((d) => !d)}
            className="p-2 rounded border border-border hover:border-accent/40 hover:bg-accent/5 transition-all"
          >
            {darkMode ? <Sun className="w-4 h-4 text-ink/60" /> : <Moon className="w-4 h-4 text-ink/60" />}
          </button>
        </div>
      </header>

      <main className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1600px] mx-auto">
        {/* Sidebar */}
        <aside className="lg:col-span-3 space-y-5">
          <section className="glass rounded-lg p-4 space-y-4">
            <h2 className="text-[10px] font-mono uppercase tracking-widest text-ink/50">Parametros del modelo</h2>
            <Slider label="Media movil (dias)" value={rollingWindow} min={5} max={60} step={1} onChange={setRollingWindow} suffix="d" />
            <Slider label="Umbral anomalia (Z-Score)" value={zThreshold} min={1} max={4} step={0.1} onChange={setZThreshold} />
            <Slider
              label="Proxy free float"
              value={Math.round(freeFloatRatio * 100)}
              min={50}
              max={100}
              step={1}
              onChange={(v) => setFreeFloatRatio(v / 100)}
              suffix="%"
            />
          </section>

          <section className="glass rounded-lg p-4 space-y-4">
            <h2 className="text-[10px] font-mono uppercase tracking-widest text-ink/50">Backtest y mapa</h2>
            <Slider label="Dias en mapa de rotacion" value={heatmapDays} min={10} max={90} step={5} onChange={setHeatmapDays} suffix="d" />

            <div className="space-y-1.5">
              <span className="text-[10px] font-mono text-ink/50">Estrategia: metodologia de salida</span>
              {([
                { key: 'fixed' as const, label: 'M1: tenencia fija' },
                { key: 'icdExit' as const, label: 'M2: sale si ICD < 0' },
                { key: 'priceVolFilter' as const, label: 'M3: M2 + filtro vol. precio' },
                { key: 'regimeSwitch' as const, label: 'M4: portafolio segun regimen SPY' },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setStrategyMethod(key)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded text-[11px] font-mono border transition-all',
                    strategyMethod === key ? 'bg-accent/15 border-accent/40 text-accent' : 'border-border text-ink/60 hover:border-accent/20'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <Slider label="Estrategia: lookback delta ICD" value={lookbackDays} min={1} max={10} step={1} onChange={setLookbackDays} suffix="d" />
            <Slider
              label="Estrategia: dias de tenencia"
              value={holdDays}
              min={1}
              max={20}
              step={1}
              onChange={setHoldDays}
              suffix="d"
              disabled={strategyMethod !== 'fixed'}
            />
            {strategyMethod !== 'fixed' && (
              <p className="text-[9px] font-mono text-ink/40">M2/M3/M4 no usan dias de tenencia -- salen por señal (ICD &lt; 0), no por plazo.</p>
            )}
            <Slider
              label="Estrategia: filtro vol. precio (k)"
              value={priceVolK}
              min={0}
              max={1}
              step={0.05}
              onChange={setPriceVolK}
              disabled={strategyMethod !== 'priceVolFilter' && strategyMethod !== 'regimeSwitch'}
            />
            {strategyMethod === 'priceVolFilter' && (
              <p className="text-[9px] font-mono text-ink/40">
                Solo entra si el retorno de precio del ticker elegido supera k × su propia volatilidad diaria (60d) escalada al lookback.
                k=0.25 valida como optimo por robustez (grid search offline).
              </p>
            )}
            {strategyMethod === 'regimeSwitch' && (
              <p className="text-[9px] font-mono text-ink/40">
                M4: usa el filtro de M3 (con este k) solo cuando la volatilidad realizada de SPY (20d) esta por debajo de su propia
                mediana movil de ~1 año -- en regimen de alta volatilidad entra sin filtro, como M2. Validado como la metodologia mas
                robusta en Backtest/Validacion/Live (grid search offline).
              </p>
            )}
          </section>

          <section className="glass rounded-lg p-4 space-y-3">
            <h2 className="text-[10px] font-mono uppercase tracking-widest text-ink/50">ETF (grafico principal)</h2>
            <select
              value={selectedTicker}
              onChange={(e) => setSelectedTicker(e.target.value)}
              className="w-full bg-surface border border-border rounded px-3 py-2 text-[11px] font-mono text-ink"
            >
              {SECTOR_ETFS.map((t) => (
                <option key={t} value={t}>
                  {t} - {SECTOR_NAMES[t]}
                </option>
              ))}
            </select>
          </section>

          <p className="text-[9px] font-mono text-ink/35 leading-relaxed px-1">
            Datos: Yahoo Finance. market_cap y shares_outstanding de ETFs casi nunca vienen poblados por Yahoo
            → se aproximan con AUM (totalAssets) y AUM/precio. Ver comentarios en{' '}
            <code className="text-ink/50">src/lib/densityLab/dataFetch.ts</code>.
          </p>
        </aside>

        {/* Contenido principal */}
        <div className="lg:col-span-9 space-y-4">
          {error && (
            <div className="glass rounded-lg p-4 border-danger/40 flex items-center gap-2 text-[11px] font-mono text-danger">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              No se pudo descargar datos de Yahoo Finance: {error}
            </div>
          )}

          {data && (data.missingPrice.length > 0 || data.missingStatic.length > 0) && (
            <div className="glass rounded-lg p-3 text-[10px] font-mono text-ink/50">
              {data.missingPrice.length > 0 && <div>Sin precio: {data.missingPrice.join(', ')}</div>}
              {data.missingStatic.length > 0 && <div>Sin AUM/precio suficiente para estimar tamano: {data.missingStatic.join(', ')}</div>}
            </div>
          )}

          {loading && !data && (
            <div className="glass rounded-lg p-16 text-center text-[11px] font-mono text-ink/40">
              Descargando historial 2018-presente de 11 ETFs sectoriales + GLD + QQQ + SPY desde Yahoo Finance...
            </div>
          )}

          {data && (
            <>
              <div className="glass rounded-lg px-4 py-3 text-[10px] font-mono text-ink/50 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  Ventana: <b className="text-ink">{activeWindow.label}</b>
                </span>
                <span>
                  {activeWindow.start} → {activeWindow.end ?? 'hoy'}
                </span>
                <span>Media movil: {rollingWindow}d</span>
                <span>Umbral Z: {zThreshold}</span>
              </div>

              <div className="flex gap-1 border-b border-border">
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      'px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest border-b-2 transition-all -mb-px',
                      activeTab === tab.key ? 'border-accent text-accent' : 'border-transparent text-ink/50 hover:text-ink/80'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="glass rounded-lg p-5">
                {activeTab === 'grafico' && (
                  <div className="space-y-3">
                    {selectedInfo?.source === 'proxy' && (
                      <p className="text-[9px] font-mono text-ink/40">
                        ⚠ Market cap / shares outstanding de {selectedTicker} estimados por proxy (AUM/precio) — Yahoo no expone el dato directo.
                      </p>
                    )}
                    <PriceIcdChart data={selectedSeries} ticker={selectedTicker} zThreshold={zThreshold} />

                    <div>
                      <h3 className="text-[11px] font-mono uppercase tracking-widest text-ink/60 mb-3">
                        Estudio de eventos: ICD z-score &gt; {zThreshold}
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[10px] font-mono">
                          <thead>
                            <tr className="text-ink/50 border-b border-border">
                              <th className="text-left py-2 px-2">Sector</th>
                              <th className="text-right py-2 px-2">N eventos</th>
                              {corrMatrix.lags.map((l) => (
                                <th key={l} className="text-right py-2 px-2">
                                  Post {l}d / Base {l}d
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {events.map((ev) => (
                              <tr key={ev.ticker} className="border-b border-border/40">
                                <td className="py-2 px-2">
                                  {ev.sector} <span className="text-ink/40">({ev.ticker})</span>
                                </td>
                                <td className="text-right py-2 px-2">{ev.nEvents}</td>
                                {corrMatrix.lags.map((l) => {
                                  const cell = ev.byLag[l];
                                  return (
                                    <td key={l} className="text-right py-2 px-2">
                                      {cell?.postEventMean !== null && cell?.postEventMean !== undefined ? `${(cell.postEventMean * 100).toFixed(2)}%` : '—'}
                                      {' / '}
                                      {cell?.baseMean !== null && cell?.baseMean !== undefined ? `${(cell.baseMean * 100).toFixed(2)}%` : '—'}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[9px] font-mono text-ink/40 mt-2">
                        Compara el retorno futuro promedio despues de un evento de anomalia (Post) contra el retorno promedio incondicional (Base).
                      </p>
                    </div>
                  </div>
                )}

                {activeTab === 'mapa' && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-mono text-ink/50">
                      Filas mas &quot;brillantes&quot; = sectores absorbiendo mas capital relativo a su propio historial reciente.
                    </p>
                    <Heatmap
                      rowLabels={rotationMatrix.sectors}
                      colLabels={rotationMatrix.dates}
                      values={rotationMatrix.values}
                      scaleType="sequential"
                      legendLabel="ICD (densidad de capital)"
                    />
                  </div>
                )}

                {activeTab === 'ranking' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] font-mono">
                      <thead>
                        <tr className="text-ink/50 border-b border-border">
                          <th className="text-left py-2 px-2">Sector</th>
                          <th className="text-right py-2 px-2">Cierre</th>
                          <th className="text-right py-2 px-2">Volumen</th>
                          <th className="text-right py-2 px-2">VMC (z)</th>
                          <th className="text-right py-2 px-2">STR (z)</th>
                          <th className="text-right py-2 px-2">FFT (z)</th>
                          <th className="text-right py-2 px-2">ICD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ranking.map((r, i) => (
                          <tr key={r.ticker} className={cn('border-b border-border/40', i === 0 && 'text-accent')}>
                            <td className="py-2 px-2">
                              {r.sector} <span className="text-ink/40">({r.ticker})</span>
                            </td>
                            <td className="text-right py-2 px-2">{r.close.toFixed(2)}</td>
                            <td className="text-right py-2 px-2">{r.volume.toLocaleString('es-ES')}</td>
                            <td className="text-right py-2 px-2">{r.zVMC?.toFixed(2) ?? '—'}</td>
                            <td className="text-right py-2 px-2">{r.zSTR?.toFixed(2) ?? '—'}</td>
                            <td className="text-right py-2 px-2">{r.zFFT?.toFixed(2) ?? '—'}</td>
                            <td className="text-right py-2 px-2 font-bold">{r.ICD?.toFixed(3) ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {ranking.length === 0 && <p className="text-[11px] font-mono text-ink/40 py-8 text-center">Sin datos en esta ventana.</p>}
                  </div>
                )}

                {activeTab === 'backtest' && (
                  <div className="space-y-8">
                    <div>
                      <h3 className="text-[11px] font-mono uppercase tracking-widest text-ink/60 mb-3">
                        Estrategia: comprar mayor delta ICD ({lookbackDays}d) —{' '}
                        {strategyMethod === 'fixed'
                          ? `M1: mantener ${holdDays}d`
                          : strategyMethod === 'icdExit'
                            ? 'M2: sale si ICD < 0'
                            : strategyMethod === 'priceVolFilter'
                              ? `M3: M2 + filtro vol. precio (k=${priceVolK})`
                              : `M4: portafolio segun regimen SPY (k=${priceVolK})`}
                      </h3>
                      <p className="text-[9px] font-mono text-ink/40 mb-2">
                        Vista consolidada: las 3 ventanas encadenadas en una sola curva de equity (2018-presente),
                        separadas por linea vertical entrecortada. Click en un tramo de la curva (o su etiqueta)
                        para ver el rendimiento y los ratios de esa ventana debajo, y para que las pestanas Grafico
                        Principal/Mapa/Ranking usen esa misma ventana.
                      </p>
                      <EquityCurveChart
                        segments={combinedStrategySegments}
                        benchmark={combinedBenchmarkCurve}
                        boundaries={WINDOW_BOUNDARIES}
                        selectedWindow={windowKey}
                        onSelectWindow={setWindowKey}
                      />
                      {strategyCurve.length >= 2 && (
                        <div className="mt-4 space-y-4">
                          <div>
                            <div className="text-[9px] font-mono uppercase tracking-widest text-ink/40 mb-1.5">Estrategia ICD</div>
                            <div className="grid grid-cols-6 gap-4">
                              <StatCard label="Retorno" value={`${((strategyCurve[strategyCurve.length - 1].value / strategyCurve[0].value - 1) * 100).toFixed(1)}%`} />
                              <StatCard label="Sharpe (anualizado)" value={strategyStats.sharpe !== null ? strategyStats.sharpe.toFixed(2) : '—'} />
                              <StatCard
                                label="Profit factor"
                                value={
                                  strategyStats.profitFactor === null
                                    ? '—'
                                    : strategyStats.profitFactor === Infinity
                                      ? '∞'
                                      : strategyStats.profitFactor.toFixed(2)
                                }
                              />
                              <StatCard
                                label="Riesgo:Beneficio"
                                value={strategyStats.riskReward !== null ? `1 : ${strategyStats.riskReward.toFixed(2)}` : '—'}
                              />
                              <StatCard
                                label="Max Drawdown"
                                value={strategyStats.maxDrawdownPct !== null ? `-${strategyStats.maxDrawdownPct.toFixed(1)}%` : '—'}
                              />
                              <StatCard
                                label="Calmar Ratio"
                                value={
                                  strategyStats.calmarRatio === null
                                    ? '—'
                                    : strategyStats.calmarRatio === Infinity
                                      ? '∞'
                                      : strategyStats.calmarRatio.toFixed(2)
                                }
                              />
                            </div>
                            <p className="text-[9px] font-mono text-ink/40 mt-1.5">
                              {strategyStats.trades} trades ({strategyStats.wins} ganadores / {strategyStats.losses} perdedores)
                            </p>
                          </div>

                          {calmarRobustness && (
                            <div>
                              <div className="text-[9px] font-mono uppercase tracking-widest text-ink/40 mb-1.5">
                                Robustez Calmar (metodologia {strategyMethodLabel()}, min/max entre ventanas)
                              </div>
                              <div className="grid grid-cols-4 gap-4">
                                <StatCard
                                  label="Backtest"
                                  value={
                                    calmarByWindow.backtest === null
                                      ? '—'
                                      : calmarByWindow.backtest === Infinity
                                        ? '∞'
                                        : calmarByWindow.backtest.toFixed(2)
                                  }
                                />
                                <StatCard
                                  label="Validacion"
                                  value={
                                    calmarByWindow.validation === null
                                      ? '—'
                                      : calmarByWindow.validation === Infinity
                                        ? '∞'
                                        : calmarByWindow.validation.toFixed(2)
                                  }
                                />
                                <StatCard
                                  label="Live"
                                  value={calmarByWindow.live === null ? '—' : calmarByWindow.live === Infinity ? '∞' : calmarByWindow.live.toFixed(2)}
                                />
                                <StatCard
                                  label={calmarRobustness.isRobust ? 'Robusta (min >= 80% max)' : 'Degradada (min < 80% max)'}
                                  value={calmarRobustness.ratio !== null ? `${(calmarRobustness.ratio * 100).toFixed(0)}%` : '—'}
                                  tone={calmarRobustness.isRobust ? 'good' : 'bad'}
                                />
                              </div>
                              <p className="text-[9px] font-mono text-ink/40 mt-1.5">
                                Calmar minimo entre las 3 ventanas / Calmar maximo entre las 3 ventanas, para la metodologia activa. Umbral 80%: si la
                                peor ventana no llega al 80% del Calmar de la mejor ventana, la estrategia se considera degradada (posible sobreajuste
                                al backtest). Ventanas con Calmar infinito (drawdown cero) se excluyen del calculo por no ser comparables.
                              </p>
                            </div>
                          )}

                          {spyFullCurve.length >= 2 && (
                            <div>
                              <div className="text-[9px] font-mono uppercase tracking-widest text-ink/40 mb-1.5">
                                SPY Buy &amp; Hold (ventana completa, dia a dia)
                              </div>
                              <div className="grid grid-cols-6 gap-4">
                                <StatCard label="Retorno" value={`${((spyFullCurve[spyFullCurve.length - 1].value / spyFullCurve[0].value - 1) * 100).toFixed(1)}%`} />
                                <StatCard
                                  label="Sharpe (mismos periodos que estrategia)"
                                  value={benchmarkStats.sharpe !== null ? benchmarkStats.sharpe.toFixed(2) : '—'}
                                />
                                <StatCard
                                  label="Profit factor (mismos periodos)"
                                  value={
                                    benchmarkStats.profitFactor === null
                                      ? '—'
                                      : benchmarkStats.profitFactor === Infinity
                                        ? '∞'
                                        : benchmarkStats.profitFactor.toFixed(2)
                                  }
                                />
                                <StatCard
                                  label="Riesgo:Beneficio (mismos periodos)"
                                  value={benchmarkStats.riskReward !== null ? `1 : ${benchmarkStats.riskReward.toFixed(2)}` : '—'}
                                />
                                <StatCard
                                  label="Max Drawdown (ventana real)"
                                  value={spyFullStats.maxDrawdownPct !== null ? `-${spyFullStats.maxDrawdownPct.toFixed(1)}%` : '—'}
                                />
                                <StatCard
                                  label="Calmar Ratio (ventana real)"
                                  value={
                                    spyFullStats.calmarRatio === null
                                      ? '—'
                                      : spyFullStats.calmarRatio === Infinity
                                        ? '∞'
                                        : spyFullStats.calmarRatio.toFixed(2)
                                  }
                                />
                              </div>
                            </div>
                          )}

                          {spyFullCurve.length >= 2 && (
                            <StatCard
                              label="Alpha simple (retorno estrategia − retorno SPY real)"
                              value={`${(
                                ((strategyCurve[strategyCurve.length - 1].value / strategyCurve[0].value - 1) -
                                  (spyFullCurve[spyFullCurve.length - 1].value / spyFullCurve[0].value - 1)) *
                                100
                              ).toFixed(1)} pp`}
                            />
                          )}

                          <p className="text-[9px] font-mono text-ink/40">
                            Sharpe con Rf=0, anualizado por dias reales entre periodos. Profit factor = ganancia bruta / |perdida bruta|.
                            Riesgo:Beneficio = perdida promedio : ganancia promedio por periodo. Max Drawdown = peor caida pico-a-valle de la curva
                            de equity (magnitud, 0-100%). Calmar Ratio = CAGR / Max Drawdown, retorno anualizado por unidad de peor caida soportada
                            (a diferencia del Sharpe, no penaliza toda la volatilidad, solo la peor racha perdedora -- estandar en CTAs/managed
                            futures). El Retorno, Alpha, Max Drawdown y Calmar de SPY usan la ventana completa dia a dia (buy&amp;hold real) --
                            Sharpe/PF/R:B de SPY se calculan recortados a los mismos periodos de entrada/salida que tuvo la estrategia (comparacion
                            de riesgo bajo la misma exposicion temporal, no el retorno real).
                          </p>
                        </div>
                      )}
                    </div>

                    <div>
                      <h3 className="text-[11px] font-mono uppercase tracking-widest text-ink/60 mb-3">
                        Retorno real por sector en esta ventana (Buy &amp; Hold)
                      </h3>
                      <p className="text-[9px] font-mono text-ink/40 mb-3">
                        Cuanto se hubiera ganado o perdido invirtiendo en cada sector el primer dia de la ventana
                        activa ({activeWindow.start}) y manteniendo hasta {activeWindow.end ?? 'hoy'} — sin rotar,
                        sin ICD, solo el precio del ETF.
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px] font-mono">
                          <thead>
                            <tr className="text-ink/50 border-b border-border">
                              <th className="text-left py-2 px-2">Sector</th>
                              <th className="text-right py-2 px-2">Inicio ({sectorReturns[0]?.startDate ?? '—'})</th>
                              <th className="text-right py-2 px-2">Fin ({sectorReturns[0]?.endDate ?? '—'})</th>
                              <th className="text-right py-2 px-2">Retorno</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sectorReturns.map((r) => (
                              <tr key={r.ticker} className="border-b border-border/40">
                                <td className="py-2 px-2">
                                  {r.sector} <span className="text-ink/40">({r.ticker})</span>
                                </td>
                                <td className="text-right py-2 px-2 text-ink/60">{r.startClose.toFixed(2)}</td>
                                <td className="text-right py-2 px-2 text-ink/60">{r.endClose.toFixed(2)}</td>
                                <td className={cn('text-right py-2 px-2 font-bold', r.returnPct >= 0 ? 'text-accent' : 'text-danger')}>
                                  {r.returnPct >= 0 ? '+' : ''}
                                  {r.returnPct.toFixed(1)}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {sectorReturns.length === 0 && (
                          <p className="text-[11px] font-mono text-ink/40 py-8 text-center">Sin datos en esta ventana.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, tone = 'accent' }: { label: string; value: string; tone?: 'accent' | 'good' | 'bad' }) {
  const toneClass = tone === 'good' ? 'text-emerald-500' : tone === 'bad' ? 'text-red-500' : 'text-accent';
  return (
    <div className="border border-border rounded p-3 text-center">
      <div className="text-[9px] font-mono uppercase tracking-widest text-ink/40">{label}</div>
      <div className={cn('text-lg font-bold mt-1', toneClass)}>{value}</div>
    </div>
  );
}
