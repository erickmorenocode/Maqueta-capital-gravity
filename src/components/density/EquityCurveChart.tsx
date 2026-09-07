'use client';

import * as d3 from 'd3';
import { useMemo } from 'react';
import type { EquityPoint } from '@/src/lib/densityLab/engine';

interface Props {
  strategy: EquityPoint[];
  benchmark: EquityPoint[];
}

const WIDTH = 1000;
const HEIGHT = 340;
const MARGIN = { top: 16, right: 20, bottom: 26, left: 50 };

export default function EquityCurveChart({ strategy, benchmark }: Props) {
  const chart = useMemo(() => {
    if (strategy.length < 2) return null;
    const innerW = WIDTH - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    const allPoints = [...strategy, ...benchmark];
    const dates = allPoints.map((p) => new Date(p.date));
    const xScale = d3.scaleTime().domain(d3.extent(dates) as [Date, Date]).range([0, innerW]);

    const values = allPoints.map((p) => p.value);
    const [min, max] = d3.extent(values) as [number, number];
    const pad = (max - min) * 0.08 || 0.05;
    const yScale = d3.scaleLinear().domain([min - pad, max + pad]).range([innerH, 0]);

    const line = d3
      .line<EquityPoint>()
      .x((d) => xScale(new Date(d.date)))
      .y((d) => yScale(d.value))
      .curve(d3.curveMonotoneX);

    return {
      innerW,
      innerH,
      xScale,
      yScale,
      strategyPath: line(strategy) ?? '',
      benchmarkPath: benchmark.length >= 2 ? line(benchmark) ?? '' : '',
      xTicks: xScale.ticks(6),
      yTicks: yScale.ticks(5),
    };
  }, [strategy, benchmark]);

  if (!chart) {
    return <div className="text-[11px] font-mono text-ink/40 py-12 text-center">Sin suficientes rotaciones para graficar.</div>;
  }

  const { innerW, innerH, xScale, yScale, strategyPath, benchmarkPath, xTicks, yTicks } = chart;

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-[340px]" role="img" aria-label="Curva de equity: estrategia vs benchmark">
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {yTicks.map((t) => (
            <g key={t} transform={`translate(0,${yScale(t)})`}>
              <line x1={0} x2={innerW} stroke="currentColor" className="text-border" strokeWidth={1} />
              <text x={-8} dy="0.32em" textAnchor="end" className="fill-ink/50 text-[9px] font-mono">
                {t.toFixed(2)}x
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text key={i} x={xScale(t)} y={innerH + 16} textAnchor="middle" className="fill-ink/40 text-[9px] font-mono">
              {d3.timeFormat('%b %y')(t)}
            </text>
          ))}
          {benchmarkPath && <path d={benchmarkPath} fill="none" stroke="#64748b" strokeDasharray="4,3" strokeWidth={1.4} />}
          <path d={strategyPath} fill="none" stroke="#f97316" strokeWidth={1.8} />
        </g>
      </svg>
      <div className="flex items-center gap-4 text-[9px] font-mono text-ink/60 mt-1">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-[#f97316] inline-block" /> Estrategia ICD
        </span>
        {benchmarkPath && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-[#64748b] inline-block" style={{ borderTop: '1px dashed #64748b' }} /> Buy &amp; Hold SPY
          </span>
        )}
      </div>
    </div>
  );
}
