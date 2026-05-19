'use client';
import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { GeoPoint, MarketScenario } from '../data';

interface WorldMapProps {
  scenario: MarketScenario;
  geoPoints: GeoPoint[];
  theme?: 'dark' | 'light';
  onPointClick: (point: GeoPoint) => void;
  onCountrySelect?: (countryName: string | null) => void;
  onSectorClick?: (sectorId: string) => void;
}

const G8_ISO_IDS = new Set(['840', '124', '250', '276', '380', '392', '826', '643']);

// Structural sector dominance per G8 country [0-100] based on real economic weight
const G8_COUNTRY_SECTOR_PROFILES: Record<string, Record<string, number>> = {
  'EE.UU.': {
    technology: 95, communication: 88, cons_discretionary: 85, cons_staples: 80,
    energy: 78, financial: 90, healthcare: 87, industrials: 82,
    real_estate: 80, basic_materials: 75, utilities: 72,
  },
  'Canadá': {
    technology: 42, communication: 48, cons_discretionary: 45, cons_staples: 60,
    energy: 90, financial: 78, healthcare: 52, industrials: 60,
    real_estate: 72, basic_materials: 85, utilities: 58,
  },
  'Francia': {
    technology: 52, communication: 60, cons_discretionary: 80, cons_staples: 88,
    energy: 50, financial: 72, healthcare: 78, industrials: 82,
    real_estate: 65, basic_materials: 58, utilities: 65,
  },
  'Alemania': {
    technology: 62, communication: 52, cons_discretionary: 85, cons_staples: 65,
    energy: 55, financial: 62, healthcare: 68, industrials: 95,
    real_estate: 45, basic_materials: 80, utilities: 52,
  },
  'Italia': {
    technology: 38, communication: 50, cons_discretionary: 70, cons_staples: 78,
    energy: 52, financial: 65, healthcare: 60, industrials: 78,
    real_estate: 68, basic_materials: 55, utilities: 62,
  },
  'Japón': {
    technology: 82, communication: 65, cons_discretionary: 80, cons_staples: 70,
    energy: 30, financial: 60, healthcare: 72, industrials: 92,
    real_estate: 52, basic_materials: 65, utilities: 48,
  },
  'Reino Unido': {
    technology: 55, communication: 65, cons_discretionary: 62, cons_staples: 80,
    energy: 70, financial: 95, healthcare: 75, industrials: 60,
    real_estate: 70, basic_materials: 52, utilities: 62,
  },
  'Rusia': {
    technology: 30, communication: 42, cons_discretionary: 32, cons_staples: 52,
    energy: 98, financial: 45, healthcare: 38, industrials: 58,
    real_estate: 38, basic_materials: 85, utilities: 68,
  },
};

