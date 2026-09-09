'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Compass, Sun, Moon, RefreshCw, AlertTriangle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import {
  SECTOR_ETFS,
  SECTOR_NAMES,
  BENCHMARK,
  DEFAULT_FREE_FLOAT_RATIO,
  WINDOWS,
  computeAllSectorsDensity,
  sliceWindow,
  buildRotationMatrix,
  latestRanking,
  lagCorrelationMatrix,
  eventStudy,
  simulateIcdRotationStrategy,
  simulateIcdExitStrategy,
  computeStrategyStats,
  buyAndHoldCurve,
  sectorBuyAndHoldReturns,
  type WindowKey,
  type PriceBar,
  type SizeAnchor,
  type TickerStaticInfo,
  type DensityRow,
} from '@/src/lib/densityLab/engine';
import PriceIcdChart from '@/src/components/density/PriceIcdChart';
import Heatmap from '@/src/components/density/Heatmap';
import EquityCurveChart from '@/src/components/density/EquityCurveChart';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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
  { key: 'grafico', label: 'Grafico Principal' },
  { key: 'mapa', label: 'Mapa de Rotacion' },
  { key: 'ranking', label: 'Ranking de Sectores' },
  { key: 'backtest', label: 'Backtesting Cuantitativo' },
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

  const [windowKey, setWindowKey] = useState<WindowKey>('backtest');
  const [rollingWindow, setRollingWindow] = useState(44);
  const [zThreshold, setZThreshold] = useState(2.0);
  const [freeFloatRatio, setFreeFloatRatio] = useState(DEFAULT_FREE_FLOAT_RATIO);
  const [heatmapDays, setHeatmapDays] = useState(30);
  const [lookbackDays, setLookbackDays] = useState(9);
  const [holdDays, setHoldDays] = useState(5);
  const [strategyMethod, setStrategyMethod] = useState<'fixed' | 'icdExit'>('icdExit');
  const [selectedTicker, setSelectedTicker] = useState<string>('XLK');
  const [activeTab, setActiveTab] = useState<TabKey>('grafico');

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
  const strategyCurve = strategyMethod === 'fixed' ? fixedHoldCurve : icdExitCurve;
  const strategyStats = useMemo(() => computeStrategyStats(strategyCurve), [strategyCurve]);
  const benchmarkCurve = useMemo(() => {
    if (!data || strategyCurve.length === 0) return [];
    const spyBars = data.priceBars[BENCHMARK];
    if (!spyBars) return [];
    const spyWindow = spyBars.filter((b) => b.date >= activeWindow.start && (activeWindow.end === null || b.date <= activeWindow.end));
    return buyAndHoldCurve(spyWindow, strategyCurve.map((p) => p.date));
  }, [data, strategyCurve, activeWindow]);

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
          <section className="glass rounded-lg p-4 space-y-3">
            <h2 className="text-[10px] font-mono uppercase tracking-widest text-ink/50">Ventana temporal</h2>
            <div className="space-y-1.5">
              {(Object.keys(WINDOWS) as WindowKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setWindowKey(key)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded text-[11px] font-mono border transition-all',
                    windowKey === key ? 'bg-accent/15 border-accent/40 text-accent' : 'border-border text-ink/60 hover:border-accent/20'
                  )}
                >
                  {WINDOWS[key].label}
                </button>
              ))}
            </div>
          </section>

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
              disabled={strategyMethod === 'icdExit'}
            />
            {strategyMethod === 'icdExit' && (
              <p className="text-[9px] font-mono text-ink/40">M2 no usa dias de tenencia -- sale por señal (ICD &lt; 0), no por plazo.</p>
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
              Descargando historial 2018-presente de 11 ETFs sectoriales + SPY desde Yahoo Finance...
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
                        Correlacion rezagada: ICD (t) vs retorno futuro
                      </h3>
                      <Heatmap
                        rowLabels={corrMatrix.sectors}
                        colLabels={corrMatrix.lags.map((l) => `${l}d`)}
                        values={corrMatrix.values}
                        scaleType="diverging"
                        legendLabel="Correlacion (r)"
                      />
                      <p className="text-[9px] font-mono text-ink/40 mt-2">
                        r &gt; 0: picos de ICD tienden a preceder subidas de precio. r &lt; 0: tienden a preceder bajadas.
                      </p>
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

                    <div>
                      <h3 className="text-[11px] font-mono uppercase tracking-widest text-ink/60 mb-3">
                        Estrategia: comprar mayor delta ICD ({lookbackDays}d) —{' '}
                        {strategyMethod === 'fixed' ? `M1: mantener ${holdDays}d` : 'M2: sale si ICD < 0'}
                      </h3>
                      <EquityCurveChart strategy={strategyCurve} benchmark={benchmarkCurve} />
                      {strategyCurve.length >= 2 && (
                        <div className="grid grid-cols-3 gap-4 mt-4">
                          <StatCard label="Retorno estrategia" value={`${((strategyCurve[strategyCurve.length - 1].value / strategyCurve[0].value - 1) * 100).toFixed(1)}%`} />
                          {benchmarkCurve.length >= 2 && (
                            <>
                              <StatCard label="Retorno Buy & Hold SPY" value={`${((benchmarkCurve[benchmarkCurve.length - 1].value / benchmarkCurve[0].value - 1) * 100).toFixed(1)}%`} />
                              <StatCard
                                label="Alpha simple"
                                value={`${(
                                  ((strategyCurve[strategyCurve.length - 1].value / strategyCurve[0].value - 1) -
                                    (benchmarkCurve[benchmarkCurve.length - 1].value / benchmarkCurve[0].value - 1)) *
                                  100
                                ).toFixed(1)} pp`}
                              />
                            </>
                          )}
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
                        </div>
                      )}
                      {strategyCurve.length >= 2 && (
                        <p className="text-[9px] font-mono text-ink/40 mt-2">
                          {strategyStats.trades} trades ({strategyStats.wins} ganadores / {strategyStats.losses} perdedores). Sharpe con Rf=0,
                          anualizado por dias reales entre trades. Profit factor = ganancia bruta / |perdida bruta|. Riesgo:Beneficio = perdida
                          promedio : ganancia promedio por trade.
                        </p>
                      )}
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded p-3 text-center">
      <div className="text-[9px] font-mono uppercase tracking-widest text-ink/40">{label}</div>
      <div className="text-lg font-bold text-accent mt-1">{value}</div>
    </div>
  );
}
