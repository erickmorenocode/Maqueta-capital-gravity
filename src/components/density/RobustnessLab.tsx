'use client';

import * as d3 from 'd3';
import { useMemo, useState } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import type { DensityRow, EquityPoint, PriceBar } from '@/src/lib/densityLab/engine';
import {
  ROBUSTNESS_START,
  ROBUSTNESS_END,
  ROBUSTNESS_YEARS,
  COMMISSION_LEVELS,
  CAPITAL_LEVELS,
  buildSplits,
  evaluatePeriod,
  evaluateSplits,
  evaluateYearOmission,
  netMetricsFor,
  breakEvenCommission,
  type CostConfig,
  type PeriodMetrics,
  type RunStrategyFn,
  type SplitScheme,
} from '@/src/lib/densityLab/robustness';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type SubTab = 'windows' | 'years' | 'costs';

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'windows', label: 'Ventanas IS / OOS alternativas' },
  { key: 'years', label: 'Omitir mejores / peores años' },
  { key: 'costs', label: 'Costos de transaccion' },
];

const SCHEMES: { key: SplitScheme; label: string; desc: string }[] = [
  { key: 'rolling', label: 'Walk-forward rodante', desc: 'IS de 3 años que avanza 1 año; OOS = el año siguiente (2021-2025).' },
  { key: 'anchored', label: 'Walk-forward anclado', desc: 'IS arranca siempre en 2018 y se expande; OOS = el año siguiente (2020-2025).' },
  { key: 'inverse', label: 'Inverso (OOS en el pasado)', desc: 'IS en datos recientes, OOS en años anteriores: prueba otro regimen de mercado.' },
  { key: 'custom', label: 'Personalizado', desc: 'Elegir años de IS y OOS a mano (2018-2025).' },
];

interface Props {
  sectorMetricsFull: Record<string, DensityRow[]>;
  spyBars: PriceBar[];
  /** Corre la metodologia activa de la barra lateral con un lookback dado. */
  runStrategy: RunStrategyFn;
  lookbackDays: number;
  methodLabel: string;
}

const fmtPct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
const fmtNum = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? '—' : v === Infinity ? '∞' : Number.isFinite(v) ? v.toFixed(digits) : '—';
const fmtUsd = (v: number) => `$${v.toLocaleString('es-ES', { maximumFractionDigits: 0 })}`;
const tone = (v: number | null | undefined) => (v === null || v === undefined ? '' : v >= 0 ? 'text-accent' : 'text-danger');

