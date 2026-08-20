export enum Type {
  TYPE_UNSPECIFIED = "TYPE_UNSPECIFIED",
  STRING = "STRING",
  NUMBER = "NUMBER",
  INTEGER = "INTEGER",
  BOOLEAN = "BOOLEAN",
  ARRAY = "ARRAY",
  OBJECT = "OBJECT",
  NULL = "NULL",
}

export interface CapitalFlow {
  from: string;
  to: string;
  strength: number;
  flowTheoretical?: number;
  flowFinal?: number;
  zscoreAdjustment?: number;
  label: string;
}

export interface MasaComponents {
  retorno: number;
  crecimiento: number;
  liquidezActivo: number;
  confianza: number;
}

export interface DistanciaComponents {
  volatilidad: number;
  spread: number;
  correlacion: number;
}

export interface FriccionComponents {
  bidAskSpread: number;
  restricciones: number;
  profundidad: number;
}

export interface PriceData {
  value: string;
  change: string;
  trend: 'up' | 'down' | 'neutral';
}

export interface MarketPrices {
  dxy: PriceData;
  gold: PriceData;
  btc: PriceData;
  nasdaq: PriceData;
  dowjones: PriceData;
  sp500: PriceData;
  wti: PriceData;
  brent: PriceData;
}

export interface GravityMetrics {
  masa: number;
  distancia: number;
  friccion: number;
  masaComponents?: MasaComponents;
  masaWeights?: { w1: number; w2: number; w3: number; w4: number };
  distanciaComponents?: DistanciaComponents;
  friccionComponents?: FriccionComponents;
  fuerzaG?: number;
  zscoreFlows?: number;
  masaJustificacion?: string;
  distanciaJustificacion?: string;
  friccionJustificacion?: string;
}

export interface NewsItem {
  title: string;
  source: string;
  publishedAt: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  url?: string;
}

export interface NewsContext {
  headlines: NewsItem[];
  sentimentScore: number;
  newsSentiment: 'bullish' | 'bearish' | 'neutral';
  regimeSignal: string;
}

export interface MarketScenario {
  id: string;
  name: string;
  description: string;
  flows: CapitalFlow[];
  gravityCenters: string[];
  macroRegime?: string;
  regimeWeights?: { w1: number; w2: number; w3: number; w4: number };
  prices?: MarketPrices;
  lastUpdated?: number;
  metrics?: Record<string, GravityMetrics>;
  sectorData?: {
    nodes: Array<{ id: string; masa: number; distancia: number; isGravityCenter: boolean }>;
    flows: Array<{ from: string; to: string; strength: number }>;
  };
  countrySectorData?: Record<string, {
    nodes: Array<{ id: string; masa: number; distancia: number; isGravityCenter: boolean }>;
    flows: Array<{ from: string; to: string; strength: number }>;
  }>;
  rotationSignal?: string;
  newsContext?: NewsContext;
}

export const DEFAULT_PRICES: MarketPrices = {
  dxy: { value: '103.45', change: '+0.12%', trend: 'up' },
  gold: { value: '$2,185', change: '+0.35%', trend: 'up' },
  btc: { value: '$67,842', change: '+1.4%', trend: 'up' },
  nasdaq: { value: '16,120', change: '+0.72%', trend: 'up' },
  dowjones: { value: '39,110', change: '+0.28%', trend: 'up' },
  sp500: { value: '5,175', change: '+0.45%', trend: 'up' },
  wti: { value: '$81.20', change: '-0.85%', trend: 'down' },
  brent: { value: '$85.60', change: '-0.72%', trend: 'down' }
};

