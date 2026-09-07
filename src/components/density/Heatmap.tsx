'use client';

import * as d3 from 'd3';
import { useMemo } from 'react';

interface Props {
  rowLabels: string[];
  colLabels: string[];
  values: (number | null)[][]; // [rowIndex][colIndex]
  /** 'sequential' = escala unidireccional (0..max), 'diverging' = centrada en 0 (-max..max) */
  scaleType: 'sequential' | 'diverging';
  cellFormat?: (v: number) => string;
  /** alto de cada fila en px, para no aplastar heatmaps con pocas filas */
  rowHeight?: number;
  /** que representa el color, mostrado junto a la leyenda de gradiente */
  legendLabel?: string;
}

export default function Heatmap({ rowLabels, colLabels, values, scaleType, cellFormat, rowHeight = 34, legendLabel }: Props) {
  const { color, legendStops } = useMemo(() => {
    const flat = values.flat().filter((v): v is number => v !== null);
    if (flat.length === 0) {
      return { color: () => 'var(--color-surface)', legendStops: [] as number[] };
    }
    if (scaleType === 'diverging') {
      const bound = Math.max(0.01, d3.max(flat.map(Math.abs)) ?? 0.01);
      const scale = d3.scaleSequential(d3.interpolateRdBu).domain([bound, -bound]);
      return { color: (v: number) => scale(v), legendStops: [-bound, -bound / 2, 0, bound / 2, bound] };
    }
    const [min, max] = d3.extent(flat) as [number, number];
    const scale = d3.scaleSequential(d3.interpolateInferno).domain([min, max]);
    return { color: (v: number) => scale(v), legendStops: [min, (min + max) / 2, max] };
  }, [values, scaleType]);

  if (rowLabels.length === 0 || colLabels.length === 0) {
    return <div className="text-[11px] font-mono text-ink/40 py-12 text-center">Sin datos suficientes.</div>;
  }

  const fmt = cellFormat ?? ((v: number) => v.toFixed(2));

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[9px] font-mono w-full">
        <thead>
          <tr>
            <th className="sticky left-0 bg-bg" />
            {colLabels.map((c) => (
              <th key={c} className="px-1 py-1 text-ink/50 font-normal whitespace-nowrap text-center">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowLabels.map((row, ri) => (
            <tr key={row}>
              <td className="sticky left-0 bg-bg pr-2 text-ink/70 whitespace-nowrap text-right">{row}</td>
              {colLabels.map((_, ci) => {
                const v = values[ri]?.[ci] ?? null;
                return (
                  <td key={ci} style={{ height: rowHeight, minWidth: 46, background: v === null ? 'var(--color-surface)' : color(v) }} className="text-center border border-border/40">
                    <span className={v !== null && Math.abs(v) > 0 ? 'text-white mix-blend-difference' : 'text-ink/30'}>
                      {v === null ? '—' : fmt(v)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {legendStops.length > 0 && (
        <div className="flex items-center gap-2 mt-3 text-[9px] font-mono text-ink/50">
          {legendLabel && <span className="text-ink/70">{legendLabel}:</span>}
          <span>{legendStops[0].toFixed(2)}</span>
          <div
            className="h-2 w-32 rounded"
            style={{
              background: `linear-gradient(to right, ${legendStops.map((v) => color(v)).join(',')})`,
            }}
          />
          <span>{legendStops[legendStops.length - 1].toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