export default function RobustnessLab({ sectorMetricsFull, spyBars, runStrategy, lookbackDays, methodLabel }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('windows');
  const [capital, setCapital] = useState(10000);
  const [commission, setCommission] = useState(1);
  const [slippageBps, setSlippageBps] = useState(0);

  const [scheme, setScheme] = useState<SplitScheme>('rolling');
  const [optimizeLookback, setOptimizeLookback] = useState(false);
  const [custom, setCustom] = useState({ isFrom: 2018, isTo: 2021, oosFrom: 2022, oosTo: 2025 });

  const [omitN, setOmitN] = useState(1);
  const [rankBy, setRankBy] = useState<'strategy' | 'spy'>('strategy');

  const costs: CostConfig = useMemo(() => ({ capital, commission, slippageBps }), [capital, commission, slippageBps]);

  // Corrida unica 2018-2025 (sin Live) -- base de las pruebas de años y costos.
  const full = useMemo(
    () => evaluatePeriod(sectorMetricsFull, spyBars, runStrategy, lookbackDays, ROBUSTNESS_START, ROBUSTNESS_END, costs),
    [sectorMetricsFull, spyBars, runStrategy, lookbackDays, costs]
  );

  const customInvalid = custom.isTo < custom.isFrom || custom.oosTo < custom.oosFrom;
  const customOverlap = !customInvalid && custom.isFrom <= custom.oosTo && custom.oosFrom <= custom.isTo;

  const splitResults = useMemo(() => {
    if (subTab !== 'windows') return [];
    if (scheme === 'custom' && customInvalid) return [];
    const splits = buildSplits(scheme, custom);
    return evaluateSplits(splits, sectorMetricsFull, spyBars, runStrategy, lookbackDays, costs, optimizeLookback);
  }, [subTab, scheme, custom, customInvalid, sectorMetricsFull, spyBars, runStrategy, lookbackDays, costs, optimizeLookback]);

  const splitSummary = useMemo(() => {
    const valid = splitResults.filter((r) => r.oos.net && r.oos.spy);
    if (valid.length === 0) return null;
    const oosCagrs = valid.map((r) => r.oos.net!.cagrPct);
    const beatsSpy = valid.filter((r) => r.oos.net!.totalReturnPct > r.oos.spy!.totalReturnPct).length;
    const positive = valid.filter((r) => r.oos.net!.totalReturnPct > 0).length;
    const retentions = valid.map((r) => r.calmarRetention).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const medianRetention = retentions.length > 0 ? retentions[Math.floor(retentions.length / 2)] : null;
    return {
      n: valid.length,
      avgOosCagr: oosCagrs.reduce((a, b) => a + b, 0) / oosCagrs.length,
      worstOosCagr: Math.min(...oosCagrs),
      beatsSpy,
      positive,
      medianRetention,
    };
  }, [splitResults]);

  const yearsResult = useMemo(() => evaluateYearOmission(full, omitN, rankBy), [full, omitN, rankBy]);

  const costSweep = useMemo(() => {
    if (subTab !== 'costs') return null;
    const byCommission = COMMISSION_LEVELS.map((c) => ({ commission: c, m: netMetricsFor(full, { capital, commission: c, slippageBps }) }));
    const matrix = COMMISSION_LEVELS.map((c) =>
      CAPITAL_LEVELS.map((cap) => netMetricsFor(full, { capital: cap, commission: c, slippageBps })?.cagrPct ?? null)
    );
    const breakEven = breakEvenCommission(full, capital, slippageBps);
    return { byCommission, matrix, breakEven };
  }, [subTab, full, capital, slippageBps]);

  return (
    <div className="space-y-6">
      <div className="text-[9px] font-mono text-ink/45 leading-relaxed">
        Laboratorio de pruebas aparte: NO modifica las ventanas Backtest/Validacion/Live ni ningun resultado de las otras pestanas. Usa la
        metodologia activa de la barra lateral (<b className="text-ink/70">{methodLabel}</b>, lookback {lookbackDays}d) sobre datos{' '}
        {ROBUSTNESS_START} a {ROBUSTNESS_END} (excluye la ventana Live / año en curso). Metricas sobre grilla diaria de trading de SPY
        (dias sin posicion = retorno 0, Sharpe anualizado con 252).
      </div>

      {/* Costos globales -- aplican a TODAS las pruebas */}
      <section className="border border-border rounded-lg p-4 space-y-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-ink/50">Costos de transaccion (aplican a todas las pruebas)</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <RangeInput label="Comision por transaccion" value={commission} min={0} max={2} step={0.25} onChange={setCommission} display={`$${commission.toFixed(2)}`} />
          <RangeInput label="Slippage por transaccion" value={slippageBps} min={0} max={20} step={1} onChange={setSlippageBps} display={`${slippageBps} bps`} />
          <div className="space-y-1.5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink/60">Capital inicial</div>
            <select
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value))}
              className="w-full bg-surface border border-border rounded px-3 py-1.5 text-[11px] font-mono text-ink"
            >
              {CAPITAL_LEVELS.map((c) => (
                <option key={c} value={c}>
                  {fmtUsd(c)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[9px] font-mono text-ink/40">
          Cada trade cobra 2 transacciones (compra + venta, incluida la liquidacion forzada al cierre de cada periodo). La comision es fija en
          USD, asi que pesa mas cuanto mas chica es la cuenta. Todas las tablas muestran resultado bruto (sin costos) y neto.
        </p>
        {full.net && full.net.totalReturnPct <= -99.9 && (
          <p className="text-[10px] font-mono text-danger">
            Con {fmtUsd(capital)} y ${commission.toFixed(2)}/tx la cuenta queda en cero {ROBUSTNESS_START.slice(0, 4)}-{ROBUSTNESS_END.slice(0, 4)}:
            las comisiones ({full.net.transactions} transacciones) se comen todo el capital. Los años posteriores a la ruina cuentan como 0%.
          </p>
        )}
      </section>

      <div className="flex gap-1 border-b border-border">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={cn(
              'px-3 py-2 text-[10px] font-mono uppercase tracking-widest border-b-2 transition-all -mb-px',
              subTab === t.key ? 'border-accent text-accent' : 'border-transparent text-ink/50 hover:text-ink/80'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'windows' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {SCHEMES.map((s) => (
              <button
                key={s.key}
                onClick={() => setScheme(s.key)}
                className={cn(
                  'text-left px-3 py-2 rounded border transition-all',
                  scheme === s.key ? 'bg-accent/15 border-accent/40 text-accent' : 'border-border text-ink/60 hover:border-accent/20'
                )}
              >
                <div className="text-[11px] font-mono">{s.label}</div>
                <div className="text-[9px] font-mono text-ink/40 mt-0.5">{s.desc}</div>
              </button>
            ))}
          </div>

          {scheme === 'custom' && (
            <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-ink/60">
              <span>IS</span>
              <YearSelect value={custom.isFrom} onChange={(v) => setCustom((c) => ({ ...c, isFrom: v }))} />
              <span>a</span>
              <YearSelect value={custom.isTo} onChange={(v) => setCustom((c) => ({ ...c, isTo: v }))} />
              <span className="ml-4">OOS</span>
              <YearSelect value={custom.oosFrom} onChange={(v) => setCustom((c) => ({ ...c, oosFrom: v }))} />
              <span>a</span>
              <YearSelect value={custom.oosTo} onChange={(v) => setCustom((c) => ({ ...c, oosTo: v }))} />
              {customInvalid && <span className="text-danger">Rango invalido (fin antes que inicio).</span>}
              {customOverlap && <span className="text-amber-500">IS y OOS se superponen: el OOS no es independiente.</span>}
            </div>
          )}

          <label className="flex items-center gap-2 text-[10px] font-mono text-ink/60 cursor-pointer w-fit">
            <input type="checkbox" checked={optimizeLookback} onChange={(e) => setOptimizeLookback(e.target.checked)} className="accent-[var(--color-accent)]" />
            Optimizar lookback en IS (1-10d, max Calmar neto) y aplicarlo sin cambios en OOS -- walk-forward real
          </label>
          <p className="text-[9px] font-mono text-ink/40 -mt-2">
            Sin optimizar, IS y OOS usan el mismo lookback de la barra lateral ({lookbackDays}d): el IS sirve de referencia y la prueba mide si el
            desempeño se sostiene en otro periodo. Optimizando, cada split elige su propio lookback solo con datos del IS.
          </p>

          {splitSummary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Card label="CAGR neto OOS promedio" value={fmtPct(splitSummary.avgOosCagr)} toneValue={splitSummary.avgOosCagr} />
              <Card label="Peor CAGR neto OOS" value={fmtPct(splitSummary.worstOosCagr)} toneValue={splitSummary.worstOosCagr} />
              <Card label="OOS neto > SPY" value={`${splitSummary.beatsSpy} / ${splitSummary.n}`} />
              <Card label="OOS neto positivo" value={`${splitSummary.positive} / ${splitSummary.n}`} />
              <Card
                label="Retencion Calmar (mediana OOS/IS)"
                value={splitSummary.medianRetention === null ? '—' : `${(splitSummary.medianRetention * 100).toFixed(0)}%`}
                toneValue={splitSummary.medianRetention === null ? null : splitSummary.medianRetention - 0.8}
              />
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-[10px] font-mono">
              <thead>
                <tr className="text-ink/50 border-b border-border">
                  <th className="text-left py-2 px-2">Split</th>
                  <th className="text-right py-2 px-2">Lookback</th>
                  <th className="text-right py-2 px-2">IS bruto</th>
                  <th className="text-right py-2 px-2">IS neto</th>
                  <th className="text-right py-2 px-2">IS Calmar</th>
                  <th className="text-right py-2 px-2">OOS bruto</th>
                  <th className="text-right py-2 px-2">OOS neto</th>
                  <th className="text-right py-2 px-2">OOS SPY</th>
                  <th className="text-right py-2 px-2">OOS Sharpe</th>
                  <th className="text-right py-2 px-2">OOS MaxDD</th>
                  <th className="text-right py-2 px-2">OOS Calmar</th>
                  <th className="text-right py-2 px-2">Trades OOS</th>
                  <th className="text-right py-2 px-2">Costo OOS</th>
                  <th className="text-right py-2 px-2">Retencion</th>
                </tr>
              </thead>
              <tbody>
                {splitResults.map((r) => (
                  <tr key={r.split.label} className="border-b border-border/40">
                    <td className="py-2 px-2 whitespace-nowrap">{r.split.label}</td>
                    <td className="text-right py-2 px-2">{r.lookbackUsed}d</td>
                    <td className="text-right py-2 px-2 text-ink/50">{fmtPct(r.is.gross?.totalReturnPct)}</td>
                    <td className={cn('text-right py-2 px-2', tone(r.is.net?.totalReturnPct))}>{fmtPct(r.is.net?.totalReturnPct)}</td>
                    <td className="text-right py-2 px-2">{fmtNum(r.is.net?.calmar)}</td>
                    <td className="text-right py-2 px-2 text-ink/50">{fmtPct(r.oos.gross?.totalReturnPct)}</td>
                    <td className={cn('text-right py-2 px-2 font-bold', tone(r.oos.net?.totalReturnPct))}>{fmtPct(r.oos.net?.totalReturnPct)}</td>
                    <td className="text-right py-2 px-2 text-ink/60">{fmtPct(r.oos.spy?.totalReturnPct)}</td>
                    <td className="text-right py-2 px-2">{fmtNum(r.oos.net?.sharpe)}</td>
                    <td className="text-right py-2 px-2">{r.oos.net ? `-${r.oos.net.maxDrawdownPct.toFixed(1)}%` : '—'}</td>
                    <td className="text-right py-2 px-2">{fmtNum(r.oos.net?.calmar)}</td>
                    <td className="text-right py-2 px-2">{r.oos.net?.trades ?? '—'}</td>
                    <td className="text-right py-2 px-2 text-ink/60">{r.oos.net ? fmtUsd(r.oos.net.totalCostUsd) : '—'}</td>
                    <td className={cn('text-right py-2 px-2', r.calmarRetention === null ? '' : r.calmarRetention >= 0.8 ? 'text-emerald-500' : 'text-red-500')}>
                      {r.calmarRetention === null ? '—' : `${(r.calmarRetention * 100).toFixed(0)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {splitResults.length === 0 && <p className="text-[11px] font-mono text-ink/40 py-8 text-center">Sin splits validos.</p>}
          </div>
          <p className="text-[9px] font-mono text-ink/40">
            Retornos = retorno total del periodo. Cada periodo se simula SOLO con sus propios datos (la estrategia arranca de cero al inicio,
            igual que las ventanas originales). Retencion = Calmar neto OOS / Calmar neto IS; verde si &gt;= 80% (mismo umbral que la Robustez
            Calmar de la pestana principal). "—" cuando el Calmar IS es &lt;= 0 o infinito (no comparable).
          </p>
        </div>
      )}

      {subTab === 'years' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono text-ink/60">
            <div className="flex items-center gap-2">
              <span>Años a omitir (N):</span>
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => setOmitN(n)}
                  className={cn('px-2.5 py-1 rounded border', omitN === n ? 'bg-accent/15 border-accent/40 text-accent' : 'border-border hover:border-accent/20')}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span>Ranking de años por:</span>
              {([
                { key: 'strategy' as const, label: 'Retorno neto estrategia' },
                { key: 'spy' as const, label: 'Retorno SPY (mercado)' },
              ]).map((o) => (
                <button
                  key={o.key}
                  onClick={() => setRankBy(o.key)}
                  className={cn('px-2.5 py-1 rounded border', rankBy === o.key ? 'bg-accent/15 border-accent/40 text-accent' : 'border-border hover:border-accent/20')}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[10px] font-mono">
              <thead>
                <tr className="text-ink/50 border-b border-border">
                  <th className="text-left py-2 px-2">Escenario</th>
                  <th className="text-left py-2 px-2">Años omitidos</th>
                  <th className="text-right py-2 px-2">CAGR bruto</th>
                  <th className="text-right py-2 px-2">CAGR neto</th>
                  <th className="text-right py-2 px-2">CAGR SPY</th>
                  <th className="text-right py-2 px-2">Alpha neto</th>
                  <th className="text-right py-2 px-2">Sharpe neto</th>
                  <th className="text-right py-2 px-2">MaxDD neto</th>
                  <th className="text-right py-2 px-2">Calmar neto</th>
                  <th className="text-right py-2 px-2">Calmar SPY</th>
                </tr>
              </thead>
              <tbody>
                {yearsResult.scenarios.map((s) => {
                  const alpha = s.net && s.spy ? s.net.cagrPct - s.spy.cagrPct : null;
                  return (
                    <tr key={s.key} className={cn('border-b border-border/40', s.key === 'all' && 'text-ink/80')}>
                      <td className="py-2 px-2 whitespace-nowrap">{s.label}</td>
                      <td className="py-2 px-2 text-ink/50">{s.excluded.length > 0 ? s.excluded.join(', ') : '—'}</td>
                      <td className="text-right py-2 px-2 text-ink/50">{fmtPct(s.gross?.cagrPct)}</td>
                      <td className={cn('text-right py-2 px-2 font-bold', tone(s.net?.cagrPct))}>{fmtPct(s.net?.cagrPct)}</td>
                      <td className="text-right py-2 px-2 text-ink/60">{fmtPct(s.spy?.cagrPct)}</td>
                      <td className={cn('text-right py-2 px-2', tone(alpha))}>{alpha === null ? '—' : `${alpha >= 0 ? '+' : ''}${alpha.toFixed(1)} pp`}</td>
                      <td className="text-right py-2 px-2">{fmtNum(s.net?.sharpe)}</td>
                      <td className="text-right py-2 px-2">{s.net ? `-${s.net.maxDrawdownPct.toFixed(1)}%` : '—'}</td>
                      <td className="text-right py-2 px-2">{fmtNum(s.net?.calmar)}</td>
                      <td className="text-right py-2 px-2 text-ink/60">{fmtNum(s.spy?.calmar)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <div className="text-[9px] font-mono uppercase tracking-widest text-ink/40 mb-1.5">Retorno por año calendario</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="text-ink/50 border-b border-border">
                    <th className="text-left py-2 px-2">Año</th>
                    <th className="text-right py-2 px-2">Estrategia bruto</th>
                    <th className="text-right py-2 px-2">Estrategia neto</th>
                    <th className="text-right py-2 px-2">SPY</th>
                    <th className="text-right py-2 px-2">Diferencia neto - SPY</th>
                    <th className="text-left py-2 px-2">Marca</th>
                  </tr>
                </thead>
                <tbody>
                  {yearsResult.years.map((y) => {
                    const sc = yearsResult.scenarios;
                    const isBest = sc.find((s) => s.key === 'noBest')?.excluded.includes(y.year);
                    const isWorst = sc.find((s) => s.key === 'noWorst')?.excluded.includes(y.year);
                    return (
                      <tr key={y.year} className="border-b border-border/40">
                        <td className="py-2 px-2">{y.year}</td>
                        <td className="text-right py-2 px-2 text-ink/50">{fmtPct(y.grossPct)}</td>
                        <td className={cn('text-right py-2 px-2 font-bold', tone(y.netPct))}>{fmtPct(y.netPct)}</td>
                        <td className={cn('text-right py-2 px-2', tone(y.spyPct))}>{fmtPct(y.spyPct)}</td>
                        <td className={cn('text-right py-2 px-2', tone(y.netPct - y.spyPct))}>
                          {`${y.netPct - y.spyPct >= 0 ? '+' : ''}${(y.netPct - y.spyPct).toFixed(1)} pp`}
                        </td>
                        <td className="py-2 px-2">
                          {isBest && <span className="text-emerald-500">mejor</span>}
                          {isWorst && <span className="text-red-500">peor</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[9px] font-mono text-ink/40">
            Una sola simulacion continua {ROBUSTNESS_START} a {ROBUSTNESS_END} (no encadenada por ventanas). Los retornos diarios de los años
            que quedan se cosen uno tras otro y se recalculan CAGR (252 dias/año), Sharpe, MaxDD y Calmar. SPY se recorta con los MISMOS años
            omitidos, para comparar en igualdad de condiciones. N se limita para dejar siempre al menos 2 años en el escenario sin mejores ni
            peores. Si el alpha se sostiene sin los mejores años, el resultado no depende de unos pocos años excepcionales.
          </p>
        </div>
      )}

      {subTab === 'costs' && costSweep && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card label="CAGR bruto" value={fmtPct(full.gross?.cagrPct)} toneValue={full.gross?.cagrPct} />
            <Card label="CAGR neto" value={fmtPct(full.net?.cagrPct)} toneValue={full.net?.cagrPct} />
            <Card label="CAGR SPY" value={fmtPct(full.spy?.cagrPct)} />
            <Card label="Transacciones / costo total" value={full.net ? `${full.net.transactions} / ${fmtUsd(full.net.totalCostUsd)}` : '—'} />
            <Card
              label={`Comision break-even vs SPY (${fmtUsd(capital)})`}
              value={costSweep.breakEven === null ? 'No supera a SPY' : costSweep.breakEven === Infinity ? '> $100' : `$${costSweep.breakEven.toFixed(2)}`}
            />
          </div>

          <RobustnessChart
            series={[
              { label: 'Estrategia bruto (sin costos)', color: '#94a3b8', points: full.grossCurve, dashed: true },
              { label: `Estrategia neto ($${commission.toFixed(2)}/tx, ${slippageBps} bps, ${fmtUsd(capital)})`, color: '#10b981', points: full.netCurve },
              { label: 'Buy & Hold SPY', color: '#64748b', points: full.spyCurve, dashed: true, thin: true },
            ]}
          />

          <div>
            <div className="text-[9px] font-mono uppercase tracking-widest text-ink/40 mb-1.5">
              Degradacion por nivel de comision (capital {fmtUsd(capital)}, slippage {slippageBps} bps, {ROBUSTNESS_START.slice(0, 4)}-
              {ROBUSTNESS_END.slice(0, 4)})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="text-ink/50 border-b border-border">
                    <th className="text-left py-2 px-2">Comision / tx</th>
                    <th className="text-right py-2 px-2">Retorno total</th>
                    <th className="text-right py-2 px-2">CAGR</th>
                    <th className="text-right py-2 px-2">Sharpe</th>
                    <th className="text-right py-2 px-2">MaxDD</th>
                    <th className="text-right py-2 px-2">Calmar</th>
                    <th className="text-right py-2 px-2">Costo total</th>
                    <th className="text-right py-2 px-2">Perdida de CAGR vs bruto</th>
                  </tr>
                </thead>
                <tbody>
                  {costSweep.byCommission.map(({ commission: c, m }) => (
                    <tr key={c} className={cn('border-b border-border/40', c === commission && 'text-accent')}>
                      <td className="py-2 px-2">${c.toFixed(2)}</td>
                      <td className="text-right py-2 px-2">{fmtPct(m?.totalReturnPct)}</td>
                      <td className="text-right py-2 px-2 font-bold">{fmtPct(m?.cagrPct)}</td>
                      <td className="text-right py-2 px-2">{fmtNum(m?.sharpe)}</td>
                      <td className="text-right py-2 px-2">{m ? `-${m.maxDrawdownPct.toFixed(1)}%` : '—'}</td>
                      <td className="text-right py-2 px-2">{fmtNum(m?.calmar)}</td>
                      <td className="text-right py-2 px-2 text-ink/60">{m ? fmtUsd(m.totalCostUsd) : '—'}</td>
                      <td className="text-right py-2 px-2 text-danger">
                        {m && full.gross ? `${(m.cagrPct - full.gross.cagrPct).toFixed(2)} pp` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="text-[9px] font-mono uppercase tracking-widest text-ink/40 mb-1.5">
              CAGR neto: comision x capital inicial (SPY: {fmtPct(full.spy?.cagrPct)})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="text-ink/50 border-b border-border">
                    <th className="text-left py-2 px-2">Comision / tx</th>
                    {CAPITAL_LEVELS.map((cap) => (
                      <th key={cap} className="text-right py-2 px-2">
                        {fmtUsd(cap)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMMISSION_LEVELS.map((c, i) => (
                    <tr key={c} className="border-b border-border/40">
                      <td className="py-2 px-2">${c.toFixed(2)}</td>
                      {costSweep.matrix[i].map((v, j) => (
                        <td
                          key={j}
                          className={cn(
                            'text-right py-2 px-2',
                            v === null || full.spy === null ? '' : v > full.spy.cagrPct ? 'text-emerald-500' : 'text-red-500'
                          )}
                        >
                          {fmtPct(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[9px] font-mono text-ink/40">
            Simulacion continua {ROBUSTNESS_START} a {ROBUSTNESS_END}. Verde = CAGR neto supera a SPY buy&amp;hold (sin costos) en el mismo
            periodo. Break-even = comision por transaccion a la que el CAGR neto iguala al de SPY con el capital elegido. La comision fija en USD
            se descuenta del valor de la cuenta en cada compra y venta; el slippage se aplica como porcentaje del valor operado.
          </p>
        </div>
      )}
    </div>
  );
}

function RangeInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-ink/60">
        <span>{label}</span>
        <span className="text-accent">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
    </div>
  );
}

function YearSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="bg-surface border border-border rounded px-2 py-1 text-[10px] font-mono text-ink">
      {ROBUSTNESS_YEARS.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}

function Card({ label, value, toneValue }: { label: string; value: string; toneValue?: number | null }) {
  const toneClass = toneValue === undefined || toneValue === null ? 'text-accent' : toneValue >= 0 ? 'text-emerald-500' : 'text-red-500';
  return (
    <div className="border border-border rounded p-3 text-center">
      <div className="text-[9px] font-mono uppercase tracking-widest text-ink/40">{label}</div>
      <div className={cn('text-base font-bold mt-1', toneClass)}>{value}</div>
    </div>
  );
}

const CW = 1000;
const CH = 300;
const CM = { top: 14, right: 20, bottom: 26, left: 50 };

function RobustnessChart({ series }: { series: { label: string; color: string; points: EquityPoint[]; dashed?: boolean; thin?: boolean }[] }) {
  const chart = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (all.length < 2) return null;
    const innerW = CW - CM.left - CM.right;
    const innerH = CH - CM.top - CM.bottom;
    const x = d3.scaleTime().domain(d3.extent(all, (p) => new Date(p.date)) as [Date, Date]).range([0, innerW]);
    const [min, max] = d3.extent(all, (p) => p.value) as [number, number];
    const pad = (max - min) * 0.08 || 0.05;
    const y = d3.scaleLinear().domain([min - pad, max + pad]).range([innerH, 0]);
    const line = d3
      .line<EquityPoint>()
      .x((p) => x(new Date(p.date)))
      .y((p) => y(p.value));
    return { innerW, innerH, x, y, paths: series.map((s) => (s.points.length >= 2 ? line(s.points) ?? '' : '')) };
  }, [series]);

  if (!chart) return <div className="text-[11px] font-mono text-ink/40 py-12 text-center">Sin datos suficientes para graficar.</div>;
  const { innerW, innerH, x, y, paths } = chart;

  return (
    <div>
      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full h-[300px]" role="img" aria-label="Curva de equity bruta vs neta de costos vs SPY">
        <g transform={`translate(${CM.left},${CM.top})`}>
          {y.ticks(5).map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x1={0} x2={innerW} stroke="currentColor" className="text-border" strokeWidth={1} />
              <text x={-8} dy="0.32em" textAnchor="end" className="fill-ink/50 text-[9px] font-mono">
                {t.toFixed(2)}x
              </text>
            </g>
          ))}
          {x.ticks(6).map((t, i) => (
            <text key={i} x={x(t)} y={innerH + 16} textAnchor="middle" className="fill-ink/40 text-[9px] font-mono">
              {d3.timeFormat('%b %y')(t)}
            </text>
          ))}
          {series.map((s, i) =>
            paths[i] ? (
              <path
                key={s.label}
                d={paths[i]}
                fill="none"
                stroke={s.color}
                strokeWidth={s.thin ? 1.4 : 2}
                strokeDasharray={s.dashed ? '4,3' : undefined}
              />
            ) : null
          )}
        </g>
      </svg>
      <div className="flex flex-wrap items-center gap-3 text-[9px] font-mono text-ink/60 mt-1">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="w-3 inline-block" style={{ borderTop: `2px ${s.dashed ? 'dashed' : 'solid'} ${s.color}` }} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
