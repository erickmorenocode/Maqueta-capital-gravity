'use client';

import * as d3 from 'd3';
import { useMemo } from 'react';
import type { EquityPoint, WindowKey } from '@/src/lib/densityLab/engine';

export interface EquitySegment {
  key: WindowKey;
  label: string;
  color: string;
  points: EquityPoint[];
  /** true si points[0] es un ancla sintetica (sin posicion abierta todavia) -- se dibuja mas tenue. */
  leadingFlat?: boolean;
  /** true si el ultimo punto es un ancla sintetica (ya sin posicion abierta) -- se dibuja mas tenue. */
  trailingFlat?: boolean;
}

interface Props {
  segments: EquitySegment[];
  benchmark: EquityPoint[];
  boundaries?: { date: string; label: string }[];
  /** Ventana activa -- resalta su tramo y atenua los demas. */
  selectedWindow?: WindowKey;
  /** Si se pasa, el grafico (zonas de fondo + leyenda) se vuelve clickeable para cambiar de ventana. */
  onSelectWindow?: (key: WindowKey) => void;
}

const WIDTH = 1000;
const HEIGHT = 340;
const MARGIN = { top: 16, right: 20, bottom: 26, left: 50 };

export default function EquityCurveChart({ segments, benchmark, boundaries = [], selectedWindow, onSelectWindow }: Props) {
  const chart = useMemo(() => {
    const allPoints = segments.flatMap((s) => s.points);
    if (allPoints.length < 2) return null;
    const innerW = WIDTH - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    const dates = [...allPoints, ...benchmark].map((p) => new Date(p.date));
    const xScale = d3.scaleTime().domain(d3.extent(dates) as [Date, Date]).range([0, innerW]);

    const values = [...allPoints, ...benchmark].map((p) => p.value);
    const [min, max] = d3.extent(values) as [number, number];
    const pad = (max - min) * 0.08 || 0.05;
    const yScale = d3.scaleLinear().domain([min - pad, max + pad]).range([innerH, 0]);

    const line = d3
      .line<EquityPoint>()
      .x((d) => xScale(new Date(d.date)))
      .y((d) => yScale(d.value))
      .curve(d3.curveMonotoneX);

    const [domainStart, domainEnd] = xScale.domain();
    const boundaryXs = boundaries
      .map((b) => new Date(b.date))
      .filter((d) => d >= domainStart && d <= domainEnd)
      .map((d) => xScale(d));

    // Cada segmento puede traer un tramo plano sintetico al inicio y/o al
    // final (sin posicion abierta -- ver combinedStrategySegments). Se
    // separan en su propio sub-path para dibujarlos mas tenues y que no se
    // confundan con los tramos donde la estrategia si tuvo trades.
    const segmentPaths = segments.map((s) => {
      const n = s.points.length;
      const mainStart = s.leadingFlat ? 1 : 0;
      const mainEnd = s.trailingFlat ? n - 1 : n;
      return {
        ...s,
        path: line(s.points.slice(mainStart, mainEnd)) ?? '',
        leadingFlatPath: s.leadingFlat ? line(s.points.slice(0, 2)) ?? '' : '',
        trailingFlatPath: s.trailingFlat ? line(s.points.slice(n - 2, n)) ?? '' : '',
      };
    });

    // Zonas clickeables de fondo, una por ventana -- se dividen en los
    // mismos cortes que las lineas de boundary para que el area clickeable
    // coincida visualmente con el tramo de color de la curva. Si algun
    // segmento no tiene datos (ventana vacia) los cortes no calzan 1:1 y se
    // cae a reparto por partes iguales como fallback.
    const zoneEdges =
      boundaryXs.length === segmentPaths.length - 1
        ? [0, ...boundaryXs, innerW]
        : segmentPaths.map((_, i) => (innerW / segmentPaths.length) * i).concat(innerW);

    return {
      innerW,
      innerH,
      xScale,
      yScale,
      segmentPaths,
      zones: segmentPaths.map((s, i) => ({ key: s.key, color: s.color, x: zoneEdges[i], width: zoneEdges[i + 1] - zoneEdges[i] })),
      benchmarkPath: benchmark.length >= 2 ? line(benchmark) ?? '' : '',
      xTicks: xScale.ticks(6),
      yTicks: yScale.ticks(5),
      boundaryLines: boundaryXs,
    };
  }, [segments, benchmark, boundaries]);

  if (!chart) {
    return <div className="text-[11px] font-mono text-ink/40 py-12 text-center">Sin suficientes rotaciones para graficar.</div>;
  }

  const { innerW, innerH, xScale, yScale, segmentPaths, zones, benchmarkPath, xTicks, yTicks, boundaryLines } = chart;

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-[340px]"
        role="img"
        aria-label="Curva de equity consolidada: estrategia vs benchmark. Click en una ventana para ver sus metricas."
      >
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

          {/* zonas clickeables por ventana -- tinta de fondo cuando esta seleccionada */}
          {onSelectWindow &&
            zones.map((z) => (
              <rect
                key={z.key}
                x={z.x}
                y={0}
                width={z.width}
                height={innerH}
                fill={z.color}
                opacity={selectedWindow === z.key ? 0.12 : 0}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectWindow(z.key)}
              />
            ))}

          {/* separadores de ventana (Backtest | Validacion | Live) */}
          {boundaryLines.map((x, i) => (
            <line
              key={i}
              x1={x}
              x2={x}
              y1={0}
              y2={innerH}
              stroke="currentColor"
              className="text-ink/40"
              strokeDasharray="4,3"
              strokeWidth={1}
              style={{ pointerEvents: 'none' }}
            />
          ))}

          {benchmarkPath && (
            <path d={benchmarkPath} fill="none" stroke="#64748b" strokeDasharray="4,3" strokeWidth={1.4} style={{ pointerEvents: 'none' }} />
          )}

          {segmentPaths.map((s) => {
            const dimmed = !selectedWindow || selectedWindow === s.key ? 1 : 0.5;
            return (
              <g key={s.key} style={{ pointerEvents: 'none' }}>
                {s.leadingFlatPath && <path d={s.leadingFlatPath} fill="none" stroke={s.color} strokeWidth={1.6} opacity={0.85 * dimmed} />}
                <path d={s.path} fill="none" stroke={s.color} strokeWidth={selectedWindow === s.key ? 2.6 : 1.8} opacity={dimmed} />
                {s.trailingFlatPath && <path d={s.trailingFlatPath} fill="none" stroke={s.color} strokeWidth={1.6} opacity={0.85 * dimmed} />}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="flex flex-wrap items-center gap-2 text-[9px] font-mono text-ink/60 mt-1">
        {segmentPaths.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onSelectWindow?.(s.key)}
            disabled={!onSelectWindow}
            className={`flex items-center gap-1.5 px-2 py-1 rounded border transition-all ${
              selectedWindow === s.key ? 'border-current bg-ink/5' : 'border-transparent'
            } ${onSelectWindow ? 'cursor-pointer hover:border-border' : ''}`}
            style={{ color: selectedWindow === s.key ? s.color : undefined }}
          >
            <span className="w-3 h-0.5 inline-block" style={{ background: s.color }} /> {s.label}
          </button>
        ))}
        {benchmarkPath && (
          <span className="flex items-center gap-1.5 px-2 py-1">
            <span className="w-3 h-0.5 bg-[#64748b] inline-block" style={{ borderTop: '1px dashed #64748b' }} /> Buy &amp; Hold SPY
          </span>
        )}
      </div>
      {onSelectWindow && (
        <p className="text-[9px] font-mono text-ink/35 mt-1">
          Click en un tramo de la curva (o su etiqueta) para ver rendimiento y ratios de esa ventana abajo.
        </p>
      )}
    </div>
  );
}
