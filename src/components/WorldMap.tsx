'use client';
import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { GeoPoint, MarketScenario } from '../data';

interface WorldMapProps {
  scenario: MarketScenario;
  geoPoints: GeoPoint[];
  onPointClick: (point: GeoPoint) => void;
}

const ISO_NAMES: Record<string, string> = {
  '4': 'Afganistán', '8': 'Albania', '12': 'Argelia', '24': 'Angola',
  '32': 'Argentina', '36': 'Australia', '40': 'Austria', '50': 'Bangladesh',
  '56': 'Bélgica', '76': 'Brasil', '100': 'Bulgaria', '116': 'Camboya',
  '124': 'Canadá', '144': 'Sri Lanka', '152': 'Chile', '156': 'China',
  '170': 'Colombia', '180': 'Congo (RDC)', '203': 'Rep. Checa',
  '208': 'Dinamarca', '218': 'Ecuador', '818': 'Egipto', '231': 'Etiopía',
  '246': 'Finlandia', '250': 'Francia', '276': 'Alemania', '288': 'Ghana',
  '300': 'Grecia', '320': 'Guatemala', '340': 'Honduras', '356': 'India',
  '360': 'Indonesia', '364': 'Irán', '368': 'Irak', '372': 'Irlanda',
  '376': 'Israel', '380': 'Italia', '392': 'Japón', '398': 'Kazajistán',
  '400': 'Jordania', '404': 'Kenia', '410': 'Corea del Sur', '414': 'Kuwait',
  '484': 'México', '504': 'Marruecos', '528': 'Países Bajos',
  '554': 'Nueva Zelanda', '566': 'Nigeria', '578': 'Noruega',
  '586': 'Pakistán', '604': 'Perú', '608': 'Filipinas', '616': 'Polonia',
  '620': 'Portugal', '642': 'Rumanía', '643': 'Rusia', '682': 'Arabia Saudita',
  '710': 'Sudáfrica', '724': 'España', '752': 'Suecia', '756': 'Suiza',
  '764': 'Tailandia', '792': 'Turquía', '804': 'Ucrania', '784': 'EAU',
  '826': 'Reino Unido', '840': 'EE.UU.', '858': 'Uruguay',
  '862': 'Venezuela', '704': 'Vietnam', '716': 'Zimbabue',
};

const SECTORS = [
  { id: 'technology',         name: 'TECNOLOG.',  angle: -90  },
  { id: 'communication',      name: 'COMUNIC.',   angle: -57  },
  { id: 'cons_discretionary', name: 'C.DISCR.',   angle: -25  },
  { id: 'cons_staples',       name: 'C.BÁSICO',   angle: 8    },
  { id: 'energy',             name: 'ENERGÍA',    angle: 41   },
  { id: 'financial',          name: 'FINANCIERO', angle: 74   },
  { id: 'healthcare',         name: 'SALUD',      angle: 106  },
  { id: 'industrials',        name: 'INDUSTR.',   angle: 139  },
  { id: 'real_estate',        name: 'INMOB.',     angle: 172  },
  { id: 'basic_materials',    name: 'MATER.',     angle: 205  },
  { id: 'utilities',          name: 'UTILITIES',  angle: 237  },
];

interface SectorFlow { from: string; to: string; strength: number; }
interface SectorNode { id: string; masa: number; distancia: number; isGravityCenter: boolean; }

