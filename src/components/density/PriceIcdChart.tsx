'use client';

import * as d3 from 'd3';
import { useMemo } from 'react';
import type { DensityRow } from '@/src/lib/densityLab/engine';

interface Props {
  data: DensityRow[];
  ticker: string;
  zThreshold: number;
}

const WIDTH = 1000;
const HEIGHT = 420;
const MARGIN = { top: 16, right: 54, bottom: 26, left: 58 };

export default function PriceIcdChart({ data, ticker, zThreshold }: Props) {
  const chart = useMemo(() => {
    if (data.length === 0) return null;

    const innerW = WIDTH - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    const dates = data.map((d) => new Date(d.date));
    const xScale = d3.scaleTime().domain(d3.extent(dates) as [Date, Date]).range([0, innerW]);

    const priceExtent = d3.extent(data.flatMap((d) => [d.low, d.high])) as [number, number];
    const pricePad = (priceExtent[1] - priceExtent[0]) * 0.08 || 1;
    const priceScale = d3
      .scaleLinear()
      .domain([priceExtent[0] - pricePad, priceExtent[1] + pricePad])
      .range([innerH, 0]);

    const icdValues = data.map((d) => d.ICD).filter((v): v is number => v !== null);
    const icdBound = Math.max(zThreshold + 0.5, d3.max(icdValues.map(Math.abs)) ?? zThreshold + 0.5);
    const icdScale = d3.scaleLinear().domain([-icdBound, icdBound]).range([innerH, 0]);

    const candleWidth = Math.max(1, Math.min(6, (innerW / data.length) * 0.7));

    const icdLine = d3
      .line<DensityRow>()
      .defined((d) => d.ICD !== null)
      .x((d) => xScale(new Date(d.date)))
      .y((d) => icdScale(d.ICD as number))
      .curve(d3.curveMonotoneX);

    return {
      innerW,
      innerH,
      xScale,
      priceScale,
      icdScale,
      candleWidth,
      icdPath: icdLine(data) ?? '',
      xTicks: xScale.ticks(7),
      priceTicks: priceScale.ticks(5),
      icdTicks: icdScale.ticks(5),
    };
  }, [data, zThreshold]);

  if (!chart) {
    return <div className="text-[11px] font-mono text-ink/40 py-12 text-center">Sin datos para {ticker}.</div>;
  }

  const { innerW, innerH, xScale, priceScale, icdScale, candleWidth, icdPath, xTicks, priceTicks, icdTicks } = chart;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-[420px]" role="img" aria-label={`Precio y ICD de ${ticker}`}>
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        {/* grid + eje de precio (izquierda) */}
        {priceTicks.map((t) => (
          <g key={`p-${t}`} transform={`translate(0,${priceScale(t)})`}>
            <line x1={0} x2={innerW} stroke="currentColor" className="text-border" strokeWidth={1} />
            <text x={-8} dy="0.32em" textAnchor="end" className="fill-ink/50 text-[9px] font-mono">
              {t.toFixed(0)}
            </text>
          </g>
        ))}

        {/* eje ICD (derecha) */}
        {icdTicks.map((t) => (
          <text
            key={`icd-${t}`}
            x={innerW + 8}
            y={icdScale(t)}
            dy="0.32em"
            className="fill-accent/70 text-[9px] font-mono"
          >
            {t.toFixed(1)}
          </text>
        ))}

        {/* eje de fechas */}
        {xTicks.map((t, i) => (
          <text key={i} x={xScale(t)} y={innerH + 16} textAnchor="middle" className="fill-ink/40 text-[9px] font-mono">
            {d3.timeFormat('%b %y')(t)}
          </text>
        ))}

        {/* umbrales de anomalia ICD */}
        <line
          x1={0}
          x2={innerW}
          y1={icdScale(zThreshold)}
          y2={icdScale(zThreshold)}
          stroke="var(--color-accent)"
          strokeDasharray="3,3"
          strokeWidth={1}
          opacity={0.5}
        />
        <line
          x1={0}
          x2={innerW}
          y1={icdScale(-zThreshold)}
          y2={icdScale(-zThreshold)}
          stroke="var(--color-danger)"
          strokeDasharray="3,3"
          strokeWidth={1}
          opacity={0.5}
        />

        {/* velas */}
        {data.map((d, i) => {
          const x = xScale(new Date(d.date));
          const up = d.close >= d.open;
          return (
            <g key={d.date}>
              <line
                x1={x}
                x2={x}
                y1={priceScale(d.high)}
                y2={priceScale(d.low)}
                stroke={up ? 'var(--color-accent)' : 'var(--color-danger)'}
                strokeWidth={1}
              />
              <rect
                x={x - candleWidth / 2}
                y={priceScale(Math.max(d.open, d.close))}
                width={candleWidth}
                height={Math.max(0.6, Math.abs(priceScale(d.open) - priceScale(d.close)))}
                fill={up ? 'var(--color-accent)' : 'var(--color-danger)'}
                opacity={0.9}
              />
            </g>
          );
        })}

        {/* linea ICD */}
        <path d={icdPath} fill="none" stroke="#f97316" strokeWidth={1.4} />
      </g>
    </svg>
  );
}