const ISO_NAMES: Record<string, string> = {
  '004': 'Afganistán', '008': 'Albania', '012': 'Argelia', '020': 'Andorra',
  '024': 'Angola', '028': 'Antigua y Barbuda', '031': 'Azerbaiyán',
  '032': 'Argentina', '036': 'Australia', '040': 'Austria',
  '044': 'Bahamas', '048': 'Baréin', '050': 'Bangladés', '051': 'Armenia',
  '052': 'Barbados', '056': 'Bélgica', '064': 'Bután', '068': 'Bolivia',
  '070': 'Bosnia-Herzegovina', '072': 'Botsuana', '076': 'Brasil',
  '084': 'Belice', '090': 'Islas Salomón', '096': 'Brunéi',
  '100': 'Bulgaria', '104': 'Myanmar', '108': 'Burundi', '112': 'Bielorrusia',
  '116': 'Camboya', '120': 'Camerún', '124': 'Canadá', '132': 'Cabo Verde',
  '140': 'Rep. Centroafricana', '144': 'Sri Lanka', '148': 'Chad',
  '152': 'Chile', '156': 'China', '158': 'Taiwán', '170': 'Colombia',
  '174': 'Comoras', '178': 'Congo', '180': 'Congo (RDC)', '188': 'Costa Rica',
  '191': 'Croacia', '192': 'Cuba', '196': 'Chipre', '203': 'Rep. Checa',
  '204': 'Benín', '208': 'Dinamarca', '212': 'Dominica',
  '214': 'Rep. Dominicana', '218': 'Ecuador', '222': 'El Salvador',
  '226': 'Guinea Ecuatorial', '231': 'Etiopía', '232': 'Eritrea',
  '233': 'Estonia', '238': 'Islas Malvinas', '242': 'Fiyi',
  '246': 'Finlandia', '250': 'Francia', '262': 'Yibuti', '266': 'Gabón',
  '268': 'Georgia', '270': 'Gambia', '275': 'Palestina', '276': 'Alemania',
  '288': 'Ghana', '300': 'Grecia', '304': 'Groenlandia', '320': 'Guatemala',
  '324': 'Guinea', '328': 'Guyana', '332': 'Haití', '340': 'Honduras',
  '348': 'Hungría', '352': 'Islandia', '356': 'India', '360': 'Indonesia',
  '364': 'Irán', '368': 'Irak', '372': 'Irlanda', '376': 'Israel',
  '380': 'Italia', '384': 'Costa de Marfil', '388': 'Jamaica',
  '392': 'Japón', '398': 'Kazajistán', '400': 'Jordania', '404': 'Kenia',
  '408': 'Corea del Norte', '410': 'Corea del Sur', '412': 'Kosovo',
  '414': 'Kuwait', '417': 'Kirguistán', '418': 'Laos', '422': 'Líbano',
  '426': 'Lesoto', '428': 'Letonia', '430': 'Liberia', '434': 'Libia',
  '438': 'Liechtenstein', '440': 'Lituania', '442': 'Luxemburgo',
  '450': 'Madagascar', '454': 'Malaui', '458': 'Malasia', '462': 'Maldivas',
  '466': 'Malí', '478': 'Mauritania', '480': 'Mauricio', '484': 'México',
  '496': 'Mongolia', '498': 'Moldavia', '499': 'Montenegro',
  '504': 'Marruecos', '508': 'Mozambique', '512': 'Omán', '516': 'Namibia',
  '524': 'Nepal', '528': 'Países Bajos', '540': 'Nueva Caledonia',
  '548': 'Vanuatu', '554': 'Nueva Zelanda', '558': 'Nicaragua',
  '562': 'Níger', '566': 'Nigeria', '578': 'Noruega', '586': 'Pakistán',
  '591': 'Panamá', '598': 'Papúa Nueva Guinea', '600': 'Paraguay',
  '604': 'Perú', '608': 'Filipinas', '616': 'Polonia', '620': 'Portugal',
  '624': 'Guinea-Bisáu', '626': 'Timor-Leste', '630': 'Puerto Rico',
  '634': 'Catar', '642': 'Rumanía', '643': 'Rusia', '646': 'Ruanda',
  '682': 'Arabia Saudita', '686': 'Senegal', '688': 'Serbia',
  '694': 'Sierra Leona', '703': 'Eslovaquia', '704': 'Vietnam',
  '705': 'Eslovenia', '706': 'Somalia', '710': 'Sudáfrica',
  '716': 'Zimbabue', '724': 'España', '728': 'Sudán del Sur', '729': 'Sudán',
  '732': 'Sahara Occidental', '740': 'Surinam', '748': 'Esuatini',
  '752': 'Suecia', '756': 'Suiza', '760': 'Siria', '762': 'Tayikistán',
  '764': 'Tailandia', '768': 'Togo', '780': 'Trinidad y Tobago',
  '784': 'EAU', '788': 'Túnez', '792': 'Turquía', '795': 'Turkmenistán',
  '800': 'Uganda', '804': 'Ucrania', '807': 'Macedonia del Norte',
  '818': 'Egipto', '826': 'Reino Unido', '834': 'Tanzania', '840': 'EE.UU.',
  '854': 'Burkina Faso', '858': 'Uruguay', '860': 'Uzbekistán',
  '862': 'Venezuela', '887': 'Yemen', '894': 'Zambia',
};

export const SECTORS = [
  { id: 'technology',         name: 'TECNOLOG.',  fullName: 'Technology',             angle: -90  },
  { id: 'communication',      name: 'COMUNIC.',   fullName: 'Communic. Services',     angle: -57  },
  { id: 'cons_discretionary', name: 'C.DISCR.',   fullName: 'Cons. Discretionary',    angle: -25  },
  { id: 'cons_staples',       name: 'C.BÁSICO',   fullName: 'Consumer Staples',       angle: 8    },
  { id: 'energy',             name: 'ENERGÍA',    fullName: 'Energy',                 angle: 41   },
  { id: 'financial',          name: 'FINANCIERO', fullName: 'Financials',             angle: 74   },
  { id: 'healthcare',         name: 'SALUD',      fullName: 'Health Care',            angle: 106  },
  { id: 'industrials',        name: 'INDUSTR.',   fullName: 'Industrials',            angle: 139  },
  { id: 'real_estate',        name: 'INMOB.',     fullName: 'Real Estate',            angle: 172  },
  { id: 'basic_materials',    name: 'MATER.',     fullName: 'Materials',              angle: 205  },
  { id: 'utilities',          name: 'UTILITIES',  fullName: 'Utilities',              angle: 237  },
];