function getSectorData(scenarioId: string): { nodes: SectorNode[]; flows: SectorFlow[] } {
  const FRICCION = 10;

  const metricsMap: Record<string, Record<string, { masa: number; distancia: number }>> = {
    hawkish: {
      technology:         { masa: 25, distancia: 75 },
      communication:      { masa: 35, distancia: 60 },
      cons_discretionary: { masa: 30, distancia: 65 },
      cons_staples:       { masa: 62, distancia: 30 },
      energy:             { masa: 70, distancia: 35 },
      financial:          { masa: 88, distancia: 12 },
      healthcare:         { masa: 65, distancia: 28 },
      industrials:        { masa: 50, distancia: 48 },
      real_estate:        { masa: 15, distancia: 85 },
      basic_materials:    { masa: 55, distancia: 42 },
      utilities:          { masa: 48, distancia: 45 },
    },
    dovish: {
      technology:         { masa: 92, distancia: 14 },
      communication:      { masa: 78, distancia: 22 },
      cons_discretionary: { masa: 82, distancia: 22 },
      cons_staples:       { masa: 25, distancia: 32 },
      energy:             { masa: 68, distancia: 38 },
      financial:          { masa: 38, distancia: 48 },
      healthcare:         { masa: 58, distancia: 34 },
      industrials:        { masa: 80, distancia: 20 },
      real_estate:        { masa: 85, distancia: 18 },
      basic_materials:    { masa: 72, distancia: 28 },
      utilities:          { masa: 22, distancia: 38 },
    },
    crisis: {
      technology:         { masa: 12, distancia: 88 },
      communication:      { masa: 18, distancia: 78 },
      cons_discretionary: { masa:  8, distancia: 92 },
      cons_staples:       { masa: 90, distancia:  8 },
      energy:             { masa: 62, distancia: 52 },
      financial:          { masa: 22, distancia: 72 },
      healthcare:         { masa: 92, distancia:  8 },
      industrials:        { masa: 15, distancia: 80 },
      real_estate:        { masa: 10, distancia: 88 },
      basic_materials:    { masa: 48, distancia: 55 },
      utilities:          { masa: 82, distancia: 15 },
    },
    liquidity: {
      technology:         { masa: 96, distancia: 12 },
      communication:      { masa: 82, distancia: 20 },
      cons_discretionary: { masa: 84, distancia: 20 },
      cons_staples:       { masa: 20, distancia: 28 },
      energy:             { masa: 76, distancia: 28 },
      financial:          { masa: 62, distancia: 28 },
      healthcare:         { masa: 55, distancia: 32 },
      industrials:        { masa: 80, distancia: 20 },
      real_estate:        { masa: 86, distancia: 18 },
      basic_materials:    { masa: 72, distancia: 26 },
      utilities:          { masa: 15, distancia: 22 },
    },
  };

  const fallback: Record<string, { masa: number; distancia: number }> = {
    technology:         { masa: 60, distancia: 40 },
    communication:      { masa: 60, distancia: 40 },
    cons_discretionary: { masa: 60, distancia: 40 },
    cons_staples:       { masa: 60, distancia: 40 },
    energy:             { masa: 60, distancia: 40 },
    financial:          { masa: 60, distancia: 40 },
    healthcare:         { masa: 60, distancia: 40 },
    industrials:        { masa: 60, distancia: 40 },
    real_estate:        { masa: 60, distancia: 40 },
    basic_materials:    { masa: 60, distancia: 40 },
    utilities:          { masa: 60, distancia: 40 },
  };

  const metrics = metricsMap[scenarioId] ?? fallback;

  const nodes: SectorNode[] = SECTORS.map(s => {
    const m = metrics[s.id] ?? { masa: 50, distancia: 50 };
    const force = (m.masa - m.distancia) / FRICCION;
    return { id: s.id, masa: m.masa, distancia: m.distancia, isGravityCenter: force > 3.0 };
  });

  const flowsMap: Record<string, SectorFlow[]> = {
    hawkish: [
      { from: 'technology',         to: 'financial',  strength: 0.88 },
      { from: 'real_estate',        to: 'financial',  strength: 0.92 },
      { from: 'cons_discretionary', to: 'financial',  strength: 0.72 },
      { from: 'communication',      to: 'financial',  strength: 0.65 },
      { from: 'cons_discretionary', to: 'cons_staples', strength: 0.60 },
      { from: 'technology',         to: 'healthcare', strength: 0.55 },
    ],
    dovish: [
      { from: 'financial',     to: 'technology',         strength: 0.88 },
      { from: 'utilities',     to: 'real_estate',        strength: 0.76 },
      { from: 'cons_staples',  to: 'cons_discretionary', strength: 0.72 },
      { from: 'financial',     to: 'communication',      strength: 0.65 },
      { from: 'basic_materials', to: 'industrials',      strength: 0.60 },
    ],
    crisis: [
      { from: 'technology',         to: 'healthcare',   strength: 0.92 },
      { from: 'real_estate',        to: 'utilities',    strength: 0.88 },
      { from: 'cons_discretionary', to: 'cons_staples', strength: 0.92 },
      { from: 'financial',          to: 'healthcare',   strength: 0.76 },
      { from: 'communication',      to: 'cons_staples', strength: 0.70 },
      { from: 'industrials',        to: 'utilities',    strength: 0.65 },
    ],
    liquidity: [
      { from: 'utilities',       to: 'technology',         strength: 0.92 },
      { from: 'cons_staples',    to: 'real_estate',        strength: 0.82 },
      { from: 'financial',       to: 'technology',         strength: 0.76 },
      { from: 'financial',       to: 'communication',      strength: 0.70 },
      { from: 'basic_materials', to: 'industrials',        strength: 0.65 },
    ],
  };

  const flows = flowsMap[scenarioId] ?? [
    { from: 'technology',    to: 'financial',          strength: 0.50 },
    { from: 'cons_staples',  to: 'cons_discretionary', strength: 0.40 },
    { from: 'energy',        to: 'industrials',        strength: 0.40 },
  ];

  return { nodes, flows };
}

