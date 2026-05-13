import React, { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { GeoPoint, CapitalFlow, MarketScenario } from '../data';

interface WorldMapProps {
  scenario: MarketScenario;
  geoPoints: GeoPoint[];
  onPointClick: (point: GeoPoint) => void;
}

export const WorldMap: React.FC<WorldMapProps> = ({ scenario, geoPoints, onPointClick }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    svg.selectAll("*").remove();

    const projection = d3.geoMercator()
      .scale(width / 6.5)
      .translate([width / 2, height / 1.5]);

    const path = d3.geoPath().projection(projection);

    const g = svg.append("g");

    // Load world map data
    d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json").then((data: any) => {
      const countries = topojson.feature(data, data.objects.countries) as any;

      // Draw countries
      g.selectAll("path")
        .data(countries.features)
        .enter()
        .append("path")
        .attr("d", path)
        .attr("fill", "#1a1a1a")
        .attr("stroke", "#333")
        .attr("stroke-width", 0.5);

      // Draw points
      const pointsGroup = g.append("g").attr("class", "points");
      
      geoPoints.forEach(point => {
        const [x, y] = projection(point.coordinates) || [0, 0];
        const metrics = scenario.metrics?.[point.id];
        const force = metrics ? (metrics.masa - metrics.distancia) / Math.max(1, metrics.friccion) : 0;
        const isGravityCenter = force > 8.0;

        const pointNode = pointsGroup.append("g")
          .attr("transform", `translate(${x}, ${y})`)
          .attr("class", "cursor-pointer group")
          .on("click", (event) => {
            event.stopPropagation();
            onPointClick(point);
          });

        // Gravity pulse
        if (isGravityCenter) {
          pointNode.append("circle")
            .attr("r", 10)
            .attr("fill", "none")
            .attr("stroke", "#00ff88")
            .attr("stroke-width", 2)
            .attr("opacity", 0.6)
            .append("animate")
            .attr("attributeName", "r")
            .attr("from", "5")
            .attr("to", "25")
            .attr("dur", "2s")
            .attr("repeatCount", "indefinite");

          pointNode.append("circle")
            .attr("r", 10)
            .attr("fill", "none")
            .attr("stroke", "#00ff88")
            .attr("stroke-width", 1)
            .attr("opacity", 0.6)
            .append("animate")
            .attr("attributeName", "opacity")
            .attr("from", "0.6")
            .attr("to", "0")
            .attr("dur", "2s")
            .attr("repeatCount", "indefinite");
        }

        pointNode.append("circle")
          .attr("r", isGravityCenter ? 6 : 4)
          .attr("fill", isGravityCenter ? "#00ff88" : "#666")
          .attr("class", "transition-all duration-1000 group-hover:fill-white group-hover:scale-125");

        pointNode.append("text")
          .text(point.name.toUpperCase())
          .attr("y", 15)
          .attr("text-anchor", "middle")
          .attr("fill", isGravityCenter ? "#00ff88" : "#fff")
          .attr("font-size", "8px")
          .attr("font-weight", "bold")
          .attr("font-family", "monospace")
          .attr("pointer-events", "none")
          .attr("class", isGravityCenter ? "opacity-100" : "opacity-40 group-hover:opacity-100");
      });

      // Draw flows
      const flowsGroup = g.append("g").attr("class", "flows");
      
      scenario.flows.forEach(flow => {
        const fromPoint = geoPoints.find(p => p.id === flow.from);
        const toPoint = geoPoints.find(p => p.id === flow.to);

        if (fromPoint && toPoint) {
          const [x1, y1] = projection(fromPoint.coordinates) || [0, 0];
          const [x2, y2] = projection(toPoint.coordinates) || [0, 0];

          // Create curved path
          const dx = x2 - x1;
          const dy = y2 - y1;
          const dr = Math.sqrt(dx * dx + dy * dy) * 1.5;

          const pathData = `M${x1},${y1}A${dr},${dr} 0 0,1 ${x2},${y2}`;

          flowsGroup.append("path")
            .attr("d", pathData)
            .attr("fill", "none")
            .attr("stroke", "#00ff88")
            .attr("stroke-width", flow.strength * 3)
            .attr("stroke-dasharray", "5,5")
            .attr("opacity", 0.4)
            .attr("class", "animate-flow");
        }
      });
    });

    // Zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([1, 8])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom as any);

  }, [scenario, geoPoints, onPointClick]);

  return (
    <div className="w-full h-full relative overflow-hidden bg-black/20 rounded-xl border border-white/5">
      <svg
        ref={svgRef}
        className="w-full h-full"
        viewBox={`0 0 1000 600`}
        preserveAspectRatio="xMidYMid meet"
      />
      <div className="absolute bottom-4 left-4 flex flex-col gap-1 pointer-events-none">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-accent animate-pulse" />
          <span className="text-[10px] font-mono text-accent uppercase tracking-widest">Centros de Gravedad Activos</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-white/20" />
          <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Mercados Secundarios</span>
        </div>
      </div>
    </div>
  );
};