export const SCENARIOS: MarketScenario[] = [
  {
    id: 'current',
    name: 'Análisis de Mercado (Cargando...)',
    description: 'Sincronizando flujos de capital globales y centros de gravedad en tiempo real para abril de 2026...',
    gravityCenters: ['USD', 'Bonds'],
    flows: [
      { from: 'Emerging Markets', to: 'USD', strength: 0.5, label: 'Búsqueda de Liquidez' },
      { from: 'Norte America', to: 'Bonds', strength: 0.4, label: 'Cobertura de Riesgo' }
    ],
    metrics: {
      USD: { masa: 80, distancia: 20, friccion: 5 },
      Europe: { masa: 50, distancia: 40, friccion: 10 },
      "Emerging Markets": { masa: 30, distancia: 60, friccion: 30 },
      Gold: { masa: 70, distancia: 10, friccion: 15 },
      "Norte America": { masa: 60, distancia: 30, friccion: 10 },
      Bonds: { masa: 75, distancia: 15, friccion: 5 },
      Crypto: { masa: 40, distancia: 70, friccion: 20 },
      Oil: { masa: 50, distancia: 40, friccion: 20 },
      Asia: { masa: 55, distancia: 35, friccion: 20 }
    }
  },
  {
    id: 'hawkish',
    name: 'Hawkish (Tasas Altas)',
    description: 'Bancos centrales subiendo tasas. El capital fluye hacia bonos de alto rendimiento y divisas fuertes (USD).',
    gravityCenters: ['USD', 'Bonds'],
    flows: [
      { from: 'Emerging Markets', to: 'USD', strength: 0.8, label: 'Demanda de Dólares (Apreciación)' },
      { from: 'Norte America', to: 'Bonds', strength: 0.7, label: 'Demanda de Refugio (Bonds)' },
      { from: 'Crypto', to: 'USD', strength: 0.7, label: 'Liquidación de Riesgo' },
      { from: 'Asia', to: 'USD', strength: 0.6, label: 'Fuga de Capitales (DXY Strong)' },
      { from: 'Oil', to: 'USD', strength: 0.5, label: 'Deflación de Commodities' },
      { from: 'Europe', to: 'USD', strength: 0.5, label: 'Diferencial de Tasas (DXY Up)' },
      { from: 'Gold', to: 'USD', strength: 0.4, label: 'Costo de Oportunidad (USD Strong)' }
    ],
    metrics: {
      USD: { masa: 95, distancia: 10, friccion: 5 },
      Europe: { masa: 40, distancia: 40, friccion: 15 },
      "Emerging Markets": { masa: 20, distancia: 80, friccion: 40 },
      Gold: { masa: 30, distancia: 30, friccion: 10 },
      "Norte America": { masa: 50, distancia: 50, friccion: 10 },
      Bonds: { masa: 85, distancia: 10, friccion: 5 },
      Crypto: { masa: 20, distancia: 90, friccion: 25 },
      Oil: { masa: 40, distancia: 50, friccion: 20 },
      Asia: { masa: 25, distancia: 65, friccion: 35 }
    }
  },
  {
    id: 'dovish',
    name: 'Dovish (Tasas Bajas)',
    description: 'Tasas bajas y alta liquidez. El capital escapa de los refugios seguros para buscar crecimiento en tecnología y mercados emergentes.',
    gravityCenters: ['Norte America'],
    flows: [
      { from: 'Bonds', to: 'Norte America', strength: 0.7, label: 'Demanda de Crecimiento (Nasdaq Up)' },
      { from: 'USD', to: 'Emerging Markets', strength: 0.6, label: 'Carry Trade (DXY Down)' },
      { from: 'USD', to: 'Asia', strength: 0.5, label: 'Carry Trade (Asia)' },
      { from: 'USD', to: 'Crypto', strength: 0.5, label: 'Apetito por Riesgo (BTC Up)' },
      { from: 'USD', to: 'Oil', strength: 0.4, label: 'Demanda de Energía' },
      { from: 'USD', to: 'Europe', strength: 0.4, label: 'Devaluación del Dólar' }
    ],
    metrics: {
      USD: { masa: 40, distancia: 30, friccion: 5 },
      Europe: { masa: 60, distancia: 30, friccion: 10 },
      "Emerging Markets": { masa: 85, distancia: 30, friccion: 20 },
      Gold: { masa: 50, distancia: 20, friccion: 15 },
      "Norte America": { masa: 95, distancia: 20, friccion: 5 },
      Bonds: { masa: 30, distancia: 15, friccion: 5 },
      Crypto: { masa: 90, distancia: 40, friccion: 10 },
      Oil: { masa: 70, distancia: 30, friccion: 15 },
      Asia: { masa: 80, distancia: 25, friccion: 20 }
    }
  },
  {
    id: 'crisis',
    name: 'Crisis / Guerra (Risk-Off)',
    description: 'Alta incertidumbre. El capital colapsa hacia los refugios seguros definitivos: Oro, USD y Bonos del Tesoro.',
    gravityCenters: ['USD', 'Bonds'],
    flows: [
      { from: 'Emerging Markets', to: 'Gold', strength: 0.9, label: 'Cobertura de Pánico' },
      { from: 'Europe', to: 'USD', strength: 0.8, label: 'Seguridad Geopolítica' },
      { from: 'Norte America', to: 'Gold', strength: 0.8, label: 'Refugio Seguro' },
      { from: 'Norte America', to: 'Bonds', strength: 0.8, label: 'Preservación de Liquidez' },
      { from: 'Asia', to: 'Gold', strength: 0.7, label: 'Refugio Asiático' },
      { from: 'Emerging Markets', to: 'Oil', strength: 0.7, label: 'Choque de Suministro' },
      { from: 'Crypto', to: 'Gold', strength: 0.7, label: 'Desapalancamiento' }
    ],
    metrics: {
      USD: { masa: 85, distancia: 25, friccion: 5 },
      Europe: { masa: 20, distancia: 80, friccion: 25 },
      "Emerging Markets": { masa: 10, distancia: 95, friccion: 50 },
      Gold: { masa: 98, distancia: 5, friccion: 20 },
      "Norte America": { masa: 15, distancia: 90, friccion: 15 },
      Bonds: { masa: 90, distancia: 10, friccion: 5 },
      Crypto: { masa: 10, distancia: 98, friccion: 30 },
      Oil: { masa: 75, distancia: 60, friccion: 40 },
      Asia: { masa: 15, distancia: 85, friccion: 40 }
    }
  },
  {
    id: 'liquidity',
    name: 'Alta Liquidez (QE)',
    description: 'Abundante oferta monetaria. Todo sube, pero los activos especulativos atraen la mayor "gravedad".',
    gravityCenters: ['Norte America'],
    flows: [
      { from: 'USD', to: 'Norte America', strength: 0.9, label: 'Prima de Innovación' },
      { from: 'Bonds', to: 'Crypto', strength: 0.8, label: 'Exceso de Liquidez' },
      { from: 'USD', to: 'Oil', strength: 0.7, label: 'Demanda Industrial' },
      { from: 'Europe', to: 'Emerging Markets', strength: 0.6, label: 'Expansión Global' },
      { from: 'Bonds', to: 'Asia', strength: 0.6, label: 'Expansión Asiática' },
      { from: 'USD', to: 'Gold', strength: 0.5, label: 'Cobertura Inflacionaria' }
    ],
    metrics: {
      USD: { masa: 30, distancia: 10, friccion: 5 },
      Europe: { masa: 70, distancia: 20, friccion: 10 },
      "Emerging Markets": { masa: 80, distancia: 40, friccion: 25 },
      Gold: { masa: 60, distancia: 15, friccion: 15 },
      "Norte America": { masa: 98, distancia: 15, friccion: 5 },
      Bonds: { masa: 20, distancia: 10, friccion: 5 },
      Crypto: { masa: 95, distancia: 30, friccion: 10 },
      Oil: { masa: 85, distancia: 25, friccion: 15 },
      Asia: { masa: 85, distancia: 30, friccion: 20 }
    }
  }
];