export const WorldMap: React.FC<WorldMapProps> = ({ scenario, geoPoints, onPointClick }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const pathRef = useRef<d3.GeoPath | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const svgSelRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const selectedFeatureRef = useRef<any>(null);

  const WIDTH = 1000;
  const HEIGHT = 600;

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const projection = d3.geoMercator()
      .scale(WIDTH / 6.5)
      .translate([WIDTH / 2, HEIGHT / 1.5]);

    const path = d3.geoPath().projection(projection);
    const g = svg.append('g');

    gRef.current = g;
    pathRef.current = path;
    svgSelRef.current = svg;

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 8])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    zoomBehaviorRef.current = zoom;
    svg.call(zoom);

    d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then((data: any) => {
      const countries = topojson.feature(data, data.objects.countries) as any;

      g.selectAll('path.country')
        .data(countries.features)
        .enter()
        .append('path')
        .attr('class', 'country')
        .attr('d', (d: any) => path(d) ?? '')
        .attr('fill', '#1a1a1a')
        .attr('stroke', '#333')
        .attr('stroke-width', 0.5)
        .style('cursor', 'pointer')
        .on('mouseenter', function (this: SVGPathElement, _event: any, d: any) {
          if (selectedFeatureRef.current?.id !== d.id) {
            d3.select(this).attr('fill', '#252525').attr('stroke', '#555');
          }
        })
        .on('mouseleave', function (this: SVGPathElement, _event: any, d: any) {
          if (selectedFeatureRef.current?.id !== d.id) {
            d3.select(this).attr('fill', '#1a1a1a').attr('stroke', '#333');
          }
        })
        .on('click', function (this: SVGPathElement, event: any, d: any) {
          event.stopPropagation();

          const name = ISO_NAMES[String(d.id)] ?? `País ${d.id}`;
          selectedFeatureRef.current = d;

          g.selectAll('path.country')
            .attr('fill', '#1a1a1a')
            .attr('stroke', '#333')
            .attr('stroke-width', 0.5);

          d3.select(this)
            .attr('fill', '#0d1b2e')
            .attr('stroke', '#2563eb')
            .attr('stroke-width', 1);

          setSelectedCountry(name);

          const [[x0, y0], [x1, y1]] = path.bounds(d);
          const bw = Math.max(x1 - x0, 1);
          const bh = Math.max(y1 - y0, 1);
          const scale = Math.min(8, 0.85 / Math.max(bw / WIDTH, bh / HEIGHT));

          (svg as any).transition().duration(750).call(
            (zoom as any).transform,
            d3.zoomIdentity
              .translate(WIDTH / 2, HEIGHT / 2)
              .scale(scale)
              .translate(-(x0 + x1) / 2, -(y0 + y1) / 2)
          );
        });

      const pointsGroup = g.append('g').attr('class', 'points');

      geoPoints.forEach(point => {
        const [x, y] = projection(point.coordinates) || [0, 0];
        const metrics = scenario.metrics?.[point.id];
        const force = metrics ? (metrics.masa - metrics.distancia) / Math.max(1, metrics.friccion) : 0;
        const isGravityCenter = force > 8.0;

        const pointNode = pointsGroup.append('g')
          .attr('transform', `translate(${x}, ${y})`)
          .style('cursor', 'pointer')
          .on('click', (event) => {
            event.stopPropagation();
            onPointClick(point);
          });

        if (isGravityCenter) {
          pointNode.append('circle')
            .attr('r', 10)
            .attr('fill', 'none')
            .attr('stroke', '#00ff88')
            .attr('stroke-width', 2)
            .attr('opacity', 0.6)
            .append('animate')
            .attr('attributeName', 'r')
            .attr('from', '5')
            .attr('to', '25')
            .attr('dur', '2s')
            .attr('repeatCount', 'indefinite');

          pointNode.append('circle')
            .attr('r', 10)
            .attr('fill', 'none')
            .attr('stroke', '#00ff88')
            .attr('stroke-width', 1)
            .attr('opacity', 0.6)
            .append('animate')
            .attr('attributeName', 'opacity')
            .attr('from', '0.6')
            .attr('to', '0')
            .attr('dur', '2s')
            .attr('repeatCount', 'indefinite');
        }

        pointNode.append('circle')
          .attr('r', isGravityCenter ? 6 : 4)
          .attr('fill', isGravityCenter ? '#00ff88' : '#666');

        pointNode.append('text')
          .text(point.name.toUpperCase())
          .attr('y', 15)
          .attr('text-anchor', 'middle')
          .attr('fill', isGravityCenter ? '#00ff88' : '#fff')
          .attr('font-size', '8px')
          .attr('font-weight', 'bold')
          .attr('font-family', 'monospace')
          .attr('pointer-events', 'none')
          .attr('opacity', isGravityCenter ? 1 : 0.4);
      });

      const flowsGroup = g.append('g').attr('class', 'flows');

      scenario.flows.forEach(flow => {
        const fromPoint = geoPoints.find(p => p.id === flow.from);
        const toPoint = geoPoints.find(p => p.id === flow.to);

        if (fromPoint && toPoint) {
          const [x1, y1] = projection(fromPoint.coordinates) || [0, 0];
          const [x2, y2] = projection(toPoint.coordinates) || [0, 0];
          const dx = x2 - x1;
          const dy = y2 - y1;
          const dr = Math.sqrt(dx * dx + dy * dy) * 1.5;

          flowsGroup.append('path')
            .attr('d', `M${x1},${y1}A${dr},${dr} 0 0,1 ${x2},${y2}`)
            .attr('fill', 'none')
            .attr('stroke', '#00ff88')
            .attr('stroke-width', flow.strength * 3)
            .attr('opacity', 0.4)
            .attr('class', 'animate-flow');
        }
      });

      // Redraw sector overlay if country already selected (scenario change)
      if (selectedFeatureRef.current) {
        drawSectorOverlay(g, path, selectedFeatureRef.current, selectedCountry ?? '', scenario.id);
      }
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, geoPoints, onPointClick]);

  // Redraw sector overlay when selected country changes
  useEffect(() => {
    const g = gRef.current;
    const path = pathRef.current;
    if (!g || !path) return;
    g.selectAll('.country-sectors').remove();
    if (!selectedCountry || !selectedFeatureRef.current) return;
    drawSectorOverlay(g, path, selectedFeatureRef.current, selectedCountry, scenario.id);
  }, [selectedCountry, scenario.id]);

  const handleReset = () => {
    setSelectedCountry(null);
    selectedFeatureRef.current = null;

    if (gRef.current) {
      gRef.current.selectAll('path.country')
        .attr('fill', '#1a1a1a')
        .attr('stroke', '#333')
        .attr('stroke-width', 0.5);
      gRef.current.selectAll('.country-sectors').remove();
    }

    if (svgSelRef.current && zoomBehaviorRef.current) {
      (svgSelRef.current as any).transition().duration(750).call(
        (zoomBehaviorRef.current as any).transform,
        d3.zoomIdentity
      );
    }
  };

  return (
    <div className="w-full h-full relative overflow-hidden bg-black/20 rounded-xl border border-white/5">
      <svg
        ref={svgRef}
        className="w-full h-full"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
      />

      {selectedCountry && (
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 items-end pointer-events-auto">
          <div className="px-3 py-1.5 rounded bg-accent/10 border border-accent/30 backdrop-blur-sm">
            <span className="text-[10px] font-mono text-accent uppercase tracking-widest">
              {selectedCountry}
            </span>
          </div>
          <button
            onClick={handleReset}
            className="px-3 py-1 rounded bg-black/60 border border-white/10 hover:border-accent/30 hover:bg-accent/5 transition-all"
          >
            <span className="text-[9px] font-mono text-white/50 hover:text-accent uppercase tracking-widest">
              Mundo
            </span>
          </button>
        </div>
      )}

      <div className="absolute bottom-4 left-4 flex flex-col gap-1 pointer-events-none">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-accent animate-pulse" />
          <span className="text-[10px] font-mono text-accent uppercase tracking-widest">Centros de Gravedad Activos</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-white/20" />
          <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Mercados Secundarios</span>
        </div>
        {!selectedCountry && (
          <div className="flex items-center gap-2 mt-1">
            <div className="w-3 h-0.5 bg-white/15" />
            <span className="text-[9px] font-mono text-white/25 uppercase tracking-widest">Click país = flujo sectorial</span>
          </div>
        )}
      </div>
    </div>
  );
};