export interface SectorFlow { from: string; to: string; strength: number; }
export interface SectorNode { id: string; masa: number; distancia: number; isGravityCenter: boolean; }

function mapRegimeToScenario(regime?: string): string {
  switch (regime) {
    case 'risk-on':   return 'dovish';
    case 'risk-off':  return 'hawkish';
    case 'crisis':    return 'crisis';
    case 'liquidity': return 'liquidity';
    default:          return 'dovish';
  }
}

function computeFlows(nodes: SectorNode[], topN = 6): SectorFlow[] {
  const candidates: Array<{ from: string; to: string; score: number }> = [];
  for (const from of nodes) {
    for (const to of nodes) {
      if (from.id === to.id) continue;
      const score = (from.masa * to.masa) / Math.max(1, to.distancia ** 2);
      candidates.push({ from: from.id, to: to.id, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, topN);
  const maxScore = top[0]?.score ?? 1;
  return top.map(f => ({
    from: f.from,
    to: f.to,
    strength: Math.round((f.score / maxScore) * 100) / 100,
  }));
}

function applyCountryProfile(
  nodes: SectorNode[],
  countryName: string,
): SectorNode[] {
  const profile = G8_COUNTRY_SECTOR_PROFILES[countryName];
  if (!profile) return nodes;
  const FRICCION = 10;
  return nodes.map(node => {
    const dominance = profile[node.id] ?? 50;
    const masa = Math.round(Math.max(5, Math.min(100, node.masa * 0.5 + dominance * 0.5)));
    const distancia = Math.round(Math.max(10, Math.min(90, node.distancia * (1 - (dominance - 50) / 250))));
    return { ...node, masa, distancia, isGravityCenter: (masa - distancia) / FRICCION > 3.0 };
  });
}

export function getSectorData(
  scenarioId: string,
  macroRegime?: string,
  liveSectorData?: {
    nodes: Array<{ id: string; masa: number; distancia: number; isGravityCenter: boolean }>;
    flows: Array<{ from: string; to: string; strength: number }>;
  },
  countryName?: string,
): { nodes: SectorNode[]; flows: SectorFlow[] } {
  if ((scenarioId === 'live' || scenarioId === 'current') && liveSectorData) {
    const nodes = countryName
      ? applyCountryProfile(liveSectorData.nodes as SectorNode[], countryName)
      : liveSectorData.nodes as SectorNode[];
    return { nodes, flows: computeFlows(nodes) };
  }
  const effectiveId = scenarioId === 'live' || scenarioId === 'current'
    ? mapRegimeToScenario(macroRegime)
    : scenarioId;
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

  const metrics = metricsMap[effectiveId] ?? fallback;

  const baseNodes: SectorNode[] = SECTORS.map(s => {
    const m = metrics[s.id] ?? { masa: 50, distancia: 50 };
    const force = (m.masa - m.distancia) / FRICCION;
    return { id: s.id, masa: m.masa, distancia: m.distancia, isGravityCenter: force > 3.0 };
  });
  const nodes = countryName ? applyCountryProfile(baseNodes, countryName) : baseNodes;

  return { nodes, flows: computeFlows(nodes) };
}

export const WorldMap: React.FC<WorldMapProps> = ({ scenario, geoPoints, theme = 'dark', onPointClick, onCountrySelect, onSectorClick }) => {
  const isLight = theme === 'light';
  const mc = {
    countryFill:   isLight ? '#e8eef5' : '#111111',
    countryStroke: isLight ? '#ccd6e0' : '#222',
    g8Fill:        isLight ? '#b8cfe8' : '#1a3a5c',
    g8Stroke:      isLight ? '#7aaed4' : '#2a5a8c',
    hoverFill:     isLight ? '#a0bfdc' : '#1e4a70',
    hoverStroke:   isLight ? '#5a9ac8' : '#3a7abf',
    accentColor:   isLight ? '#00aa55' : '#00ff88',
    dotSecondary:  isLight ? 'rgba(30,30,30,0.65)' : 'rgba(255,255,255,0.8)',
    textSecondary: isLight ? '#1e293b' : '#fff',
  };
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const pathRef = useRef<d3.GeoPath | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const svgSelRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const selectedFeatureRef = useRef<any>(null);
  const onCountrySelectRef = useRef(onCountrySelect);
  const onSectorClickRef = useRef(onSectorClick);
  useEffect(() => { onCountrySelectRef.current = onCountrySelect; });
  useEffect(() => { onSectorClickRef.current = onSectorClick; });

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
        .attr('fill', (d: any) => G8_ISO_IDS.has(String(d.id)) ? mc.g8Fill : mc.countryFill)
        .attr('stroke', (d: any) => G8_ISO_IDS.has(String(d.id)) ? mc.g8Stroke : mc.countryStroke)
        .attr('stroke-width', 0.5)
        .style('cursor', (d: any) => G8_ISO_IDS.has(String(d.id)) ? 'pointer' : 'default')
        .on('mouseenter', function (this: SVGPathElement, _event: any, d: any) {
          if (!G8_ISO_IDS.has(String(d.id))) return;
          if (selectedFeatureRef.current?.id !== d.id) {
            d3.select(this).attr('fill', mc.hoverFill).attr('stroke', mc.hoverStroke);
          }
        })
        .on('mouseleave', function (this: SVGPathElement, _event: any, d: any) {
          if (!G8_ISO_IDS.has(String(d.id))) return;
          if (selectedFeatureRef.current?.id !== d.id) {
            d3.select(this).attr('fill', mc.g8Fill).attr('stroke', mc.g8Stroke);
          }
        })
        .on('click', function (this: SVGPathElement, event: any, d: any) {
          if (!G8_ISO_IDS.has(String(d.id))) return;
          event.stopPropagation();

          const name = ISO_NAMES[String(d.id)] ?? `País ${d.id}`;
          selectedFeatureRef.current = d;

          g.selectAll('path.country')
            .attr('fill', (cd: any) => G8_ISO_IDS.has(String(cd.id)) ? mc.g8Fill : mc.countryFill)
            .attr('stroke', (cd: any) => G8_ISO_IDS.has(String(cd.id)) ? mc.g8Stroke : mc.countryStroke)
            .attr('stroke-width', 0.5);

          d3.select(this)
            .attr('fill', '#0d1b2e')
            .attr('stroke', '#2563eb')
            .attr('stroke-width', 1);

          setSelectedCountry(name);
          onCountrySelectRef.current?.(name);

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
            .attr('stroke', mc.accentColor)
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
            .attr('stroke', mc.accentColor)
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
          .attr('fill', isGravityCenter ? mc.accentColor : mc.dotSecondary);

        pointNode.append('text')
          .text(point.name.toUpperCase())
          .attr('y', 15)
          .attr('text-anchor', 'middle')
          .attr('fill', isGravityCenter ? mc.accentColor : mc.textSecondary)
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
            .attr('stroke', mc.accentColor)
            .attr('stroke-width', flow.strength * 3)
            .attr('opacity', 0.4)
            .attr('class', 'animate-flow');
        }
      });

      // Redraw sector overlay if country already selected (scenario change)
      if (selectedFeatureRef.current) {
        drawSectorOverlay(g, path, selectedFeatureRef.current, selectedCountry ?? '', scenario.id, onSectorClickRef.current, scenario.macroRegime, scenario.sectorData);
      }
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, geoPoints, onPointClick, theme]);

  // Redraw sector overlay when selected country changes
  useEffect(() => {
    const g = gRef.current;
    const path = pathRef.current;
    if (!g || !path) return;
    g.selectAll('.country-sectors').remove();
    if (!selectedCountry || !selectedFeatureRef.current) return;
    drawSectorOverlay(g, path, selectedFeatureRef.current, selectedCountry, scenario.id, onSectorClickRef.current, scenario.macroRegime, scenario.sectorData);
  }, [selectedCountry, scenario.id]);

  const handleReset = () => {
    setSelectedCountry(null);
    selectedFeatureRef.current = null;
    onCountrySelectRef.current?.(null);

    if (gRef.current) {
      gRef.current.selectAll('path.country')
        .attr('fill', (d: any) => G8_ISO_IDS.has(String(d.id)) ? mc.g8Fill : mc.countryFill)
        .attr('stroke', (d: any) => G8_ISO_IDS.has(String(d.id)) ? mc.g8Stroke : mc.countryStroke)
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
    <div className={`w-full h-full relative overflow-hidden rounded-xl border ${isLight ? 'bg-slate-100/60 border-slate-200' : 'bg-black/20 border-white/5'}`}>
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
        <div className="flex items-center gap-2 mt-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: '#1a3a5c' }} />
          <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: '#3a7abf' }}>G8 — Click para flujo sectorial</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: '#111111' }} />
          <span className="text-[9px] font-mono text-white/20 uppercase tracking-widest">Resto del mundo (no disponible)</span>
        </div>
      </div>
    </div>
  );
};

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 600;