export interface GeoPoint {
  id: string;
  name: string;
  coordinates: [number, number]; // [longitude, latitude]
  type: 'country' | 'asset';
}

export interface GeopoliticalEvent {
  id: string;
  name: string;
  coordinates: [number, number];
  type: 'conflict' | 'tension' | 'sanction';
  severity: 'high' | 'medium' | 'low';
  description: string;
  countries: string[];
  benefitedSectors: { id: string; label: string; reason: string }[];
  harmedSectors: { id: string; label: string; reason: string }[];
  supplyChainImpact: string;
}

export const GEO_EVENTS: GeopoliticalEvent[] = [
  {
    id: 'russia-ukraine',
    name: 'Guerra Rusia-Ucrania',
    coordinates: [32, 49],
    type: 'conflict',
    severity: 'high',
    description: 'Conflicto armado en curso desde febrero de 2022. Rusia ocupa territorios en el este y sur de Ucrania. NATO apoya a Ucrania con armamento y financiamiento. Impacto severo en cadenas de suministro de energía, granos y metales industriales.',
    countries: ['Rusia', 'Ucrania', 'NATO', 'Unión Europea'],
    benefitedSectors: [
      { id: 'energy', label: 'Energía', reason: 'Sustitución de gas ruso impulsa GNL, renovables y nuclear en Europa' },
      { id: 'basic_materials', label: 'Materiales Básicos', reason: 'Demanda de acero y titanio para defensa y reconstrucción' },
      { id: 'industrials', label: 'Industriales', reason: 'Contratos de defensa y reconstrucción disparan cartera de pedidos' },
    ],
    harmedSectors: [
      { id: 'cons_staples', label: 'Consumo Básico', reason: 'Ucrania y Rusia = 30% trigo global — precios agrícolas al alza' },
      { id: 'utilities', label: 'Servicios Públicos', reason: 'Crisis energética en Europa eleva costos operativos de utilities' },
      { id: 'real_estate', label: 'Bienes Raíces', reason: 'Alta inflación y tasas elevadas por crisis energética frenan inversión' },
    ],
    supplyChainImpact: 'Corte de gas natural ruso a Europa, disrupciones en exportaciones de granos por Mar Negro, escasez de neón y titanio críticos para semiconductores y aviación.',
  },
  {
    id: 'middle-east',
    name: 'Conflicto Medio Oriente',
    coordinates: [35, 31],
    type: 'conflict',
    severity: 'high',
    description: 'Conflicto entre Israel, Hamas y Hezbollah con participación indirecta de Irán. Escalada regional con riesgo de cierre del Estrecho de Ormuz. Afecta el 20% del comercio de petróleo global y rutas aéreas regionales.',
    countries: ['Israel', 'Palestina', 'Líbano', 'Irán', 'Estados Unidos'],
    benefitedSectors: [
      { id: 'energy', label: 'Energía', reason: 'Prima de riesgo geopolítico eleva precio del petróleo y gas natural' },
      { id: 'industrials', label: 'Industriales', reason: 'Contratos de defensa y sistemas de seguridad en expansión' },
    ],
    harmedSectors: [
      { id: 'cons_discretionary', label: 'Consumo Discrecional', reason: 'Turismo regional colapsado, confianza del consumidor deteriorada' },
      { id: 'financial', label: 'Financiero', reason: 'Exposición a deuda soberana regional y riesgo sistémico elevado' },
      { id: 'communication', label: 'Comunicación', reason: 'Boicots y riesgo reputacional para plataformas digitales globales' },
    ],
    supplyChainImpact: 'Riesgo de cierre del Estrecho de Ormuz afectaría 17M barriles/día. Canal de Suez bajo presión. Rutas aéreas redirigidas elevan costos logísticos hasta 40%.',
  },
  {
    id: 'red-sea',
    name: 'Crisis Mar Rojo — Hutíes',
    coordinates: [43, 13],
    type: 'conflict',
    severity: 'high',
    description: 'Ataques de milicias hutíes de Yemen contra buques comerciales en el Mar Rojo y Golfo de Adén. El 15% del comercio marítimo mundial que transita por el Canal de Suez está siendo redirigido por el Cabo de Buena Esperanza, añadiendo 14 días de tránsito.',
    countries: ['Yemen', 'Hutíes', 'Arabia Saudita', 'Estados Unidos', 'Reino Unido'],
    benefitedSectors: [
      { id: 'energy', label: 'Energía', reason: 'Rutas alternativas más largas aumentan demanda de combustible naviero' },
      { id: 'industrials', label: 'Industriales', reason: 'Empresas de logística y transporte marítimo alternativo se benefician' },
    ],
    harmedSectors: [
      { id: 'cons_discretionary', label: 'Consumo Discrecional', reason: 'Costos de flete x3, retrasos en entregas de bienes de consumo importados' },
      { id: 'cons_staples', label: 'Consumo Básico', reason: 'Inflación importada por mayores costos logísticos en alimentos procesados' },
      { id: 'technology', label: 'Tecnología', reason: 'Retrasos en componentes electrónicos desde Asia hacia Europa hasta 6 semanas' },
    ],
    supplyChainImpact: 'Fletes Suez-Europa +300%. Rutas redirigidas +14 días. 50% de buques evitan Mar Rojo. Impacto severo en inventarios just-in-time de manufactura global.',
  },
  {
    id: 'taiwan-strait',
    name: 'Tensión Estrecho de Taiwán',
    coordinates: [120, 24],
    type: 'tension',
    severity: 'high',
    description: 'China intensifica maniobras militares alrededor de Taiwán. TSMC produce el 90% de los chips avanzados (≤7nm) del mundo. Un bloqueo o invasión paralizaría la industria tecnológica global con pérdidas estimadas en $2.5 billones.',
    countries: ['China', 'Taiwán', 'Estados Unidos', 'Japón', 'Corea del Sur'],
    benefitedSectors: [
      { id: 'technology', label: 'Tecnología', reason: 'Aceleración de reshoring: Intel Arizona, TSMC Phoenix, Samsung Texas' },
      { id: 'industrials', label: 'Industriales', reason: 'Construcción de megafábricas de chips en EEUU, Europa y Japón' },
    ],
    harmedSectors: [
      { id: 'technology', label: 'Tecnología', reason: 'Disrupciones en suministro de chips avanzados afectarían toda la electrónica' },
      { id: 'cons_discretionary', label: 'Consumo Discrecional', reason: 'EVs, smartphones, PCs — todos dependientes de chips taiwaneses' },
      { id: 'industrials', label: 'Industriales', reason: 'Maquinaria avanzada y automatización paralizadas a corto plazo' },
    ],
    supplyChainImpact: 'TSMC = 90% chips ≤7nm. Bloqueo impacta: Apple, NVIDIA, AMD, Qualcomm. Reshoring acelerado pero insuficiente a corto plazo (3-5 años). Pérdidas estimadas $2.5T globales.',
  },
  {
    id: 'south-china-sea',
    name: 'Mar del Sur de China',
    coordinates: [114, 12],
    type: 'tension',
    severity: 'medium',
    description: 'Disputas territoriales entre China, Filipinas, Vietnam y Malasia por islas y recursos en el Mar del Sur de China. El 30% del comercio marítimo global transita por esta zona incluyendo rutas cruciales de energía y manufactura.',
    countries: ['China', 'Filipinas', 'Vietnam', 'Malasia', 'Estados Unidos'],
    benefitedSectors: [
      { id: 'energy', label: 'Energía', reason: 'Exploración de reservas offshore estimadas en 125B barriles de petróleo' },
    ],
    harmedSectors: [
      { id: 'cons_discretionary', label: 'Consumo Discrecional', reason: 'Disrupciones en rutas comerciales elevan costos de importación desde Asia' },
      { id: 'financial', label: 'Financiero', reason: 'Incertidumbre frena inversión extranjera directa en países involucrados' },
    ],
    supplyChainImpact: '30% del comercio marítimo global en riesgo. Ruta crítica para petróleo del Golfo Pérsico hacia Japón/Corea. Recursos offshore por 125B barriles en disputa.',
  },
  {
    id: 'iran-sanctions',
    name: 'Sanciones Irán / Nuclear',
    coordinates: [53, 33],
    type: 'sanction',
    severity: 'medium',
    description: 'Sanciones occidentales a Irán por programa nuclear y apoyo a grupos armados regionales. Irán exporta petróleo a China evadiendo sanciones. Tensiones con Israel sobre instalaciones nucleares en Fordow y Natanz.',
    countries: ['Irán', 'Estados Unidos', 'Israel', 'Unión Europea', 'China'],
    benefitedSectors: [
      { id: 'energy', label: 'Energía', reason: 'Reducción de oferta iraní presiona precios del crudo al alza' },
    ],
    harmedSectors: [
      { id: 'energy', label: 'Energía', reason: 'Riesgo de cierre del Estrecho de Ormuz si escala el conflicto nuclear' },
      { id: 'financial', label: 'Financiero', reason: 'Bancos con exposición a Medio Oriente bajo presión regulatoria OFAC' },
    ],
    supplyChainImpact: 'Irán controla Estrecho de Ormuz — 17M barriles/día (20% del petróleo global). Programa de misiles amenaza instalaciones petroleras sauditas y de EAU.',
  },
];

export const GEO_POINTS: GeoPoint[] = [
  { id: 'USD', name: 'USD', coordinates: [-95, 37], type: 'asset' },
  { id: 'Europe', name: 'EUROPA', coordinates: [10, 50], type: 'country' },
  { id: 'Emerging Markets', name: 'M. EMERGENTES', coordinates: [105, 15], type: 'country' },
  { id: 'Gold', name: 'ORO', coordinates: [8, 47], type: 'asset' },
  { id: 'Norte America', name: 'NORTE AMERICA', coordinates: [-100, 48], type: 'asset' },
  { id: 'Bonds', name: 'BONOS', coordinates: [-77, 38], type: 'asset' },
  { id: 'Crypto', name: 'CRYPTO', coordinates: [-40, 40], type: 'asset' },
  { id: 'Oil', name: 'PETRÓLEO', coordinates: [45, 25], type: 'asset' },
  { id: 'Asia', name: 'ASIA', coordinates: [118, 32], type: 'asset' },
];