function drawSectorOverlay(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  path: d3.GeoPath,
  feature: any,
  countryName: string,
  scenarioId: string
) {
  g.selectAll('.country-sectors').remove();

  const [[x0, y0], [x1, y1]] = path.bounds(feature);
  if (x1 - x0 < 0.1 && y1 - y0 < 0.1) return;

  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const bboxSize = Math.min(x1 - x0, y1 - y0);
  const radius = Math.max(bboxSize * 0.28, 14);
  const nodeR = Math.max(radius * 0.14, 2.5);
  const textSize = Math.max(radius * 0.09, 4);

  const { nodes, flows } = getSectorData(scenarioId);
  const sectorGroup = g.append('g').attr('class', 'country-sectors');

  // Background glow on center
  sectorGroup.append('circle')
    .attr('cx', cx)
    .attr('cy', cy)
    .attr('r', radius * 0.15)
    .attr('fill', '#FBBF24')
    .attr('opacity', 0.04);

  // Draw flow arcs (from sector → through center → to sector)
  flows.forEach(flow => {
    const fromSector = SECTORS.find(s => s.id === flow.from);
    const toSector = SECTORS.find(s => s.id === flow.to);
    if (!fromSector || !toSector) return;

    const fa = (fromSector.angle * Math.PI) / 180;
    const ta = (toSector.angle * Math.PI) / 180;
    const fx = cx + radius * Math.cos(fa);
    const fy = cy + radius * Math.sin(fa);
    const tx = cx + radius * Math.cos(ta);
    const ty = cy + radius * Math.sin(ta);

    // Quadratic bezier through centroid
    sectorGroup.append('path')
      .attr('d', `M${fx},${fy} Q${cx},${cy} ${tx},${ty}`)
      .attr('fill', 'none')
      .attr('stroke', '#FBBF24')
      .attr('stroke-width', Math.max(flow.strength * 1.5, 0.4))
      .attr('opacity', 0.35 + flow.strength * 0.3)
      .attr('class', 'animate-flow');

    // Arrowhead at destination
    const arrowSize = nodeR * 0.6;
    const dirX = tx - cx;
    const dirY = ty - cy;
    const len = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
    const ux = dirX / len;
    const uy = dirY / len;
    const ax = tx - ux * nodeR * 1.5;
    const ay = ty - uy * nodeR * 1.5;

    sectorGroup.append('polygon')
      .attr('points', `
        ${ax},${ay}
        ${ax - uy * arrowSize - ux * arrowSize},${ay + ux * arrowSize - uy * arrowSize}
        ${ax + uy * arrowSize - ux * arrowSize},${ay - ux * arrowSize - uy * arrowSize}
      `)
      .attr('fill', '#FBBF24')
      .attr('opacity', 0.5 + flow.strength * 0.3);
  });

  // Draw sector nodes
  SECTORS.forEach(sector => {
    const node = nodes.find(n => n.id === sector.id);
    if (!node) return;

    const angle = (sector.angle * Math.PI) / 180;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);

    const nodeGroup = sectorGroup.append('g')
      .attr('transform', `translate(${x}, ${y})`);

    if (node.isGravityCenter) {
      nodeGroup.append('circle')
        .attr('r', nodeR * 1.5)
        .attr('fill', 'none')
        .attr('stroke', '#FBBF24')
        .attr('stroke-width', 0.5)
        .attr('opacity', 0.5)
        .append('animate')
        .attr('attributeName', 'r')
        .attr('from', String(nodeR))
        .attr('to', String(nodeR * 3))
        .attr('dur', '2.5s')
        .attr('repeatCount', 'indefinite');
    }

    nodeGroup.append('circle')
      .attr('r', nodeR)
      .attr('fill', node.isGravityCenter ? '#FBBF24' : '#1e3a5f')
      .attr('stroke', node.isGravityCenter ? '#FBBF24' : '#2563eb')
      .attr('stroke-width', 0.5);

    // Masa indicator ring
    nodeGroup.append('circle')
      .attr('r', nodeR * (0.8 + node.masa / 200))
      .attr('fill', 'none')
      .attr('stroke', node.isGravityCenter ? '#FBBF24' : '#1e3a5f')
      .attr('stroke-width', 0.3)
      .attr('opacity', 0.4);

    const labelOffset = -(nodeR + textSize * 0.6 + 1);
    nodeGroup.append('text')
      .text(sector.name)
      .attr('y', labelOffset)
      .attr('text-anchor', 'middle')
      .attr('fill', node.isGravityCenter ? '#FBBF24' : '#94A3B8')
      .attr('font-size', `${textSize}px`)
      .attr('font-family', 'monospace')
      .attr('font-weight', 'bold')
      .attr('pointer-events', 'none');

    // Masa value
    nodeGroup.append('text')
      .text(`${node.masa}`)
      .attr('y', nodeR + textSize + 1)
      .attr('text-anchor', 'middle')
      .attr('fill', node.isGravityCenter ? '#FBBF24' : '#4B6CB7')
      .attr('font-size', `${textSize * 0.85}px`)
      .attr('font-family', 'monospace')
      .attr('pointer-events', 'none')
      .attr('opacity', 0.7);
  });

  // Center label
  sectorGroup.append('text')
    .text(countryName.toUpperCase())
    .attr('x', cx)
    .attr('y', cy + textSize * 0.4)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .attr('fill', '#FBBF24')
    .attr('font-size', `${Math.max(textSize * 0.9, 4)}px`)
    .attr('font-family', 'monospace')
    .attr('font-weight', 'bold')
    .attr('opacity', 0.25)
    .attr('pointer-events', 'none');
}