function drawSectorOverlay(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  path: d3.GeoPath,
  feature: any,
  countryName: string,
  scenarioId: string,
  onSectorClick?: (sectorId: string) => void,
  macroRegime?: string,
  liveSectorData?: { nodes: Array<{ id: string; masa: number; distancia: number; isGravityCenter: boolean }>; flows: Array<{ from: string; to: string; strength: number }> },
) {
  g.selectAll('.country-sectors').remove();

  const [[x0, y0], [x1, y1]] = path.bounds(feature);
  if (x1 - x0 < 0.1 && y1 - y0 < 0.1) return;

  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const bboxW = Math.max(x1 - x0, 1);
  const bboxH = Math.max(y1 - y0, 1);
  const targetScale = Math.min(8, 0.85 / Math.max(bboxW / MAP_WIDTH, bboxH / MAP_HEIGHT));
  const radius = 70 / targetScale;
  const nodeR = radius * 0.14;
  const textSize = Math.min(radius * 0.09, 6);

  const { nodes, flows } = getSectorData(scenarioId, macroRegime, liveSectorData, countryName);
  const sectorGroup = g.append('g').attr('class', 'country-sectors');

  // Background glow on center
  sectorGroup.append('circle')
    .attr('cx', cx)
    .attr('cy', cy)
    .attr('r', radius * 0.15)
    .attr('fill', '#22D3EE')
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
      .attr('stroke', '#22D3EE')
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
      .attr('fill', '#22D3EE')
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
      .attr('transform', `translate(${x}, ${y})`)
      .style('cursor', 'pointer')
      .on('click', (event: MouseEvent) => { event.stopPropagation(); onSectorClick?.(sector.id); });

    if (node.isGravityCenter) {
      nodeGroup.append('circle')
        .attr('r', nodeR * 1.5)
        .attr('fill', 'none')
        .attr('stroke', '#22D3EE')
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
      .attr('fill', node.isGravityCenter ? '#22D3EE' : '#1e3a5f')
      .attr('stroke', node.isGravityCenter ? '#22D3EE' : '#2563eb')
      .attr('stroke-width', 0.5);

    // Masa indicator ring
    nodeGroup.append('circle')
      .attr('r', nodeR * (0.8 + node.masa / 200))
      .attr('fill', 'none')
      .attr('stroke', node.isGravityCenter ? '#22D3EE' : '#1e3a5f')
      .attr('stroke-width', 0.3)
      .attr('opacity', 0.4);

    const labelOffset = -(nodeR + textSize * 0.6 + 1);
    nodeGroup.append('text')
      .text(sector.name)
      .attr('y', labelOffset)
      .attr('text-anchor', 'middle')
      .attr('fill', node.isGravityCenter ? '#22D3EE' : '#94A3B8')
      .attr('font-size', `${textSize}px`)
      .attr('font-family', 'monospace')
      .attr('font-weight', 'bold')
      .attr('pointer-events', 'none');

    // Masa value
    nodeGroup.append('text')
      .text(`${node.masa}`)
      .attr('y', nodeR + textSize + 1)
      .attr('text-anchor', 'middle')
      .attr('fill', node.isGravityCenter ? '#22D3EE' : '#4B6CB7')
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
    .attr('fill', '#22D3EE')
    .attr('font-size', `${Math.max(textSize * 0.9, 4)}px`)
    .attr('font-family', 'monospace')
    .attr('font-weight', 'bold')
    .attr('opacity', 0.25)
    .attr('pointer-events', 'none');
}
