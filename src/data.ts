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

export interface CompanyRecommendation {
  ticker: string;
  name: string;
}

export interface CompanyGravityResult {
  ticker: string;
  name: string;
  price: number;
  changePct: number;
  masa: number;
  distancia: number;
  friccion: number;
  fuerzaG: number;
  institutionalPressure: number;
  optionsPressure: number;
  gammaFlip: number | null;
  putCallRatio: number;
  isGravityCenter: boolean;
  tier: 'high' | 'medium' | 'low';
  masaComponents: { retorno: number; crecimiento: number; liquidez: number; confianza: number };
  marketCap: number;
  error?: boolean;
}

export const COUNTRY_SECTOR_COMPANIES: Record<string, Record<string, CompanyRecommendation[]>> = {
  'EE.UU.': {
    technology:         [{ ticker:'AAPL', name:'Apple' },{ ticker:'MSFT', name:'Microsoft' },{ ticker:'NVDA', name:'Nvidia' },{ ticker:'GOOGL', name:'Alphabet' },{ ticker:'META', name:'Meta Platforms' },{ ticker:'AVGO', name:'Broadcom' },{ ticker:'ORCL', name:'Oracle' },{ ticker:'AMD', name:'AMD' },{ ticker:'QCOM', name:'Qualcomm' },{ ticker:'IBM', name:'IBM' }],
    communication:      [{ ticker:'GOOGL', name:'Alphabet' },{ ticker:'META', name:'Meta Platforms' },{ ticker:'DIS', name:'Walt Disney' },{ ticker:'NFLX', name:'Netflix' },{ ticker:'CMCSA', name:'Comcast' },{ ticker:'T', name:'AT&T' },{ ticker:'VZ', name:'Verizon' },{ ticker:'CHTR', name:'Charter Communications' },{ ticker:'PARA', name:'Paramount Global' },{ ticker:'WBD', name:'Warner Bros. Discovery' }],
    cons_discretionary: [{ ticker:'AMZN', name:'Amazon' },{ ticker:'TSLA', name:'Tesla' },{ ticker:'HD', name:'Home Depot' },{ ticker:'MCD', name:'McDonald\'s' },{ ticker:'NKE', name:'Nike' },{ ticker:'SBUX', name:'Starbucks' },{ ticker:'LOW', name:'Lowe\'s' },{ ticker:'TJX', name:'TJX Companies' },{ ticker:'BKNG', name:'Booking Holdings' },{ ticker:'GM', name:'General Motors' }],
    cons_staples:       [{ ticker:'WMT', name:'Walmart' },{ ticker:'PG', name:'Procter & Gamble' },{ ticker:'KO', name:'Coca-Cola' },{ ticker:'PEP', name:'PepsiCo' },{ ticker:'COST', name:'Costco' },{ ticker:'CL', name:'Colgate-Palmolive' },{ ticker:'MDLZ', name:'Mondelez' },{ ticker:'KHC', name:'Kraft Heinz' },{ ticker:'HSY', name:'Hershey' },{ ticker:'MO', name:'Altria Group' }],
    energy:             [{ ticker:'XOM', name:'ExxonMobil' },{ ticker:'CVX', name:'Chevron' },{ ticker:'COP', name:'ConocoPhillips' },{ ticker:'EOG', name:'EOG Resources' },{ ticker:'SLB', name:'SLB (Schlumberger)' },{ ticker:'PSX', name:'Phillips 66' },{ ticker:'MPC', name:'Marathon Petroleum' },{ ticker:'OXY', name:'Occidental Petroleum' },{ ticker:'VLO', name:'Valero Energy' },{ ticker:'HAL', name:'Halliburton' }],
    financial:          [{ ticker:'JPM', name:'JPMorgan Chase' },{ ticker:'BAC', name:'Bank of America' },{ ticker:'WFC', name:'Wells Fargo' },{ ticker:'GS', name:'Goldman Sachs' },{ ticker:'MS', name:'Morgan Stanley' },{ ticker:'BLK', name:'BlackRock' },{ ticker:'SCHW', name:'Charles Schwab' },{ ticker:'C', name:'Citigroup' },{ ticker:'AXP', name:'American Express' },{ ticker:'BX', name:'Blackstone' }],
    healthcare:         [{ ticker:'UNH', name:'UnitedHealth Group' },{ ticker:'JNJ', name:'Johnson & Johnson' },{ ticker:'LLY', name:'Eli Lilly' },{ ticker:'ABBV', name:'AbbVie' },{ ticker:'MRK', name:'Merck' },{ ticker:'TMO', name:'Thermo Fisher' },{ ticker:'ABT', name:'Abbott Labs' },{ ticker:'DHR', name:'Danaher' },{ ticker:'PFE', name:'Pfizer' },{ ticker:'BMY', name:'Bristol-Myers Squibb' }],
    industrials:        [{ ticker:'GE', name:'GE Aerospace' },{ ticker:'CAT', name:'Caterpillar' },{ ticker:'HON', name:'Honeywell' },{ ticker:'UPS', name:'UPS' },{ ticker:'DE', name:'Deere & Company' },{ ticker:'RTX', name:'RTX Corporation' },{ ticker:'LMT', name:'Lockheed Martin' },{ ticker:'BA', name:'Boeing' },{ ticker:'EMR', name:'Emerson Electric' },{ ticker:'ETN', name:'Eaton' }],
    real_estate:        [{ ticker:'PLD', name:'Prologis' },{ ticker:'AMT', name:'American Tower' },{ ticker:'EQIX', name:'Equinix' },{ ticker:'SPG', name:'Simon Property' },{ ticker:'O', name:'Realty Income' },{ ticker:'CCI', name:'Crown Castle' },{ ticker:'PSA', name:'Public Storage' },{ ticker:'WELL', name:'Welltower' },{ ticker:'DLR', name:'Digital Realty' },{ ticker:'AVB', name:'AvalonBay' }],
    basic_materials:    [{ ticker:'LIN', name:'Linde' },{ ticker:'APD', name:'Air Products' },{ ticker:'SHW', name:'Sherwin-Williams' },{ ticker:'ECL', name:'Ecolab' },{ ticker:'NEM', name:'Newmont' },{ ticker:'FCX', name:'Freeport-McMoRan' },{ ticker:'NUE', name:'Nucor' },{ ticker:'PPG', name:'PPG Industries' },{ ticker:'DD', name:'DuPont' },{ ticker:'CTVA', name:'Corteva' }],
    utilities:          [{ ticker:'NEE', name:'NextEra Energy' },{ ticker:'SO', name:'Southern Company' },{ ticker:'DUK', name:'Duke Energy' },{ ticker:'D', name:'Dominion Energy' },{ ticker:'SRE', name:'Sempra' },{ ticker:'AEP', name:'American Electric Power' },{ ticker:'EXC', name:'Exelon' },{ ticker:'PCG', name:'PG&E' },{ ticker:'WEC', name:'WEC Energy' },{ ticker:'ETR', name:'Entergy' }],
  },
  'Canadá': {
    technology:         [{ ticker:'SHOP', name:'Shopify' },{ ticker:'CSU.TO', name:'Constellation Software' },{ ticker:'OTEX', name:'Open Text' },{ ticker:'BB', name:'BlackBerry' },{ ticker:'KXS.TO', name:'Kinaxis' },{ ticker:'DSGX', name:'Descartes Systems' },{ ticker:'LSPD', name:'Lightspeed Commerce' },{ ticker:'GIB.A', name:'CGI Group' },{ ticker:'DCBO', name:'Docebo' },{ ticker:'MDA', name:'MDA Space' }],
    communication:      [{ ticker:'BCE', name:'Bell Canada' },{ ticker:'T', name:'TELUS' },{ ticker:'RCI-B.TO', name:'Rogers Communications' },{ ticker:'QBR-B.TO', name:'Quebecor' },{ ticker:'MAXR', name:'Maxar Technologies' },{ ticker:'CGO', name:'Cogeco' },{ ticker:'RAY.TO', name:'Stingray Group' },{ ticker:'CJR-B.TO', name:'Corus Entertainment' },{ ticker:'SFTC', name:'Softchoice' },{ ticker:'PHO', name:'Photon Control' }],
    cons_discretionary: [{ ticker:'DOL', name:'Dollarama' },{ ticker:'CTC-A.TO', name:'Canadian Tire' },{ ticker:'QSR', name:'Restaurant Brands' },{ ticker:'GIL', name:'Gildan Activewear' },{ ticker:'DOO', name:'BRP' },{ ticker:'LULU', name:'Lululemon' },{ ticker:'MTY.TO', name:'MTY Food Group' },{ ticker:'ATZ.TO', name:'Aritzia' },{ ticker:'TOY.TO', name:'Spin Master' },{ ticker:'ROOT', name:'Roots' }],
    cons_staples:       [{ ticker:'L', name:'Loblaw Companies' },{ ticker:'EMP-A.TO', name:'Empire Company' },{ ticker:'MRU.TO', name:'Metro' },{ ticker:'ATD.TO', name:'Alimentation Couche-Tard' },{ ticker:'WN.TO', name:'George Weston' },{ ticker:'PBH', name:'Premium Brands' },{ ticker:'NWC.TO', name:'North West Company' },{ ticker:'HLF', name:'High Liner Foods' },{ ticker:'ADW-B.TO', name:'Andrew Peller' },{ ticker:'VFF', name:'Village Farms' }],
    energy:             [{ ticker:'SU', name:'Suncor Energy' },{ ticker:'CNQ', name:'Canadian Natural Resources' },{ ticker:'CVE', name:'Cenovus Energy' },{ ticker:'IMO', name:'Imperial Oil' },{ ticker:'TOU.TO', name:'Tourmaline Oil' },{ ticker:'ARX', name:'Arc Resources' },{ ticker:'PPL', name:'Pembina Pipeline' },{ ticker:'TRP', name:'TC Energy' },{ ticker:'KEY', name:'Keyera' },{ ticker:'BTE', name:'Baytex Energy' }],
    financial:          [{ ticker:'RY', name:'Royal Bank of Canada' },{ ticker:'TD', name:'TD Bank' },{ ticker:'BNS', name:'Scotiabank' },{ ticker:'BMO', name:'Bank of Montreal' },{ ticker:'CM', name:'CIBC' },{ ticker:'MFC', name:'Manulife Financial' },{ ticker:'SLF', name:'Sun Life Financial' },{ ticker:'IFC.TO', name:'Intact Financial' },{ ticker:'FFH.TO', name:'Fairfax Financial' },{ ticker:'GWO.TO', name:'Great-West Lifeco' }],
    healthcare:         [{ ticker:'BHC', name:'Bausch Health' },{ ticker:'JWEL', name:'Jamieson Wellness' },{ ticker:'WELL', name:'Well Health Technologies' },{ ticker:'CSH-UN.TO', name:'Chartwell Retirement' },{ ticker:'SIA.TO', name:'Sienna Senior Living' },{ ticker:'AND', name:'Andlauer Healthcare' },{ ticker:'EXE', name:'Extendicare' },{ ticker:'NBLY', name:'Neighbourly Pharmacy' },{ ticker:'CURA.TO', name:'Curaleaf Holdings' },{ ticker:'TRST', name:'CannTrust' }],
    industrials:        [{ ticker:'CP', name:'Canadian Pacific Kansas City' },{ ticker:'CNR', name:'Canadian National Railway' },{ ticker:'WCN', name:'Waste Connections' },{ ticker:'WSP.TO', name:'WSP Global' },{ ticker:'ATRL', name:'AtkinsRéalis' },{ ticker:'FTT.TO', name:'Finning International' },{ ticker:'CAE', name:'CAE' },{ ticker:'EIF.TO', name:'Exchange Income' },{ ticker:'NFI.TO', name:'NFI Group' },{ ticker:'BIP-UN.TO', name:'Brookfield Infrastructure' }],
    real_estate:        [{ ticker:'BAM', name:'Brookfield Asset Management' },{ ticker:'CAR.UN', name:'Canadian Apartment REIT' },{ ticker:'REI.UN', name:'RioCan REIT' },{ ticker:'GRT.UN', name:'Granite REIT' },{ ticker:'AP.UN', name:'Allied REIT' },{ ticker:'CHP-UN.TO', name:'Choice Properties' },{ ticker:'SRU-UN.TO', name:'SmartCentres REIT' },{ ticker:'D-UN.TO', name:'Dream Office REIT' },{ ticker:'FCR-UN.TO', name:'First Capital REIT' },{ ticker:'HR.UN', name:'H&R REIT' }],
    basic_materials:    [{ ticker:'ABX', name:'Barrick Gold' },{ ticker:'AEM', name:'Agnico Eagle Mines' },{ ticker:'K.TO', name:'Kinross Gold' },{ ticker:'WPM', name:'Wheaton Precious Metals' },{ ticker:'FM.TO', name:'First Quantum Minerals' },{ ticker:'TECK-B.TO', name:'Teck Resources' },{ ticker:'NTR', name:'Nutrien' },{ ticker:'LUN.TO', name:'Lundin Mining' },{ ticker:'IVN.TO', name:'Ivanhoe Mines' },{ ticker:'PAAS', name:'Pan American Silver' }],
    utilities:          [{ ticker:'FTS', name:'Fortis' },{ ticker:'AQN', name:'Algonquin Power & Utilities' },{ ticker:'EMA', name:'Emera' },{ ticker:'H', name:'Hydro One' },{ ticker:'NPI', name:'Northland Power' },{ ticker:'CPX.TO', name:'Capital Power' },{ ticker:'BLX', name:'Boralex' },{ ticker:'INE', name:'Innergex Renewable' },{ ticker:'TA.TO', name:'TransAlta' },{ ticker:'ACO-X.TO', name:'ATCO' }],
  },
  'Francia': {
    technology:         [{ ticker:'CAP.PA', name:'Capgemini' },{ ticker:'DSY.PA', name:'Dassault Systèmes' },{ ticker:'WLN.PA', name:'Worldline' },{ ticker:'TEP.PA', name:'Teleperformance' },{ ticker:'SOP.PA', name:'Sopra Steria' },{ ticker:'HO.PA', name:'Thales' },{ ticker:'ATO.PA', name:'Atos' },{ ticker:'UBI.PA', name:'Ubisoft' },{ ticker:'ATE.PA', name:'Alten' },{ ticker:'AKA.PA', name:'Akka Technologies' }],
    communication:      [{ ticker:'ORA.PA', name:'Orange' },{ ticker:'VIV.PA', name:'Vivendi' },{ ticker:'ILD.PA', name:'Iliad' },{ ticker:'ETL.PA', name:'Eutelsat' },{ ticker:'TFI.PA', name:'TF1' },{ ticker:'MMT.PA', name:'M6 Metropole' },{ ticker:'EN.PA', name:'Bouygues' },{ ticker:'NEX.PA', name:'Nexity' },{ ticker:'LDL.PA', name:'Lagardère' },{ ticker:'EDI.PA', name:'EDITIS' }],
    cons_discretionary: [{ ticker:'MC.PA', name:'LVMH' },{ ticker:'KER.PA', name:'Kering' },{ ticker:'RNO.PA', name:'Renault' },{ ticker:'STLA', name:'Stellantis' },{ ticker:'AC.PA', name:'Accor' },{ ticker:'SW.PA', name:'Sodexo' },{ ticker:'ML.PA', name:'Michelin' },{ ticker:'RI.PA', name:'Pernod Ricard' },{ ticker:'POM.PA', name:'Plastic Omnium' },{ ticker:'LVE.PA', name:'Club Méditerranée' }],
    cons_staples:       [{ ticker:'BN.PA', name:'Danone' },{ ticker:'CA.PA', name:'Carrefour' },{ ticker:'OR.PA', name:'L\'Oréal' },{ ticker:'RCO.PA', name:'Rémy Cointreau' },{ ticker:'BON.PA', name:'Bonduelle' },{ ticker:'FBEL.PA', name:'Bel Group' },{ ticker:'LDC.PA', name:'LDC (Poulets)' },{ ticker:'GAIA.PA', name:'Gaia' },{ ticker:'ALFLE.PA', name:'Fleury Michon' },{ ticker:'MDP.PA', name:'MDP' }],
    energy:             [{ ticker:'TTE.PA', name:'TotalEnergies' },{ ticker:'ENGI.PA', name:'Engie' },{ ticker:'TE.PA', name:'Technip Energies' },{ ticker:'GTT.PA', name:'Gaztransport & Technigaz' },{ ticker:'VK.PA', name:'Vallourec' },{ ticker:'CGG.PA', name:'CGG' },{ ticker:'RUI.PA', name:'Rubis' },{ ticker:'MCPHY.PA', name:'McPhy Energy' },{ ticker:'NEOEN.PA', name:'Neoen' },{ ticker:'VLTSA.PA', name:'Voltalia' }],
    financial:          [{ ticker:'BNP.PA', name:'BNP Paribas' },{ ticker:'GLE.PA', name:'Société Générale' },{ ticker:'ACA.PA', name:'Crédit Agricole' },{ ticker:'CS.PA', name:'AXA' },{ ticker:'AMUN.PA', name:'Amundi' },{ ticker:'RF.PA', name:'Eurazeo' },{ ticker:'COFA.PA', name:'Coface' },{ ticker:'TKO.PA', name:'Tikehau Capital' },{ ticker:'MRM.PA', name:'MRM' },{ ticker:'BPCE.PA', name:'Natixis' }],
    healthcare:         [{ ticker:'SAN.PA', name:'Sanofi' },{ ticker:'BIM.PA', name:'bioMérieux' },{ ticker:'IPN.PA', name:'Ipsen' },{ ticker:'GBT.PA', name:'Guerbet' },{ ticker:'DBV.PA', name:'DBV Technologies' },{ ticker:'VLA.PA', name:'Valneva' },{ ticker:'IVA.PA', name:'Inventiva' },{ ticker:'ABIO.PA', name:'ABioTx' },{ ticker:'OEBS.PA', name:'OEBio Sciences' },{ ticker:'ALOCT.PA', name:'Octopharma' }],
    industrials:        [{ ticker:'AIR.PA', name:'Airbus' },{ ticker:'SGO.PA', name:'Saint-Gobain' },{ ticker:'SU.PA', name:'Schneider Electric' },{ ticker:'DG.PA', name:'Vinci' },{ ticker:'SAF.PA', name:'Safran' },{ ticker:'ALO.PA', name:'Alstom' },{ ticker:'LR.PA', name:'Legrand' },{ ticker:'FGR.PA', name:'Eiffage' },{ ticker:'SPIE.PA', name:'Spie' },{ ticker:'MTX.PA', name:'Manitou BF' }],
    real_estate:        [{ ticker:'URW.PA', name:'Unibail-Rodamco-Westfield' },{ ticker:'ICAD.PA', name:'Icade' },{ ticker:'GFC.PA', name:'Gecina' },{ ticker:'COV.PA', name:'Covivio' },{ ticker:'LI.PA', name:'Klépierre' },{ ticker:'MERY.PA', name:'Mercialys' },{ ticker:'ARG.PA', name:'Argan' },{ ticker:'PAT.PA', name:'Patrimoine & Commerce' },{ ticker:'ALTA.PA', name:'Altarea' },{ ticker:'FDE.PA', name:'Foncière des Murs' }],
    basic_materials:    [{ ticker:'AI.PA', name:'Air Liquide' },{ ticker:'AKE.PA', name:'Arkema' },{ ticker:'ERA.PA', name:'Eramet' },{ ticker:'NK.PA', name:'Imerys' },{ ticker:'VCT.PA', name:'Vicat' },{ ticker:'BVI.PA', name:'Bureau Veritas' },{ ticker:'SESG.PA', name:'SES-imagotag' },{ ticker:'MLCOU.PA', name:'Courtois' },{ ticker:'SFCA.PA', name:'Soitec' },{ ticker:'NEX.PA', name:'Nexans' }],
    utilities:          [{ ticker:'ENGI.PA', name:'Engie' },{ ticker:'VIE.PA', name:'Veolia Environnement' },{ ticker:'NEOEN.PA', name:'Neoen' },{ ticker:'VLTSA.PA', name:'Voltalia' },{ ticker:'RUI.PA', name:'Rubis' },{ ticker:'MCPHY.PA', name:'McPhy Energy' },{ ticker:'ALLDL.PA', name:'Lhyfe' },{ ticker:'ALBIZ.PA', name:'Bioenerys' },{ ticker:'SOLV.PA', name:'Solvay' },{ ticker:'EDF.PA', name:'EDF' }],
  },
  'Alemania': {
    technology:         [{ ticker:'SAP.DE', name:'SAP' },{ ticker:'IFX.DE', name:'Infineon Technologies' },{ ticker:'INW.DE', name:'Software AG' },{ ticker:'NEM.DE', name:'Nemetschek' },{ ticker:'BC8.DE', name:'Bechtle' },{ ticker:'D6H.DE', name:'Datagroup' },{ ticker:'NA9.DE', name:'Nagarro' },{ ticker:'COP.DE', name:'CompuGroup Medical' },{ ticker:'IOS.DE', name:'IONOS Group' },{ ticker:'8TRA.DE', name:'Traton' }],
    communication:      [{ ticker:'DTE.DE', name:'Deutsche Telekom' },{ ticker:'UTDI.DE', name:'United Internet' },{ ticker:'FNTN.DE', name:'freenet' },{ ticker:'O2D.DE', name:'Telefonica Deutschland' },{ ticker:'1U1.DE', name:'1&1 AG' },{ ticker:'PSM.DE', name:'ProSiebenSat.1' },{ ticker:'SAX.DE', name:'Ströer' },{ ticker:'NDA.DE', name:'Norma Group' },{ ticker:'MEO.DE', name:'Media & More' },{ ticker:'ING.DE', name:'ING DiBa' }],
    cons_discretionary: [{ ticker:'VOW3.DE', name:'Volkswagen' },{ ticker:'BMW.DE', name:'BMW' },{ ticker:'MBG.DE', name:'Mercedes-Benz' },{ ticker:'ADS.DE', name:'Adidas' },{ ticker:'P911.DE', name:'Porsche AG' },{ ticker:'CON.DE', name:'Continental' },{ ticker:'BOSS.DE', name:'Hugo Boss' },{ ticker:'ZAL.DE', name:'Zalando' },{ ticker:'HFG.DE', name:'HelloFresh' },{ ticker:'PUM.DE', name:'Puma' }],
    cons_staples:       [{ ticker:'HEN3.DE', name:'Henkel' },{ ticker:'BEI.DE', name:'Beiersdorf' },{ ticker:'SY1.DE', name:'Symrise' },{ ticker:'RAA.DE', name:'Rational AG' },{ ticker:'B4B.DE', name:'Metro AG' },{ ticker:'FRE.DE', name:'Fresenius' },{ ticker:'KWS.DE', name:'KWS Saat' },{ ticker:'SDF.DE', name:'K+S (Düngemittel)' },{ ticker:'AOF.DE', name:'ATOSS Software' },{ ticker:'EVD.DE', name:'CTS Eventim' }],
    energy:             [{ ticker:'RWE.DE', name:'RWE' },{ ticker:'EOAN.DE', name:'E.ON' },{ ticker:'ENR.DE', name:'Siemens Energy' },{ ticker:'NDX1.DE', name:'Nordex' },{ ticker:'ECV.DE', name:'Encavis' },{ ticker:'PNE.DE', name:'PNE Wind' },{ ticker:'UN0.DE', name:'Uniper' },{ ticker:'OEWA.DE', name:'Verbund' },{ ticker:'2G1.DE', name:'2G Energy' },{ ticker:'MVV1.DE', name:'MVV Energie' }],
    financial:          [{ ticker:'ALV.DE', name:'Allianz' },{ ticker:'DBK.DE', name:'Deutsche Bank' },{ ticker:'CBK.DE', name:'Commerzbank' },{ ticker:'MUV2.DE', name:'Munich Re' },{ ticker:'HNR1.DE', name:'Hannover Re' },{ ticker:'DWS.DE', name:'DWS Group' },{ ticker:'TLX.DE', name:'Talanx' },{ ticker:'ARL.DE', name:'Aareal Bank' },{ ticker:'PBB.DE', name:'Deutsche Pfandbriefbank' },{ ticker:'COB.DE', name:'Cobank' }],
    healthcare:         [{ ticker:'BAYN.DE', name:'Bayer' },{ ticker:'FRE.DE', name:'Fresenius' },{ ticker:'MRK.DE', name:'Merck KGaA' },{ ticker:'SHL.DE', name:'Siemens Healthineers' },{ ticker:'QIA.DE', name:'Qiagen' },{ ticker:'SRT3.DE', name:'Sartorius' },{ ticker:'EVT.DE', name:'Evotec' },{ ticker:'DRW3.DE', name:'Drägerwerk' },{ ticker:'GXI.DE', name:'Gerresheimer' },{ ticker:'SDMG.DE', name:'Schiller Medical' }],
    industrials:        [{ ticker:'SIE.DE', name:'Siemens' },{ ticker:'TKA.DE', name:'Thyssenkrupp' },{ ticker:'HEI.DE', name:'Heidelberg Materials' },{ ticker:'DTG.DE', name:'Daimler Truck' },{ ticker:'KBX.DE', name:'Knorr-Bremse' },{ ticker:'KGX.DE', name:'KION Group' },{ ticker:'WCH.DE', name:'Wacker Chemie' },{ ticker:'DUE.DE', name:'Dürr' },{ ticker:'AIXA.DE', name:'Aixtron' },{ ticker:'DHER.DE', name:'Delivery Hero' }],
    real_estate:        [{ ticker:'VNA.DE', name:'Vonovia' },{ ticker:'LEG.DE', name:'LEG Immobilien' },{ ticker:'AT1.DE', name:'Aroundtown' },{ ticker:'GYC.DE', name:'Grand City Properties' },{ ticker:'INS.DE', name:'Instone Real Estate' },{ ticker:'DEQ.DE', name:'Deutsche EuroShop' },{ ticker:'ADJ.DE', name:'ADO Properties' },{ ticker:'HAL.DE', name:'Hamborner REIT' },{ ticker:'DWNI.DE', name:'Deutsche Wohnen' },{ ticker:'VIB3.DE', name:'VIB Vermögen' }],
    basic_materials:    [{ ticker:'BAS.DE', name:'BASF' },{ ticker:'1COV.DE', name:'Covestro' },{ ticker:'LXS.DE', name:'Lanxess' },{ ticker:'EVK.DE', name:'Evonik' },{ ticker:'BNR.DE', name:'Brenntag' },{ ticker:'NDA.DE', name:'Aurubis' },{ ticker:'SDF.DE', name:'K+S' },{ ticker:'DG3.DE', name:'Celanese' },{ ticker:'WWIN.DE', name:'Wincor Nixdorf' },{ ticker:'SYK.DE', name:'Symrise' }],
    utilities:          [{ ticker:'EOAN.DE', name:'E.ON' },{ ticker:'RWE.DE', name:'RWE' },{ ticker:'ENR.DE', name:'Siemens Energy' },{ ticker:'ECV.DE', name:'Encavis' },{ ticker:'NDX1.DE', name:'Nordex' },{ ticker:'UN0.DE', name:'Uniper' },{ ticker:'MVV1.DE', name:'MVV Energie' },{ ticker:'2G1.DE', name:'2G Energy' },{ ticker:'PNE3.DE', name:'PNE' },{ ticker:'ABO.DE', name:'ABO Wind' }],
  },
  'Italia': {
    technology:         [{ ticker:'STM', name:'STMicroelectronics' },{ ticker:'REY.MI', name:'Reply' },{ ticker:'SES.MI', name:'Sesa' },{ ticker:'XPR.MI', name:'Exprivia' },{ ticker:'TXT.MI', name:'TXT e-Solutions' },{ ticker:'PITE.MI', name:'Piteco' },{ ticker:'ELSY.MI', name:'Elsys' },{ ticker:'NVEI.MI', name:'Nuvei' },{ ticker:'AIQ.MI', name:'AI.Quotient' },{ ticker:'CSEN.MI', name:'Csen' }],
    communication:      [{ ticker:'TIT.MI', name:'Telecom Italia' },{ ticker:'MFE.MI', name:'Mediaforeurope (Mediaset)' },{ ticker:'GEDI.MI', name:'GEDI' },{ ticker:'MN.MI', name:'Mondadori' },{ ticker:'IGD.MI', name:'IGD SIIQ' },{ ticker:'RCS.MI', name:'RCS MediaGroup' },{ ticker:'PSTV.MI', name:'PA-Software' },{ ticker:'DMO.MI', name:'Damomedia' },{ ticker:'E.MI', name:'Enel (telecom div.)' },{ ticker:'PRT.MI', name:'Poste Italiane' }],
    cons_discretionary: [{ ticker:'STLA', name:'Stellantis' },{ ticker:'RACE', name:'Ferrari' },{ ticker:'MONC.MI', name:'Moncler' },{ ticker:'BC.MI', name:'Brunello Cucinelli' },{ ticker:'TOD.MI', name:'Tod\'s' },{ ticker:'SFER.MI', name:'Salvatore Ferragamo' },{ ticker:'DLG.MI', name:'De\'Longhi' },{ ticker:'CPR.MI', name:'Campari' },{ ticker:'PIRC.MI', name:'Pirelli' },{ ticker:'GROS.MI', name:'Basicnet' }],
    cons_staples:       [{ ticker:'CPR.MI', name:'Campari' },{ ticker:'ITM.MI', name:'Italmobiliare' },{ ticker:'IMA.MI', name:'IMA Group' },{ ticker:'ECNL.MI', name:'Aquafil' },{ ticker:'OVS.MI', name:'OVS' },{ ticker:'DMR.MI', name:'De Longhi' },{ ticker:'PST.MI', name:'Poste Italiane' },{ ticker:'VID.MI', name:'Video System' },{ ticker:'SAVE.MI', name:'SAVE Group' },{ ticker:'UNI.MI', name:'Unipol' }],
    energy:             [{ ticker:'ENI.MI', name:'ENI' },{ ticker:'ENEL.MI', name:'Enel' },{ ticker:'SPM.MI', name:'Saipem' },{ ticker:'TEN.MI', name:'Tenaris' },{ ticker:'ERG.MI', name:'ERG' },{ ticker:'SRG.MI', name:'Snam' },{ ticker:'IG.MI', name:'Italgas' },{ ticker:'A2A.MI', name:'A2A' },{ ticker:'SRS.MI', name:'Saras' },{ ticker:'ITW.MI', name:'Iren' }],
    financial:          [{ ticker:'ISP.MI', name:'Intesa Sanpaolo' },{ ticker:'UCG.MI', name:'UniCredit' },{ ticker:'G.MI', name:'Generali' },{ ticker:'MB.MI', name:'Mediobanca' },{ ticker:'BAMI.MI', name:'Banco BPM' },{ ticker:'FBK.MI', name:'FinecoBank' },{ ticker:'BMPS.MI', name:'Banca Monte dei Paschi' },{ ticker:'BMED.MI', name:'Banca Mediolanum' },{ ticker:'AZM.MI', name:'Azimut Holding' },{ ticker:'PST.MI', name:'Poste Italiane' }],
    healthcare:         [{ ticker:'REC.MI', name:'Recordati' },{ ticker:'DIA.MI', name:'DiaSorin' },{ ticker:'AMP.MI', name:'Amplifon' },{ ticker:'LIVN', name:'LivaNova' },{ ticker:'STVN', name:'Stevanato Group' },{ ticker:'OPNT.MI', name:'Opnet' },{ ticker:'GEO.MI', name:'GeoBiologics' },{ ticker:'SOFL.MI', name:'SoFLY' },{ ticker:'BIO.MI', name:'Biomerieux' },{ ticker:'ELI.MI', name:'Elis' }],
    industrials:        [{ ticker:'LDO.MI', name:'Leonardo' },{ ticker:'FCT.MI', name:'Fincantieri' },{ ticker:'PRY.MI', name:'Prysmian' },{ ticker:'IP.MI', name:'Interpump Group' },{ ticker:'1CNHI.MI', name:'CNH Industrial' },{ ticker:'BZU.MI', name:'Buzzi Unicem' },{ ticker:'DAL.MI', name:'Datalogic' },{ ticker:'BRE.MI', name:'Brembo' },{ ticker:'BSS.MI', name:'Biesse Group' },{ ticker:'CEM.MI', name:'Cementir Holding' }],
    real_estate:        [{ ticker:'CRES.MI', name:'Coima RES' },{ ticker:'IGD.MI', name:'IGD SIIQ' },{ ticker:'AED.MI', name:'Aedes SIIQ' },{ ticker:'COV.PA', name:'Covivio (ex Beni Stabili)' },{ ticker:'PRLI.MI', name:'Prelios' },{ ticker:'RN.MI', name:'Risanamento' },{ ticker:'GAB.MI', name:'Gabetti Property' },{ ticker:'AREIT.MI', name:'Altareit' },{ ticker:'VLS.MI', name:'Valsoia' },{ ticker:'L.MI', name:'Leasinvest' }],
    basic_materials:    [{ ticker:'TEN.MI', name:'Tenaris' },{ ticker:'BZU.MI', name:'Buzzi Unicem' },{ ticker:'CEM.MI', name:'Cementir' },{ ticker:'ITM.MI', name:'Italmobiliare' },{ ticker:'SRS.MI', name:'Saras' },{ ticker:'ECNL.MI', name:'Aquafil' },{ ticker:'TIT.MI', name:'Telecom Italia (infraestr.)' },{ ticker:'ERG.MI', name:'ERG' },{ ticker:'SRG.MI', name:'Snam' },{ ticker:'LDO.MI', name:'Leonardo' }],
    utilities:          [{ ticker:'ENEL.MI', name:'Enel' },{ ticker:'A2A.MI', name:'A2A' },{ ticker:'IRE.MI', name:'Iren' },{ ticker:'HER.MI', name:'Hera' },{ ticker:'ACE.MI', name:'Acea' },{ ticker:'SRG.MI', name:'Snam' },{ ticker:'IG.MI', name:'Italgas' },{ ticker:'TRN.MI', name:'Terna' },{ ticker:'ERG.MI', name:'ERG' },{ ticker:'ENAV.MI', name:'ENAV' }],
  },
  'Japón': {
    technology:         [{ ticker:'6758.T', name:'Sony Group' },{ ticker:'6861.T', name:'Keyence' },{ ticker:'6702.T', name:'Fujitsu' },{ ticker:'6501.T', name:'Hitachi' },{ ticker:'6981.T', name:'Murata Manufacturing' },{ ticker:'6762.T', name:'TDK' },{ ticker:'6723.T', name:'Renesas Electronics' },{ ticker:'6857.T', name:'Advantest' },{ ticker:'6146.T', name:'Disco' },{ ticker:'4063.T', name:'Shin-Etsu Chemical' }],
    communication:      [{ ticker:'9984.T', name:'SoftBank Group' },{ ticker:'9432.T', name:'NTT (Nippon Telegraph)' },{ ticker:'9433.T', name:'KDDI' },{ ticker:'4755.T', name:'Rakuten' },{ ticker:'4751.T', name:'Cyberagent' },{ ticker:'2432.T', name:'DeNA' },{ ticker:'3659.T', name:'Nexon' },{ ticker:'4689.T', name:'Z Holdings (Yahoo Japan)' },{ ticker:'6178.T', name:'Japan Post Holdings' },{ ticker:'9437.T', name:'NTT Docomo' }],
    cons_discretionary: [{ ticker:'7203.T', name:'Toyota Motor' },{ ticker:'7267.T', name:'Honda Motor' },{ ticker:'7201.T', name:'Nissan Motor' },{ ticker:'7974.T', name:'Nintendo' },{ ticker:'9983.T', name:'Fast Retailing (Uniqlo)' },{ ticker:'7731.T', name:'Nikon' },{ ticker:'7951.T', name:'Yamaha' },{ ticker:'7270.T', name:'Subaru' },{ ticker:'7261.T', name:'Mazda Motor' },{ ticker:'5020.T', name:'Pan Pacific Retail' }],
    cons_staples:       [{ ticker:'8267.T', name:'Aeon' },{ ticker:'2502.T', name:'Asahi Group Holdings' },{ ticker:'2503.T', name:'Kirin Holdings' },{ ticker:'3382.T', name:'Seven & I Holdings' },{ ticker:'2802.T', name:'Ajinomoto' },{ ticker:'4452.T', name:'Kao Corporation' },{ ticker:'4912.T', name:'Lion Corporation' },{ ticker:'2269.T', name:'Meiji Holdings' },{ ticker:'2002.T', name:'Nisshin Seifun' },{ ticker:'2282.T', name:'NH Foods' }],
    energy:             [{ ticker:'5020.T', name:'ENEOS Holdings' },{ ticker:'5019.T', name:'Idemitsu Kosan' },{ ticker:'5021.T', name:'Cosmo Energy' },{ ticker:'1605.T', name:'Inpex' },{ ticker:'1662.T', name:'Japan Petroleum Exploration' },{ ticker:'9531.T', name:'Tokyo Gas' },{ ticker:'9532.T', name:'Osaka Gas' },{ ticker:'9501.T', name:'TEPCO' },{ ticker:'9502.T', name:'Chubu Electric Power' },{ ticker:'9503.T', name:'Kansai Electric Power' }],
    financial:          [{ ticker:'8306.T', name:'Mitsubishi UFJ Financial' },{ ticker:'8411.T', name:'Mizuho Financial' },{ ticker:'8316.T', name:'Sumitomo Mitsui Financial' },{ ticker:'8604.T', name:'Nomura Holdings' },{ ticker:'8601.T', name:'Daiwa Securities' },{ ticker:'8725.T', name:'MS&AD Insurance' },{ ticker:'8766.T', name:'Tokio Marine Holdings' },{ ticker:'8795.T', name:'T&D Holdings' },{ ticker:'8591.T', name:'ORIX Corporation' },{ ticker:'6178.T', name:'Japan Post Holdings' }],
    healthcare:         [{ ticker:'4502.T', name:'Takeda Pharmaceutical' },{ ticker:'4503.T', name:'Astellas Pharma' },{ ticker:'4568.T', name:'Daiichi Sankyo' },{ ticker:'4507.T', name:'Shionogi' },{ ticker:'4523.T', name:'Eisai' },{ ticker:'7733.T', name:'Olympus' },{ ticker:'4543.T', name:'Terumo' },{ ticker:'7741.T', name:'Hoya' },{ ticker:'6869.T', name:'Sysmex' },{ ticker:'4151.T', name:'Kyowa Kirin' }],
    industrials:        [{ ticker:'7011.T', name:'Mitsubishi Heavy Industries' },{ ticker:'7012.T', name:'Kawasaki Heavy Industries' },{ ticker:'7013.T', name:'IHI Corporation' },{ ticker:'6301.T', name:'Komatsu' },{ ticker:'6954.T', name:'Fanuc' },{ ticker:'6594.T', name:'Nidec' },{ ticker:'6383.T', name:'Daifuku' },{ ticker:'6481.T', name:'THK' },{ ticker:'6113.T', name:'Amada' },{ ticker:'5401.T', name:'Nippon Steel' }],
    real_estate:        [{ ticker:'8801.T', name:'Mitsui Fudosan' },{ ticker:'8802.T', name:'Mitsubishi Estate' },{ ticker:'8830.T', name:'Sumitomo Realty' },{ ticker:'3003.T', name:'Hulic' },{ ticker:'3231.T', name:'Nomura Real Estate' },{ ticker:'1925.T', name:'Daiwa House Industry' },{ ticker:'1928.T', name:'Sekisui House' },{ ticker:'8811.T', name:'Tokyo Land Corporation' },{ ticker:'8848.T', name:'Leopalace21' },{ ticker:'3289.T', name:'Tokyu Fudosan Holdings' }],
    basic_materials:    [{ ticker:'5401.T', name:'Nippon Steel' },{ ticker:'5411.T', name:'JFE Holdings' },{ ticker:'5713.T', name:'Sumitomo Metal Mining' },{ ticker:'3402.T', name:'Toray Industries' },{ ticker:'3407.T', name:'Asahi Kasei' },{ ticker:'3405.T', name:'Kuraray' },{ ticker:'4185.T', name:'JSR Corporation' },{ ticker:'5714.T', name:'Dowa Holdings' },{ ticker:'4004.T', name:'Showa Denko' },{ ticker:'4208.T', name:'UBE Industries' }],
    utilities:          [{ ticker:'9501.T', name:'Tokyo Electric Power (TEPCO)' },{ ticker:'9503.T', name:'Kansai Electric Power' },{ ticker:'9502.T', name:'Chubu Electric Power' },{ ticker:'9506.T', name:'Tohoku Electric Power' },{ ticker:'9508.T', name:'Kyushu Electric Power' },{ ticker:'9509.T', name:'Hokkaido Electric Power' },{ ticker:'9504.T', name:'Chugoku Electric Power' },{ ticker:'9507.T', name:'Shikoku Electric Power' },{ ticker:'9513.T', name:'J-Power' },{ ticker:'9531.T', name:'Tokyo Gas' }],
  },
  'Reino Unido': {
    technology:         [{ ticker:'ARM', name:'Arm Holdings' },{ ticker:'SGE.L', name:'Sage Group' },{ ticker:'DARK.L', name:'Darktrace' },{ ticker:'KNOS.L', name:'Kainos Group' },{ ticker:'SCT.L', name:'Softcat' },{ ticker:'CCC.L', name:'Computacenter' },{ ticker:'FDM.L', name:'FDM Group' },{ ticker:'BYIT.L', name:'Bytes Technology' },{ ticker:'AUTO.L', name:'Auto Trader Group' },{ ticker:'RMV.L', name:'Rightmove' }],
    communication:      [{ ticker:'BT.A.L', name:'BT Group' },{ ticker:'VOD.L', name:'Vodafone' },{ ticker:'ITV.L', name:'ITV' },{ ticker:'WPP.L', name:'WPP' },{ ticker:'REL.L', name:'RELX' },{ ticker:'INF.L', name:'Informa' },{ ticker:'FUTR.L', name:'Future plc' },{ ticker:'RMV.L', name:'Rightmove' },{ ticker:'MONY.L', name:'Moneysupermarket' },{ ticker:'PAGE.L', name:'PageGroup' }],
    cons_discretionary: [{ ticker:'JD.L', name:'JD Sports Fashion' },{ ticker:'NXT.L', name:'Next' },{ ticker:'MKS.L', name:'Marks & Spencer' },{ ticker:'BRBY.L', name:'Burberry' },{ ticker:'KGF.L', name:'Kingfisher' },{ ticker:'FLTR.L', name:'Flutter Entertainment' },{ ticker:'IHG.L', name:'InterContinental Hotels' },{ ticker:'ENT.L', name:'Entain' },{ ticker:'WTB.L', name:'Whitbread' },{ ticker:'ASC.L', name:'ASOS' }],
    cons_staples:       [{ ticker:'ULVR.L', name:'Unilever' },{ ticker:'DGE.L', name:'Diageo' },{ ticker:'RKT.L', name:'Reckitt Benckiser' },{ ticker:'ABF.L', name:'Associated British Foods' },{ ticker:'IMB.L', name:'Imperial Brands' },{ ticker:'BATS.L', name:'British American Tobacco' },{ ticker:'TSCO.L', name:'Tesco' },{ ticker:'SBRY.L', name:'Sainsbury\'s' },{ ticker:'BVIC.L', name:'Britvic' },{ ticker:'CWK.L', name:'Cranswick' }],
    energy:             [{ ticker:'BP.L', name:'BP' },{ ticker:'SHEL.L', name:'Shell' },{ ticker:'CNA.L', name:'Centrica' },{ ticker:'DRX.L', name:'Drax Group' },{ ticker:'SSE.L', name:'SSE' },{ ticker:'HBR.L', name:'Harbour Energy' },{ ticker:'ENOG.L', name:'Energean' },{ ticker:'SQZ.L', name:'Serica Energy' },{ ticker:'ITH.L', name:'Ithaca Energy' },{ ticker:'FTI.L', name:'TechnipFMC' }],
    financial:          [{ ticker:'HSBA.L', name:'HSBC Holdings' },{ ticker:'BARC.L', name:'Barclays' },{ ticker:'LLOY.L', name:'Lloyds Banking Group' },{ ticker:'NWG.L', name:'NatWest Group' },{ ticker:'STAN.L', name:'Standard Chartered' },{ ticker:'PRU.L', name:'Prudential' },{ ticker:'LGEN.L', name:'Legal & General' },{ ticker:'AV.L', name:'Aviva' },{ ticker:'HL.L', name:'Hargreaves Lansdown' },{ ticker:'SDR.L', name:'Schroders' }],
    healthcare:         [{ ticker:'AZN.L', name:'AstraZeneca' },{ ticker:'GSK.L', name:'GSK' },{ ticker:'SN.L', name:'Smith & Nephew' },{ ticker:'HIK.L', name:'Hikma Pharmaceuticals' },{ ticker:'CTEC.L', name:'ConvaTec' },{ ticker:'HLN.L', name:'Haleon' },{ ticker:'GNS.L', name:'Genus' },{ ticker:'DPH.L', name:'Dechra Pharmaceuticals' },{ ticker:'OXB.L', name:'Oxford Biomedica' },{ ticker:'INDV.L', name:'Indivior' }],
    industrials:        [{ ticker:'RR.L', name:'Rolls-Royce Holdings' },{ ticker:'BA.L', name:'BAE Systems' },{ ticker:'BAB.L', name:'Babcock International' },{ ticker:'MRO.L', name:'Melrose Industries' },{ ticker:'IMI.L', name:'IMI' },{ ticker:'SPX.L', name:'Spirax-Sarco Engineering' },{ ticker:'WEIR.L', name:'Weir Group' },{ ticker:'RSW.L', name:'Renishaw' },{ ticker:'MGAM.L', name:'Morgan Advanced Materials' },{ ticker:'SFR.L', name:'Severfield' }],
    real_estate:        [{ ticker:'BLND.L', name:'British Land' },{ ticker:'LAND.L', name:'Land Securities' },{ ticker:'SGRO.L', name:'Segro' },{ ticker:'HMSO.L', name:'Hammerson' },{ ticker:'BBOX.L', name:'Tritax Big Box REIT' },{ ticker:'DLN.L', name:'Derwent London' },{ ticker:'GRI.L', name:'Grainger' },{ ticker:'LMP.L', name:'LondonMetric Property' },{ ticker:'PHP.L', name:'Primary Health Properties' },{ ticker:'AGR.L', name:'Assura' }],
    basic_materials:    [{ ticker:'RIO.L', name:'Rio Tinto' },{ ticker:'BHP.L', name:'BHP Group' },{ ticker:'AAL.L', name:'Anglo American' },{ ticker:'GLEN.L', name:'Glencore' },{ ticker:'ANTO.L', name:'Antofagasta' },{ ticker:'FRES.L', name:'Fresnillo' },{ ticker:'JMAT.L', name:'Johnson Matthey' },{ ticker:'ELM.L', name:'Elementis' },{ ticker:'VCT.L', name:'Victrex' },{ ticker:'MNDI.L', name:'Mondi' }],
    utilities:          [{ ticker:'NG.L', name:'National Grid' },{ ticker:'SSE.L', name:'SSE' },{ ticker:'CNA.L', name:'Centrica' },{ ticker:'UU.L', name:'United Utilities' },{ ticker:'SVT.L', name:'Severn Trent' },{ ticker:'PNN.L', name:'Pennon Group' },{ ticker:'DRX.L', name:'Drax Group' },{ ticker:'UKW.L', name:'Greencoat UK Wind' },{ ticker:'TRIG.L', name:'Renewables Infrastructure Group' },{ ticker:'NESF.L', name:'NextEnergy Solar Fund' }],
  },
};
