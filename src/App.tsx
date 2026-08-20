import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Globe,
  TrendingUp,
  ShieldAlert,
  Zap,
  ArrowRight,
  Info,
  Activity,
  BarChart3,
  Layers,
  X,
  ArrowUpRight,
  ArrowDownLeft,
  Sun,
  Moon,
  ChevronDown,
} from 'lucide-react';
import { SCENARIOS, GEO_POINTS, MarketScenario, GeoPoint, DEFAULT_PRICES, MarketPrices } from './data';
import { WorldMap, SECTORS, getSectorData } from './components/WorldMap';
import { fetchLiveMarketGravity } from './services/geminiService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function deriveSectorComponents(masa: number, distancia: number) {
  // MASA: M = w1×Return + w2×Growth + w3×Liquidity + w4×Confidence
  // Return   = PriceReturn×0.4 + Momentum×0.3 + EarningsYield×0.3
  // Growth   = EPSGrowth×0.5 + ROE×0.3 + DivYield×0.2
  // Liquidity= Volume×0.5 + MarketCap×0.3 + DivYield×0.2
  // Confidence= Momentum×0.4 + ROE×0.3 + CreditRating×0.3
  const retorno        = Math.round(masa * 0.90);   // Return proxy
  const crecimiento    = Math.round(masa * 0.85);   // Growth proxy
  const liquidezActivo = Math.round(masa * 1.05);   // Liquidity proxy
  const confianza      = 4 * masa - retorno - crecimiento - liquidezActivo; // Confidence

  // DISTANCIA: r = Volatilidad + Spread + (1-ρ)×30
  // Volatilidad = VIX×annualRange + HistVol + MOVE
  // Spread      = HYGstress×regimeMult + CDSproxy + CPI×0.5 + Rates + PoliticalRisk
  const correlacion = parseFloat(Math.max(0.20, Math.min(0.95, 1 - distancia / 160)).toFixed(2));
  const volatilidad = Math.round(distancia * 0.85);
  const spread      = Math.round(distancia * 0.65);
  const rawSum      = parseFloat((volatilidad + spread + (1 - correlacion) * 30).toFixed(1));

  // FRICCION: F = BidAsk + TxCost + CapCtrl + Slippage - LiqBonus
  const profundidad   = Math.round(Math.min(92, Math.max(75, masa * 0.15 + 75)));
  const remainder     = profundidad - 70;
  const bidAskSpread  = Math.max(1, Math.round(remainder * 0.55));
  const restricciones = Math.max(1, remainder - bidAskSpread);

  return {
    masaComponents:      { retorno, crecimiento, liquidezActivo, confianza },
    distanciaComponents: { volatilidad, spread, correlacion, rawSum },
    friccionComponents:  { bidAskSpread, restricciones, profundidad },
  };
}

export default function App() {
  const [activeScenario, setActiveScenario] = useState<MarketScenario>(SCENARIOS[0]);
  const [marketPrices, setMarketPrices] = useState<MarketPrices>(DEFAULT_PRICES);
  const [isLiveLoading, setIsLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<MarketScenario[]>(SCENARIOS);
  const [selectedPoint, setSelectedPoint] = useState<GeoPoint | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);
  const [expandedSectorField, setExpandedSectorField] = useState<{ sectorId: string; field: 'masa' | 'distancia' | 'friccion' } | null>(null);
  const [darkMode, setDarkMode] = useState(true);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [formulasOpen, setFormulasOpen] = useState(false);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
    }
  }, [darkMode]);

  const activeScenarioRef = useRef(activeScenario);
  useEffect(() => { activeScenarioRef.current = activeScenario; }, [activeScenario]);

  const handlePointClick = useCallback((point: GeoPoint) => {
    setSelectedPoint(point);
    setSelectedSectorId(null);
  }, []);

  const handleCountrySelect = useCallback((name: string | null) => {
    setSelectedCountry(name);
    if (!name) setSelectedSectorId(null);
  }, []);

  const handleSectorClick = useCallback((sectorId: string) => {
    setSelectedSectorId(sectorId);
    setSelectedPoint(null);
  }, []);

  useEffect(() => {
    handleFetchLive();
    
    // Fetch prices from Yahoo Finance every hour
    const fetchPrices = async () => {
      try {
        const response = await fetch('/api/prices');
        if (response.ok) {
          const prices = await response.json();
          setMarketPrices(prices);
        }
      } catch (error) {
        console.error("Failed to fetch prices from Yahoo Finance", error);
      }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 15 * 60 * 1000); // 15 minutes
    
    return () => clearInterval(interval);
  }, []);

  const handleFetchLive = async (force = false) => {
    setIsLiveLoading(true);
    setLiveError(null);
    try {
      const liveScenario = await fetchLiveMarketGravity(force);
      
      // Fetch fresh prices from Yahoo Finance
      const priceResponse = await fetch('/api/prices');
      if (priceResponse.ok) {
        const freshPrices = await priceResponse.json();
        setMarketPrices(freshPrices);
        liveScenario.prices = freshPrices;
      } else if (liveScenario.prices) {
        setMarketPrices(liveScenario.prices);
      }

      // Add or update the live scenario in the list
      setScenarios(prev => {
        const filtered = prev.filter(s => s.id !== 'live' && s.id !== 'current');
        return [liveScenario, ...filtered];
      });
      setActiveScenario(liveScenario);
    } catch (error) {
      console.error("Failed to fetch live data", error);
      const msg = error instanceof Error ? error.message : String(error);
      setLiveError(msg);
      setScenarios(prev => prev.filter(s => s.id !== 'current'));
      if (activeScenarioRef.current.id === 'current') {
        const hawkish = SCENARIOS.find(s => s.id === 'hawkish') ?? SCENARIOS[0];
        setActiveScenario(hawkish);
      }
    } finally {
      setIsLiveLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-accent/30 selection:text-accent">
      {/* Header */}
      <header className="border-b border-border h-16 flex items-center px-8 justify-between glass sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-accent/20 flex items-center justify-center border border-accent/30">
            <Globe className="w-5 h-5 text-accent" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tighter uppercase">Capital Gravity</h1>
              {activeScenario.id === 'live' && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20">
                  <div className="w-1 h-1 rounded-full bg-accent animate-pulse" />
                  <span className="text-[7px] font-mono text-accent uppercase tracking-widest">Live News Feed</span>
                </div>
              )}
            </div>
            <p className="text-[10px] font-mono text-ink/40 uppercase tracking-widest">Motor de Flujo de Liquidez Global v1.0</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <button 
            onClick={() => handleFetchLive(true)}
            disabled={isLiveLoading}
            className={cn(
              "flex items-center gap-2 px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all",
              isLiveLoading 
                ? "bg-ink/10 text-ink/40 cursor-not-allowed" 
                : "bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30"
            )}
          >
            {isLiveLoading ? (
              <Activity className="w-3 h-3 animate-spin" />
            ) : (
              <Zap className="w-3 h-3" />
            )}
            {isLiveLoading ? 'Analizando Mercados...' : 'Analizar Realidad en Tiempo Real'}
          </button>
          {liveError && (
            <span
              className="text-[9px] font-mono text-danger truncate max-w-[220px]"
              title={liveError}
            >
              Error: {liveError.slice(0, 60)}
            </span>
          )}
          <div className="hidden md:flex items-center gap-4 text-[10px] font-mono text-ink/60">
            <div className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-accent" />
              <span>FEED EN VIVO: ACTIVO</span>
            </div>
            {activeScenario.lastUpdated && (
              <div className="flex items-center gap-1.5 border-l border-ink/10 pl-4">
                <span className="text-ink/40">SINC:</span>
                <span className="text-ink/80">
                  {new Date(activeScenario.lastUpdated).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-accent" />
              <span>CAPAS: MULTI-ACTIVO</span>
            </div>
          </div>
          <button
            onClick={() => setDarkMode(d => !d)}
            className="p-2 rounded border border-border hover:border-accent/40 hover:bg-accent/5 transition-all"
            title={darkMode ? 'Modo claro' : 'Modo oscuro'}
          >
            {darkMode ? <Sun className="w-4 h-4 text-ink/60" /> : <Moon className="w-4 h-4 text-ink/60" />}
          </button>
          <button className="px-4 py-1.5 rounded bg-accent text-bg text-[10px] font-bold uppercase tracking-widest hover:bg-accent/90 transition-colors">
            Conectar Wallet
          </button>
        </div>
      </header>

      <main className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1600px] mx-auto">
        {/* Sidebar - Scenarios */}
        <div className="lg:col-span-3 space-y-6">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-mono text-ink/40 uppercase tracking-widest flex items-center gap-2">
                <Zap className="w-3 h-3" />
                Escenarios de Mercado
                {isLiveLoading && (
                  <motion.span 
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="text-[8px] text-accent ml-2"
                  >
                    (Sincronizando...)
                  </motion.span>
                )}
              </h2>
            </div>
            
            <div className="relative">
              {/* Trigger */}
              <button
                onClick={() => setScenarioOpen(o => !o)}
                className={cn(
                  "w-full p-3 rounded-lg border text-left transition-all duration-200 flex items-center justify-between gap-2",
                  (activeScenario.id === 'live' || activeScenario.id === 'current')
                    ? "bg-accent/10 border-accent/40"
                    : "bg-surface/40 border-border hover:border-ink/20"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {activeScenario.id === 'crisis' && <ShieldAlert className="w-3 h-3 text-danger shrink-0" />}
                  {activeScenario.id === 'hawkish' && <TrendingUp className="w-3 h-3 text-accent shrink-0" />}
                  <span className="text-xs font-bold uppercase tracking-tight text-accent truncate">
                    {activeScenario.name}
                  </span>
                  {(activeScenario.id === 'live' || activeScenario.id === 'current') && (
                    <span className="px-1.5 py-0.5 rounded bg-accent text-bg text-[8px] font-bold animate-pulse shrink-0">
                      {activeScenario.id === 'current' && isLiveLoading ? 'ANALIZANDO' : 'LIVE'}
                    </span>
                  )}
                </div>
                <ChevronDown className={cn("w-3 h-3 text-ink/40 shrink-0 transition-transform duration-200", scenarioOpen && "rotate-180")} />
              </button>

              {/* Dropdown */}
              <AnimatePresence>
                {scenarioOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute z-30 top-full mt-1 w-full rounded-lg border border-border bg-bg/95 backdrop-blur shadow-xl overflow-y-auto max-h-[80vh] custom-scrollbar"
                  >
                    {scenarios.map((scenario) => (
                      <button
                        key={scenario.id}
                        onClick={() => { setActiveScenario(scenario); setScenarioOpen(false); }}
                        className={cn(
                          "w-full p-3 text-left transition-colors duration-150 border-b border-ink/5 last:border-0",
                          activeScenario.id === scenario.id
                            ? "bg-accent/10"
                            : "hover:bg-ink/5"
                        )}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {scenario.id === 'crisis' && <ShieldAlert className="w-3 h-3 text-danger shrink-0" />}
                          {scenario.id === 'hawkish' && <TrendingUp className="w-3 h-3 text-accent shrink-0" />}
                          <span className={cn(
                            "text-[11px] font-bold uppercase tracking-tight",
                            activeScenario.id === scenario.id ? "text-accent" : "text-ink/80"
                          )}>
                            {scenario.name}
                          </span>
                          {(scenario.id === 'live' || scenario.id === 'current') && (
                            <span className="px-1 py-0.5 rounded bg-accent text-bg text-[7px] font-bold animate-pulse">
                              {scenario.id === 'current' && isLiveLoading ? 'ANALIZANDO' : 'LIVE'}
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] text-ink/35 leading-snug font-mono line-clamp-3">
                          {scenario.id === 'live'
                            ? scenario.description.split('\n').filter(Boolean)[0] ?? scenario.description
                            : scenario.description}
                        </p>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* AI analysis box — only for live scenario */}
            {activeScenario.description && (
              <div className="p-3 rounded-lg border border-ink/10 bg-surface/40 max-h-[28vh] overflow-y-auto custom-scrollbar">
                {activeScenario.description.split('\n').filter(Boolean).map((line, i) => (
                  <p key={i} className="text-[9px] font-mono text-ink/60 leading-relaxed mb-2 last:mb-0">
                    {line}
                  </p>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-surface/20">
            <button
              onClick={() => setFormulasOpen(o => !o)}
              className="w-full p-4 flex items-center justify-between text-left"
            >
              <h2 className="text-[11px] font-mono text-ink/40 uppercase tracking-widest flex items-center gap-2">
                <Activity className="w-3 h-3" />
                Leyes de Gravedad Financiera
              </h2>
              <ChevronDown className={cn("w-3 h-3 text-ink/40 shrink-0 transition-transform duration-200", formulasOpen && "rotate-180")} />
            </button>
            {formulasOpen && <div className="px-4 pb-4 space-y-4">
              <div className="space-y-2">
                <span className="text-[8px] font-mono text-ink/30 uppercase tracking-widest block">Fuerza Gravitacional</span>
                <div className="p-3 rounded bg-surface/60 border border-ink/5 text-center">
                  <p className="text-[10px] font-mono text-accent font-bold">
                    G = (M − d) / f
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 text-[9px] font-mono">
                {/* MASA */}
                <div className="space-y-1 border-b border-ink/5 pb-2">
                  <div className="flex justify-between">
                    <span className="text-accent font-bold">MASA (M)</span>
                    <span className="text-ink/50">Atractivo del activo [0–100]</span>
                  </div>
                  <p className="text-[7px] font-mono text-ink/30 italic leading-tight">
                    M = w1×Return + w2×Growth + w3×Liquidity + w4×Confidence
                  </p>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[7px] text-ink/30">
                    <span>Return = PriceRet×0.20 + Mom×0.20</span>
                    <span>+ DailyRet×0.30 + E/P×0.30</span>
                    <span>Growth  = EPS×0.50 + ROE×0.30</span>
                    <span>+ DivYield×0.20</span>
                    <span>Liquid. = Vol×0.50 + MktCap×0.30</span>
                    <span>+ DivYield×0.20</span>
                    <span>Confid. = Mom×0.40 + ROE×0.30</span>
                    <span>+ CreditRtg×0.30</span>
                  </div>
                </div>

                {/* DISTANCIA */}
                <div className="space-y-1 border-b border-ink/5 pb-2">
                  <div className="flex justify-between">
                    <span className="text-danger font-bold">DISTANCIA (d)</span>
                    <span className="text-ink/50">Riesgo / Barreras [0–100]</span>
                  </div>
                  <p className="text-[7px] font-mono text-ink/30 italic leading-tight">
                    d = Volat. + Spread + (1−ρ)×30
                  </p>
                  <div className="grid grid-cols-1 gap-y-0.5 text-[7px] text-ink/30">
                    <span>Volat.  = VIX×rango52s + HistVol + MOVE</span>
                    <span>Spread = HYGstress + CDSproxy + CPI×0.5</span>
                    <span>        + Rates + PoliticalRisk</span>
                    <span>ρ = correlación con activo de referencia</span>
                  </div>
                </div>

                {/* FRICCIÓN */}
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-bold">FRICCIÓN (f)</span>
                    <span className="text-ink/50">Costos / Liquidez [1–100]</span>
                  </div>
                  <p className="text-[7px] font-mono text-ink/30 italic leading-tight">
                    f = BidAsk + TxCost + CapCtrl + Slippage
                  </p>
                  <div className="grid grid-cols-1 gap-y-0.5 text-[7px] text-ink/30">
                    <span>BidAsk   = (ask−bid) / P</span>
                    <span>TxCost+CapCtrl = costos regulatorios</span>
                    <span>Slippage = 1 / MktCap (profundidad)</span>
                  </div>
                </div>
              </div>

              {/* ── Robustez Sectorial ───────────────────────────────────── */}
              <div className="space-y-3 pt-2 border-t border-ink/5">
                <span className="text-[8px] font-mono text-ink/30 uppercase tracking-widest block">Robustez Sectorial</span>

                <div className="grid grid-cols-1 gap-3 text-[9px] font-mono">
                  {/* Presión institucional */}
                  <div className="space-y-1 border-b border-ink/5 pb-2">
                    <div className="flex justify-between">
                      <span className="text-yellow-400 font-bold">Presión Institucional</span>
                      <span className="text-ink/50">Flujo sectorial [−100,100]</span>
                    </div>
                    <p className="text-[7px] font-mono text-ink/30 italic leading-tight">
                      P = PrecioVol×0.40 + Opciones×0.60
                    </p>
                    <div className="grid grid-cols-1 gap-y-0.5 text-[7px] text-ink/30">
                      <span>PrecioVol = momentum(MA50) + volSurge + Δ%diario</span>
                      <span>Opciones  = GEX neto / PCR (Black-Scholes γ)</span>
                      <span>γ = N′(d₁) / (S·σ·√T)  donde d₁ = (ln S/K + (r+σ²/2)T) / σ√T</span>
                      <span>GEX = Σ(γ·OI·100·S²/100) calls − puts</span>
                    </div>
                  </div>

                  {/* Fuerza ajustada por país */}
                  <div className="space-y-1 border-b border-ink/5 pb-2">
                    <div className="flex justify-between">
                      <span className="text-accent font-bold">Fuerza G Ajustada (Sector)</span>
                      <span className="text-ink/50">Centro de gravedad</span>
                    </div>
                    <p className="text-[7px] font-mono text-ink/30 italic leading-tight">
                      G_adj = (M−d) + clamp(P/5,−15,15)×domFactor
                    </p>
                    <div className="grid grid-cols-1 gap-y-0.5 text-[7px] text-ink/30">
                      <span>domFactor = peso estructural del sector en cada economía</span>
                      <span>Centro G: G_adj ≥ media + 0.5σ del escenario</span>
                    </div>
                  </div>

                  {/* ETFs por país */}
                  <div className="space-y-1 border-b border-ink/5 pb-2">
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold">ETFs / Índices por País G7</span>
                      <span className="text-ink/50">Señal precio local</span>
                    </div>
                    <p className="text-[7px] font-mono text-ink/30 italic leading-tight">
                      P_país = PrecioVol(ticker_local)×0.60 + Opciones(ETF_US)×0.40
                    </p>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[7px] text-ink/30">
                      <span>Canadá  → XIT/XEG/XFN.TO</span>
                      <span>Alemania→ SAP/SIE/DBK.DE</span>
                      <span>Francia → CAP/MC/BNP.PA</span>
                      <span>Italia  → STM/ISP/ENI.MI</span>
                      <span>Japón   → Sony/Toyota/MUFG.T</span>
                      <span>RU      → HSBA/AZN/BP.L</span>
                    </div>
                  </div>

                  {/* Régimen macro */}
                  <div className="space-y-1 border-b border-ink/5 pb-2">
                    <div className="flex justify-between">
                      <span className="text-danger font-bold">Régimen Macro</span>
                      <span className="text-ink/50">Ajuste VIX + noticias</span>
                    </div>
                    <p className="text-[7px] font-mono text-ink/30 italic leading-tight">
                      régimen = VIX_base + Δsentimiento_noticias
                    </p>
                    <div className="grid grid-cols-1 gap-y-0.5 text-[7px] text-ink/30">
                      <span>VIX &lt; 15 → RISK-ON   | VIX 15–20 → NEUTRAL</span>
                      <span>VIX 20–30 → RISK-OFF  | VIX &gt; 30 → CRISIS</span>
                      <span>Score noticias [-3,+3] puede desplazar un nivel</span>
                    </div>
                  </div>

                  {/* Sentimiento noticias */}
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold">Sentimiento (Noticias)</span>
                      <span className="text-ink/50">Yahoo + Investing.com</span>
                    </div>
                    <p className="text-[7px] font-mono text-ink/30 italic leading-tight">
                      score = Σ keywords alcistas − Σ keywords bajistas
                    </p>
                    <div className="grid grid-cols-1 gap-y-0.5 text-[7px] text-ink/30">
                      <span>Alcista: rally, surge, bullish, recovery…  (+1 c/u)</span>
                      <span>Bajista: crash, recession, bearish, sell-off… (−1 c/u)</span>
                      <span>score &gt; 0.5 → ALCISTA | &lt; −0.5 → BAJISTA</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-ink/5">
                <span className="text-[8px] font-mono text-ink/30 uppercase tracking-widest block">Clasificación de Fuerza G</span>
                <p className="text-[7px] font-mono text-ink/25 italic leading-tight">
                  Umbral = media ± 0.5σ del escenario activo
                </p>
                {(() => {
                  const metricVals = Object.values(activeScenario.metrics ?? {});
                  if (metricVals.length === 0) return null;

                  // Activos: G = (M−d)/f
                  const aForces = metricVals.map(m => (m.masa - m.distancia) / Math.max(1, m.friccion));
                  const aMean   = aForces.reduce((a, b) => a + b, 0) / aForces.length;
                  const aSigma  = Math.sqrt(aForces.reduce((a, b) => a + (b - aMean) ** 2, 0) / aForces.length);
                  const aHigh   = aMean + 0.5 * aSigma;
                  const aLow    = aMean - 0.5 * aSigma;

                  // Sectores: G = M−d (sin friccion en nodo sectorial)
                  const sForces = metricVals.map(m => m.masa - m.distancia);
                  const sMean   = sForces.reduce((a, b) => a + b, 0) / sForces.length;
                  const sSigma  = Math.sqrt(sForces.reduce((a, b) => a + (b - sMean) ** 2, 0) / sForces.length);
                  const sHigh   = sMean + 0.5 * sSigma;
                  const sLow    = sMean - 0.5 * sSigma;

                  const TierRow = ({ label, high, low, color }: { label: string; high: number; low: number; color: string }) => (
                    <div className="grid grid-cols-3 gap-1 text-[7px] font-mono">
                      <div className={`p-1 rounded text-center border ${color === 'green' ? 'bg-green-500/10 border-green-500/30' : color === 'slate' ? 'bg-slate-600/20 border-slate-600/30' : 'bg-red-500/10 border-red-500/20'}`}>
                        <span className={color === 'green' ? 'text-green-400' : color === 'slate' ? 'text-slate-400' : 'text-red-400'}>
                          {label === 'Alta' ? `≥ ${high.toFixed(1)}` : label === 'Baja' ? `≤ ${low.toFixed(1)}` : `${low.toFixed(1)}–${high.toFixed(1)}`}
                        </span>
                      </div>
                    </div>
                  );

                  return (
                    <div className="space-y-2">
                      {/* Activos del mundo — G = M−d (escala absoluta) */}
                      <div className="space-y-1">
                        <span className="text-[7px] font-mono text-ink/30 uppercase tracking-wider block">Activos — G=M−d</span>
                        <div className="grid grid-cols-3 gap-1 text-[7px] font-mono">
                          <div className="p-1.5 rounded bg-green-500/10 border border-green-500/30 text-center space-y-0.5">
                            <div className="text-green-400 font-bold">Alta</div>
                            <div className="text-green-400/70">≥ {sHigh.toFixed(1)}</div>
                          </div>
                          <div className="p-1.5 rounded bg-slate-600/20 border border-slate-600/30 text-center space-y-0.5">
                            <div className="text-slate-400 font-bold">Media</div>
                            <div className="text-slate-400/70">{sLow.toFixed(1)}–{sHigh.toFixed(1)}</div>
                          </div>
                          <div className="p-1.5 rounded bg-red-500/10 border border-red-500/20 text-center space-y-0.5">
                            <div className="text-red-400 font-bold">Baja</div>
                            <div className="text-red-400/70">≤ {sLow.toFixed(1)}</div>
                          </div>
                        </div>
                      </div>
                      {/* Sectores — G = (M−d)/f (normalizado por friccion) */}
                      <div className="space-y-1">
                        <span className="text-[7px] font-mono text-ink/30 uppercase tracking-wider block">Sectores — G=(M−d)/f</span>
                        <div className="grid grid-cols-3 gap-1 text-[7px] font-mono">
                          <div className="p-1.5 rounded bg-green-500/10 border border-green-500/30 text-center space-y-0.5">
                            <div className="text-green-400 font-bold">Alta</div>
                            <div className="text-green-400/70">≥ {aHigh.toFixed(2)}</div>
                          </div>
                          <div className="p-1.5 rounded bg-slate-600/20 border border-slate-600/30 text-center space-y-0.5">
                            <div className="text-slate-400 font-bold">Media</div>
                            <div className="text-slate-400/70">{aLow.toFixed(2)}–{aHigh.toFixed(2)}</div>
                          </div>
                          <div className="p-1.5 rounded bg-red-500/10 border border-red-500/20 text-center space-y-0.5">
                            <div className="text-red-400 font-bold">Baja</div>
                            <div className="text-red-400/70">≤ {aLow.toFixed(2)}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>}
          </section>

        </div>

        {/* Main Content - Map */}
        <div className="lg:col-span-6 space-y-6">
          <div className="h-[600px] relative">
            <WorldMap
              scenario={activeScenario}
              geoPoints={GEO_POINTS}
              theme={darkMode ? 'dark' : 'light'}
              onPointClick={handlePointClick}
              onCountrySelect={handleCountrySelect}
              onSectorClick={handleSectorClick}
            />
            
            {/* Sector Drill-down Overlay */}
            <AnimatePresence>
              {selectedSectorId && selectedCountry && (() => {
                const { nodes, flows } = getSectorData(activeScenario.id, activeScenario.macroRegime, activeScenario.sectorData, selectedCountry ?? undefined, activeScenario.countrySectorData);
                const node = nodes.find(n => n.id === selectedSectorId);
                const sector = SECTORS.find(s => s.id === selectedSectorId);
                if (!node || !sector) return null;
                const fuerza = (node.masa - node.distancia) / 10;
                const comps = deriveSectorComponents(node.masa, node.distancia);
                const outFlows = flows.filter(f => f.from === selectedSectorId);
                const inFlows = flows.filter(f => f.to === selectedSectorId);
                return (
                  <motion.div
                    key="sector-overlay"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="absolute top-4 left-4 glass p-6 rounded-xl w-[300px] z-20 max-h-[90vh] overflow-y-auto custom-scrollbar"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className={cn('w-2 h-2 rounded-full', node.isGravityCenter ? 'bg-accent animate-pulse' : 'bg-ink/20')} />
                        <h3 className="text-sm font-bold uppercase tracking-tight">{sector.fullName}</h3>
                      </div>
                      <button onClick={() => setSelectedSectorId(null)} className="p-1 hover:bg-ink/10 rounded transition-colors">
                        <X className="w-4 h-4 text-ink/40" />
                      </button>
                    </div>
                    <div className="space-y-4">
                      <div className="flex justify-between text-[10px] font-mono">
                        <span className="text-ink/40 uppercase">Estado</span>
                        <span className={node.isGravityCenter ? 'text-accent' : 'text-ink/40'}>
                          {node.isGravityCenter ? 'Centro Activo' : 'Sector Secundario'}
                        </span>
                      </div>
                      <div className="pt-3 border-t border-ink/5 space-y-3">
                        <h4 className="text-[9px] font-mono text-ink/40 uppercase tracking-widest flex items-center gap-1">
                          <Zap className="w-3 h-3" />Desglose de Gravedad
                        </h4>
                        <div className="space-y-1">
                          {/* MASA */}
                          <button
                            className="w-full flex items-center justify-between text-[9px] font-mono rounded px-1 -mx-1 py-1 hover:bg-ink/5 transition-colors"
                            onClick={() => setExpandedSectorField(prev => prev?.sectorId === selectedSectorId && prev.field === 'masa' ? null : { sectorId: selectedSectorId!, field: 'masa' })}
                          >
                            <span className="text-ink/60">MASA (Atractivo)</span>
                            <span className="text-accent">{node.masa}</span>
                          </button>
                          {expandedSectorField?.sectorId === selectedSectorId && expandedSectorField.field === 'masa' && (
                            <div className="bg-ink/5 rounded p-2 mb-1 space-y-1.5">
                              <p className="text-[7px] font-mono text-ink/30 italic">M = w1×Return + w2×Growth + w3×Liquidity + w4×Confidence</p>
                              <div className="grid grid-cols-2 gap-1">
                                {([
                                  { label: 'Return (52s+E/P+Mom)', val: comps.masaComponents.retorno, color: 'bg-accent' },
                                  { label: 'Growth (EPS+ROE+Div)', val: comps.masaComponents.crecimiento, color: 'bg-accent/70' },
                                  { label: 'Liquidity (Vol+Cap+Div)', val: comps.masaComponents.liquidezActivo, color: 'bg-accent/50' },
                                  { label: 'Confidence (Mom+ROE+Rating)', val: comps.masaComponents.confianza, color: 'bg-accent/30' },
                                ] as const).map(item => (
                                  <div key={item.label} className="space-y-0.5">
                                    <div className="flex justify-between text-[7px] font-mono">
                                      <span className="text-ink/40">{item.label}</span>
                                      <span className="text-ink/60">{item.val}</span>
                                    </div>
                                    <div className="h-0.5 bg-ink/10 rounded-full overflow-hidden">
                                      <div className={`h-full ${item.color}`} style={{ width: `${Math.min(100, item.val)}%` }} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <p className="text-[7px] font-mono text-accent/50 text-right">
                                = 0.25×({comps.masaComponents.retorno}+{comps.masaComponents.crecimiento}+{comps.masaComponents.liquidezActivo}+{comps.masaComponents.confianza}) = {node.masa}
                              </p>
                            </div>
                          )}
                          {/* DISTANCIA */}
                          <button
                            className="w-full flex items-center justify-between text-[9px] font-mono rounded px-1 -mx-1 py-1 hover:bg-ink/5 transition-colors"
                            onClick={() => setExpandedSectorField(prev => prev?.sectorId === selectedSectorId && prev.field === 'distancia' ? null : { sectorId: selectedSectorId!, field: 'distancia' })}
                          >
                            <span className="text-ink/60">DISTANCIA (Riesgo)</span>
                            <span className="text-danger">{node.distancia}</span>
                          </button>
                          {expandedSectorField?.sectorId === selectedSectorId && expandedSectorField.field === 'distancia' && (
                            <div className="bg-ink/5 rounded p-2 mb-1 space-y-1.5">
                              <p className="text-[7px] font-mono text-ink/30 italic">r = Volat.(VIX+MOVE+Hist) + Spread(HYG+CDS+CPI+Rates+PolRisk) + (1-ρ)×30</p>
                              <div className="grid grid-cols-3 gap-1">
                                {([
                                  { label: 'Volat.VIX+MOVE', val: comps.distanciaComponents.volatilidad, color: 'bg-danger/80' },
                                  { label: 'Spread HYG+Risk', val: comps.distanciaComponents.spread,      color: 'bg-danger/60' },
                                  { label: '(1-ρ)×30',        val: Math.round((1 - comps.distanciaComponents.correlacion) * 30), color: 'bg-danger/40' },
                                ] as const).map(item => (
                                  <div key={item.label} className="space-y-0.5">
                                    <div className="flex justify-between text-[7px] font-mono">
                                      <span className="text-ink/40">{item.label}</span>
                                      <span className="text-ink/60">{item.val}</span>
                                    </div>
                                    <div className="h-0.5 bg-ink/10 rounded-full overflow-hidden">
                                      <div className={`h-full ${item.color}`} style={{ width: `${item.val}%` }} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <p className="text-[7px] font-mono text-danger/50 text-right">
                                r_raw={comps.distanciaComponents.rawSum} → ρ={comps.distanciaComponents.correlacion} → norm={node.distancia}
                              </p>
                            </div>
                          )}
                          {/* FRICCIÓN */}
                          <button
                            className="w-full flex items-center justify-between text-[9px] font-mono rounded px-1 -mx-1 py-1 hover:bg-ink/5 transition-colors"
                            onClick={() => setExpandedSectorField(prev => prev?.sectorId === selectedSectorId && prev.field === 'friccion' ? null : { sectorId: selectedSectorId!, field: 'friccion' })}
                          >
                            <span className="text-ink/60">FRICCIÓN (Liquidez)</span>
                            <span className="text-ink/40">10</span>
                          </button>
                          {expandedSectorField?.sectorId === selectedSectorId && expandedSectorField.field === 'friccion' && (
                            <div className="bg-ink/5 rounded p-2 mb-1 space-y-1.5">
                              <p className="text-[7px] font-mono text-ink/30 italic">F = BidAsk + TxCost + CapCtrl + Slippage - LiqBonus</p>
                              <div className="grid grid-cols-3 gap-1">
                                {([
                                  { label: 'Bid-Ask (ask-bid/P)', val: comps.friccionComponents.bidAskSpread, color: 'bg-ink/30' },
                                  { label: 'TxCost+CapCtrl',      val: comps.friccionComponents.restricciones, color: 'bg-ink/20' },
                                  { label: 'Slippage(MktCap)',    val: comps.friccionComponents.profundidad,   color: 'bg-accent/20' },
                                ] as const).map(item => (
                                  <div key={item.label} className="space-y-0.5">
                                    <div className="flex justify-between text-[7px] font-mono">
                                      <span className="text-ink/40">{item.label}</span>
                                      <span className="text-ink/60">{item.val}</span>
                                    </div>
                                    <div className="h-0.5 bg-ink/10 rounded-full overflow-hidden">
                                      <div className={`h-full ${item.color}`} style={{ width: `${item.val}%` }} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <p className="text-[7px] font-mono text-ink/30 text-right">
                                ({comps.friccionComponents.bidAskSpread}+{comps.friccionComponents.restricciones}+{100 - comps.friccionComponents.profundidad}) / 3 = 10
                              </p>
                            </div>
                          )}
                        </div>
                        <div className="p-2 rounded bg-accent/5 border border-accent/10 text-center">
                          <p className="text-[9px] font-mono text-accent">
                            ({node.masa} - {node.distancia}) / 10 = {fuerza.toFixed(2)}
                          </p>
                        </div>
                      </div>
                      <div className="pt-3 border-t border-ink/5 space-y-3">
                        <div>
                          <h4 className="text-[9px] font-mono text-ink/40 uppercase tracking-widest mb-2 flex items-center gap-1">
                            <ArrowUpRight className="w-3 h-3" />Salida de Capital
                          </h4>
                          <div className="space-y-1.5">
                            {outFlows.length > 0 ? outFlows.map((flow, i) => {
                              const dest = SECTORS.find(s => s.id === flow.to);
                              return (
                                <div key={i} className="p-2 rounded bg-ink/5 border border-ink/5">
                                  <div className="flex justify-between">
                                    <span className="text-[9px] font-mono text-ink/70">Hacia {dest?.fullName ?? flow.to}</span>
                                    <span className="text-[9px] font-mono text-accent">{(flow.strength * 100).toFixed(0)}%</span>
                                  </div>
                                </div>
                              );
                            }) : <p className="text-[9px] font-mono text-ink/20 italic">Sin salidas significativas</p>}
                          </div>
                        </div>
                        <div>
                          <h4 className="text-[9px] font-mono text-ink/40 uppercase tracking-widest mb-2 flex items-center gap-1">
                            <ArrowDownLeft className="w-3 h-3" />Entrada de Capital
                          </h4>
                          <div className="space-y-1.5">
                            {inFlows.length > 0 ? inFlows.map((flow, i) => {
                              const orig = SECTORS.find(s => s.id === flow.from);
                              return (
                                <div key={i} className="p-2 rounded bg-accent/5 border border-accent/10">
                                  <div className="flex justify-between">
                                    <span className="text-[9px] font-mono text-accent">Desde {orig?.fullName ?? flow.from}</span>
                                    <span className="text-[9px] font-mono text-accent">{(flow.strength * 100).toFixed(0)}%</span>
                                  </div>
                                </div>
                              );
                            }) : <p className="text-[9px] font-mono text-ink/20 italic">Sin entradas significativas</p>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })()}
            </AnimatePresence>

            {/* Overlay Info - Selected Point Details */}
            <AnimatePresence>
              {selectedPoint && (
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="absolute top-4 left-4 glass p-6 rounded-xl w-[340px] z-20 max-h-[90vh] overflow-y-auto custom-scrollbar"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        activeScenario.gravityCenters.includes(selectedPoint.id) ? "bg-accent animate-pulse" : "bg-ink/20"
                      )} />
                      <h3 className="text-sm font-bold uppercase tracking-tight">{selectedPoint.name}</h3>
                    </div>
                    <button 
                      onClick={() => setSelectedPoint(null)}
                      className="p-1 hover:bg-ink/10 rounded transition-colors"
                    >
                      <X className="w-4 h-4 text-ink/40" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-ink/40 uppercase">Clasificación</span>
                      <span className="text-ink/80 uppercase">{selectedPoint.type === 'country' ? 'País' : 'Activo'}</span>
                    </div>
                    
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-ink/40 uppercase">Estado de Gravedad</span>
                      <span className={cn(
                        "uppercase",
                        activeScenario.gravityCenters.includes(selectedPoint.id) ? "text-accent" : "text-ink/40"
                      )}>
                        {activeScenario.gravityCenters.includes(selectedPoint.id) ? 'Centro Activo' : 'Mercado Secundario'}
                      </span>
                    </div>

                    {/* Gravity Formula Breakdown */}
                    {activeScenario.metrics?.[selectedPoint.id] && (() => {
                      const m = activeScenario.metrics![selectedPoint.id];
                      const mc = m.masaComponents;
                      const mw = m.masaWeights;
                      const dc = m.distanciaComponents;
                      const fc = m.friccionComponents;
                      const fuerza = m.fuerzaG ?? (m.masa - m.distancia) / Math.max(1, m.friccion);
                      return (
                        <div className="pt-4 border-t border-ink/5 space-y-3">
                          <h4 className="text-[9px] font-mono text-ink/40 uppercase tracking-widest flex items-center gap-1">
                            <Zap className="w-3 h-3" />Desglose de Gravedad
                          </h4>
                          <div className="grid grid-cols-1 gap-3">
                            {/* MASA */}
                            <div className="space-y-1.5">
                              <div className="flex justify-between text-[9px] font-mono">
                                <span className="text-ink/60">MASA (Atractivo)</span>
                                <span className="text-accent">{m.masa.toFixed(1)}</span>
                              </div>
                              {mc && mw ? (
                                <>
                                  <p className="text-[7px] font-mono text-ink/30 italic leading-none">
                                    M = {mw.w1}×Return + {mw.w2}×Growth + {mw.w3}×Liquidity + {mw.w4}×Confidence
                                  </p>
                                  <div className="grid grid-cols-2 gap-1">
                                    {([
                                      { label: `Return (${mw.w1}) E/P+Mom`, val: mc.retorno, color: 'bg-accent' },
                                      { label: `Growth (${mw.w2}) EPS+ROE`, val: mc.crecimiento, color: 'bg-accent/70' },
                                      { label: `Liquidity (${mw.w3}) Vol+Cap`, val: mc.liquidezActivo, color: 'bg-accent/50' },
                                      { label: `Confidence (${mw.w4}) Mom+Rtg`, val: mc.confianza, color: 'bg-accent/30' },
                                    ] as const).map(item => (
                                      <div key={item.label} className="space-y-0.5">
                                        <div className="flex justify-between text-[7px] font-mono">
                                          <span className="text-ink/40">{item.label}</span>
                                          <span className="text-ink/60">{item.val}</span>
                                        </div>
                                        <div className="h-0.5 bg-ink/5 rounded-full overflow-hidden">
                                          <div className={`h-full ${item.color}`} style={{ width: `${item.val}%` }} />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  {m.masaJustificacion && <p className="text-[7px] font-mono text-ink/30 leading-tight italic">{m.masaJustificacion}</p>}
                                </>
                              ) : (
                                <>
                                  <div className="h-1 bg-ink/5 rounded-full overflow-hidden">
                                    <motion.div initial={{ width: 0 }} animate={{ width: `${m.masa}%` }} className="h-full bg-accent" />
                                  </div>
                                  {m.masaJustificacion && <p className="text-[8px] font-mono text-ink/30 leading-tight italic">{m.masaJustificacion}</p>}
                                </>
                              )}
                            </div>
                            {/* DISTANCIA */}
                            <div className="space-y-1.5">
                              <div className="flex justify-between text-[9px] font-mono">
                                <span className="text-ink/60">DISTANCIA (Riesgo)</span>
                                <span className="text-danger">{m.distancia.toFixed(1)}</span>
                              </div>
                              {dc ? (
                                <>
                                  <p className="text-[7px] font-mono text-ink/30 italic leading-none">
                                    r = Volat.(VIX+MOVE+Hist) + Spread(HYG+CDS+CPI+Rates+PolRisk) + (1-ρ)×30
                                  </p>
                                  <div className="grid grid-cols-3 gap-1">
                                    {([
                                      { label: 'Volat.VIX+MOVE', val: dc.volatilidad, color: 'bg-danger/80' },
                                      { label: 'Spread HYG+Risk', val: dc.spread, color: 'bg-danger/60' },
                                      { label: '(1-ρ)×30', val: Math.round((1 - dc.correlacion) * 30), color: 'bg-danger/40' },
                                    ] as const).map(item => (
                                      <div key={item.label} className="space-y-0.5">
                                        <div className="flex justify-between text-[7px] font-mono">
                                          <span className="text-ink/40">{item.label}</span>
                                          <span className="text-ink/60">{item.val}</span>
                                        </div>
                                        <div className="h-0.5 bg-ink/5 rounded-full overflow-hidden">
                                          <div className={`h-full ${item.color}`} style={{ width: `${item.val}%` }} />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  {m.distanciaJustificacion && <p className="text-[7px] font-mono text-ink/30 leading-tight italic">{m.distanciaJustificacion}</p>}
                                </>
                              ) : (
                                <>
                                  <div className="h-1 bg-ink/5 rounded-full overflow-hidden">
                                    <motion.div initial={{ width: 0 }} animate={{ width: `${m.distancia}%` }} className="h-full bg-danger/60" />
                                  </div>
                                  {m.distanciaJustificacion && <p className="text-[8px] font-mono text-ink/30 leading-tight italic">{m.distanciaJustificacion}</p>}
                                </>
                              )}
                            </div>
                            {/* FRICCIÓN */}
                            <div className="space-y-1.5">
                              <div className="flex justify-between text-[9px] font-mono">
                                <span className="text-ink/60">FRICCIÓN (Liquidez)</span>
                                <span className="text-ink/40">{m.friccion}</span>
                              </div>
                              {fc ? (
                                <div className="grid grid-cols-3 gap-1">
                                  {([
                                    { label: 'Bid-Ask (ask-bid/P)', val: fc.bidAskSpread, color: 'bg-ink/30' },
                                    { label: 'TxCost+CapCtrl', val: fc.restricciones, color: 'bg-ink/20' },
                                    { label: 'Slippage(MktCap)', val: fc.profundidad, color: 'bg-accent/20' },
                                  ] as const).map(item => (
                                    <div key={item.label} className="space-y-0.5">
                                      <div className="flex justify-between text-[7px] font-mono">
                                        <span className="text-ink/40">{item.label}</span>
                                        <span className="text-ink/60">{item.val}</span>
                                      </div>
                                      <div className="h-0.5 bg-ink/5 rounded-full overflow-hidden">
                                        <div className={`h-full ${item.color}`} style={{ width: `${item.val}%` }} />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <>
                                  <div className="h-1 bg-ink/5 rounded-full overflow-hidden">
                                    <motion.div initial={{ width: 0 }} animate={{ width: `${m.friccion}%` }} className="h-full bg-ink/20" />
                                  </div>
                                  {m.friccionJustificacion && <p className="text-[8px] font-mono text-ink/30 leading-tight italic">{m.friccionJustificacion}</p>}
                                </>
                              )}
                              {fc && m.friccionJustificacion && <p className="text-[7px] font-mono text-ink/30 leading-tight italic">{m.friccionJustificacion}</p>}
                            </div>
                          </div>
                          <div className="p-2 rounded bg-accent/5 border border-accent/10 space-y-0.5 text-center">
                            <p className="text-[9px] font-mono text-accent">
                              ({m.masa.toFixed(1)} - {m.distancia.toFixed(1)}) / {m.friccion} = {fuerza.toFixed(2)}
                            </p>
                            {m.zscoreFlows !== undefined && (
                              <p className="text-[7px] font-mono text-ink/30">
                                Z-score flujos: {m.zscoreFlows > 0 ? '+' : ''}{m.zscoreFlows.toFixed(2)}
                              </p>
                            )}
                            {activeScenario.macroRegime && (
                              <p className="text-[7px] font-mono text-accent/50 uppercase tracking-widest">
                                Régimen: {activeScenario.macroRegime}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    <div className="pt-4 border-t border-ink/5 space-y-4">
                      {/* Outgoing Flows */}
                      <div>
                        <h4 className="text-[9px] font-mono text-ink/40 uppercase tracking-widest mb-2 flex items-center gap-1">
                          <ArrowUpRight className="w-3 h-3" />
                          Salida de Capital
                        </h4>
                        <div className="space-y-1.5">
                          {activeScenario.flows.filter(f => f.from === selectedPoint.id).length > 0 ? (
                            activeScenario.flows.filter(f => f.from === selectedPoint.id).map((flow, i) => {
                              const fromMetrics = activeScenario.metrics?.[flow.from];
                              const toMetrics = activeScenario.metrics?.[flow.to];
                              return (
                                <div key={i} className="p-2 rounded bg-ink/5 border border-ink/5">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] font-bold text-ink/80">Hacia {flow.to}</span>
                                    <span className="text-[9px] font-mono text-accent">{(flow.strength * 100).toFixed(0)}%</span>
                                  </div>
                                  {flow.flowTheoretical !== undefined ? (
                                    <div className="space-y-0.5 mb-1">
                                      <p className="text-[7px] font-mono text-accent/60">
                                        ({fromMetrics?.masa.toFixed(0) ?? '?'} × {toMetrics?.masa.toFixed(0) ?? '?'}) / {toMetrics?.distancia.toFixed(0) ?? '?'}² × 1/{toMetrics?.friccion.toFixed(0) ?? '?'} = {flow.flowTheoretical.toFixed(3)}
                                      </p>
                                      {flow.zscoreAdjustment !== undefined && (
                                        <p className="text-[7px] font-mono text-ink/30">
                                          Z-adj: {flow.zscoreAdjustment > 0 ? '+' : ''}{flow.zscoreAdjustment.toFixed(2)} → Final: {flow.flowFinal?.toFixed(3) ?? '?'}
                                        </p>
                                      )}
                                    </div>
                                  ) : fromMetrics && toMetrics ? (
                                    <p className="text-[7px] font-mono text-accent/60 mb-1">
                                      ({fromMetrics.masa} · {toMetrics.masa}) / {toMetrics.distancia}²
                                    </p>
                                  ) : null}
                                  <p className="text-[9px] font-mono text-ink/40 leading-tight">{flow.label}</p>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-[9px] font-mono text-ink/20 italic">Sin salidas significativas</p>
                          )}
                        </div>
                      </div>

                      {/* Incoming Flows */}
                      <div>
                        <h4 className="text-[9px] font-mono text-ink/40 uppercase tracking-widest mb-2 flex items-center gap-1">
                          <ArrowDownLeft className="w-3 h-3" />
                          Entrada de Capital
                        </h4>
                        <div className="space-y-1.5">
                          {activeScenario.flows.filter(f => f.to === selectedPoint.id).length > 0 ? (
                            activeScenario.flows.filter(f => f.to === selectedPoint.id).map((flow, i) => {
                              const fromMetrics = activeScenario.metrics?.[flow.from];
                              const toMetrics = activeScenario.metrics?.[flow.to];
                              return (
                                <div key={i} className="p-2 rounded bg-accent/5 border border-accent/10">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] font-bold text-accent">Desde {flow.from}</span>
                                    <span className="text-[9px] font-mono text-accent">{(flow.strength * 100).toFixed(0)}%</span>
                                  </div>
                                  {flow.flowTheoretical !== undefined ? (
                                    <div className="space-y-0.5 mb-1">
                                      <p className="text-[7px] font-mono text-accent/60">
                                        ({fromMetrics?.masa.toFixed(0) ?? '?'} × {toMetrics?.masa.toFixed(0) ?? '?'}) / {toMetrics?.distancia.toFixed(0) ?? '?'}² × 1/{toMetrics?.friccion.toFixed(0) ?? '?'} = {flow.flowTheoretical.toFixed(3)}
                                      </p>
                                      {flow.zscoreAdjustment !== undefined && (
                                        <p className="text-[7px] font-mono text-ink/30">
                                          Z-adj: {flow.zscoreAdjustment > 0 ? '+' : ''}{flow.zscoreAdjustment.toFixed(2)} → Final: {flow.flowFinal?.toFixed(3) ?? '?'}
                                        </p>
                                      )}
                                    </div>
                                  ) : fromMetrics && toMetrics ? (
                                    <p className="text-[7px] font-mono text-accent/60 mb-1">
                                      ({fromMetrics.masa} · {toMetrics.masa}) / {toMetrics.distancia}²
                                    </p>
                                  ) : null}
                                  <p className="text-[9px] font-mono text-ink/40 leading-tight">{flow.label}</p>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-[9px] font-mono text-ink/20 italic">Sin entradas significativas</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Índice DXY', data: marketPrices.dxy },
              { label: 'Oro Spot', data: marketPrices.gold },
              { label: 'BTC / USD', data: marketPrices.btc },
              { label: 'NASDAQ', data: marketPrices.nasdaq },
              { label: 'Dow Jones', data: marketPrices.dowjones },
              { label: 'S&P 500', data: marketPrices.sp500 },
              { label: 'Crudo WTI', data: marketPrices.wti },
              { label: 'Crudo Brent', data: marketPrices.brent },
            ].map((item, idx) => (
              <div key={idx} className="p-3 rounded-lg border border-border bg-surface/20 relative overflow-hidden">
                {isLiveLoading && (
                  <motion.div 
                    initial={{ x: '-100%' }}
                    animate={{ x: '100%' }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-accent/5 to-transparent"
                  />
                )}
                <span className="text-[8px] font-mono text-ink/40 uppercase tracking-widest block mb-1">{item.label}</span>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-bold tracking-tighter">{item.data.value}</span>
                  <div className="flex items-center gap-1">
                    {item.data.trend === 'up' ? (
                      <ArrowUpRight className="w-2 h-2 text-accent" />
                    ) : item.data.trend === 'down' ? (
                      <ArrowDownLeft className="w-2 h-2 text-danger" />
                    ) : null}
                    <span className={cn(
                      "text-[9px] font-mono",
                      item.data.trend === 'up' ? "text-accent" : item.data.trend === 'down' ? "text-danger" : "text-ink/40"
                    )}>
                      {item.data.change}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Sidebar - Asset Gravity / Country Sectors */}
        <div className="lg:col-span-3 space-y-6">
          <section className="space-y-4">
            {selectedCountry ? (
              <>
                <h2 className="text-[11px] font-mono text-ink/40 uppercase tracking-widest flex items-center gap-2">
                  <BarChart3 className="w-3 h-3" />
                  Sectores · {selectedCountry}
                </h2>
                <div className="space-y-2">
                  {(() => {
                    const { nodes } = getSectorData(activeScenario.id, activeScenario.macroRegime, activeScenario.sectorData, selectedCountry ?? undefined, activeScenario.countrySectorData);
                    // 3-tier thresholds mirror WorldMap: mean ± 0.5σ of (M−d)
                    const forces = nodes.map(n => n.masa - n.distancia);
                    const fMean  = forces.reduce((a, b) => a + b, 0) / Math.max(1, forces.length);
                    const fSigma = Math.sqrt(forces.reduce((a, b) => a + (b - fMean) ** 2, 0) / Math.max(1, forces.length));
                    const highT  = fMean + 0.5 * fSigma;
                    const lowT   = fMean - 0.5 * fSigma;
                    return SECTORS.map(sector => {
                      const node = nodes.find(n => n.id === sector.id);
                      if (!node) return null;
                      const force  = node.masa - node.distancia;
                      const fuerza = force / 10;
                      const isSelected = selectedSectorId === sector.id;
                      const comps = deriveSectorComponents(node.masa, node.distancia);
                      // tier matches WorldMap circle color: high=verde, low=rojo, medium=gris
                      const tier = force >= highT ? 'high' : force <= lowT ? 'low' : 'medium';
                      const statusLabel = tier === 'high' ? 'ALTA' : tier === 'low' ? 'BAJA' : 'MEDIA';
                      const valueColor  = tier === 'high' ? 'text-accent' : tier === 'low' ? 'text-danger' : 'text-ink/60';

                      return (
                        <button
                          key={sector.id}
                          onClick={() => setSelectedSectorId(isSelected ? null : sector.id)}
                          className={cn(
                            'w-full p-3 rounded-lg border transition-all text-left',
                            tier === 'high'   ? 'bg-accent/5 border-accent/30' :
                            tier === 'low'    ? 'bg-danger/5 border-danger/30 opacity-70 hover:opacity-100' :
                                                'bg-surface/20 border-border opacity-60 hover:opacity-90',
                            isSelected && 'border-accent ring-1 ring-accent/50'
                          )}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[9px] font-mono text-ink/70 uppercase">{sector.fullName}</span>
                            {tier === 'high' && <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
                            {tier === 'low'  && <div className="w-1.5 h-1.5 rounded-full bg-danger" />}
                          </div>
                          <div className="flex items-center justify-between text-[9px] font-mono">
                            <span className="text-ink/30">Fuerza G · {statusLabel}</span>
                            <span className={valueColor}>{fuerza.toFixed(2)}</span>
                          </div>
                          <div className="mt-1.5 h-0.5 bg-ink/5 rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full',
                              tier === 'high' ? 'bg-accent' : tier === 'low' ? 'bg-danger' : 'bg-ink/20')}
                              style={{ width: `${Math.min(100, Math.max(0, (fuerza / 10) * 100))}%` }} />
                          </div>
                        </button>
                      );
                    });
                  })()}
                </div>
              </>
            ) : (
              <>
            <h2 className="text-[11px] font-mono text-ink/40 uppercase tracking-widest flex items-center gap-2">
              <TrendingUp className="w-3 h-3" />
              Centros de Gravedad de Activos
            </h2>
            <div className="space-y-3">
              {(() => {
                const assetPoints = GEO_POINTS.filter(p => p.type === 'asset');
                const forces = assetPoints.map(p => {
                  const m = activeScenario.metrics?.[p.id];
                  return { id: p.id, force: m ? (m.masa - m.distancia) / Math.max(1, m.friccion) : 0 };
                }).sort((a, b) => b.force - a.force);
                const n = assetPoints.length;
                const rawF   = forces.map(x => x.force);
                const rMean  = rawF.reduce((a, b) => a + b, 0) / rawF.length;
                const rSigma = Math.sqrt(rawF.reduce((a, b) => a + (b - rMean) ** 2, 0) / rawF.length);
                const rHighT = rMean + 0.5 * rSigma;
                const rLowT  = rMean - 0.5 * rSigma;
                const getTier = (id: string) => {
                  const f = forces.find(x => x.id === id)?.force ?? 0;
                  return f >= rHighT ? 'high' : f <= rLowT ? 'low' : 'medium';
                };
                const TIER = {
                  high:   { label: 'ALTA',  barColor: 'bg-green-500',  barWidth: '90%', textColor: 'text-green-400',  borderClass: 'bg-green-500/5 border-green-500/30',  dot: 'bg-green-500' },
                  medium: { label: 'MEDIA', barColor: 'bg-slate-500',  barWidth: '50%', textColor: 'text-slate-400',  borderClass: 'bg-surface/20 border-slate-600/40',    dot: 'bg-slate-500' },
                  low:    { label: 'BAJA',  barColor: 'bg-red-500/70', barWidth: '15%', textColor: 'text-red-400',    borderClass: 'bg-red-500/5 border-red-500/20',       dot: 'bg-red-500' },
                };
                return assetPoints.map((asset) => {
                  const metrics = activeScenario.metrics?.[asset.id];
                  const force = metrics ? (metrics.masa - metrics.distancia) / Math.max(1, metrics.friccion) : 0;
                  const tier = getTier(asset.id);
                  const t = TIER[tier];
                  const isSelected = selectedPoint?.id === asset.id;

                  return (
                  <button
                    key={asset.id}
                    onClick={() => setSelectedPoint(asset)}
                    className={cn(
                      "w-full p-4 rounded-lg border transition-all duration-500 text-left group",
                      t.borderClass,
                      isSelected && "ring-1 ring-white/20"
                    )}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold uppercase text-ink/80">{asset.name}</span>
                      {tier === 'high' && <div className={cn("w-2 h-2 rounded-full animate-pulse", t.dot)} />}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-ink/5 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: t.barWidth }}
                          className={cn("h-full", t.barColor)}
                        />
                      </div>
                      <span className={cn("text-[10px] font-mono", t.textColor)}>{t.label}</span>
                    </div>
                    {isSelected && activeScenario.metrics?.[asset.id] && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="mt-3 pt-3 border-t border-ink/5 space-y-3"
                      >
                        <div className="grid grid-cols-1 gap-2">
                          <div className="space-y-1">
                            <div className="flex justify-between text-[9px] font-mono">
                              <span className="text-ink/60">MASA</span>
                              <span className={t.textColor}>{activeScenario.metrics[asset.id].masa}%</span>
                            </div>
                            {activeScenario.metrics[asset.id].masaJustificacion && (
                              <p className="text-[7px] font-mono text-ink/30 leading-tight italic">
                                {activeScenario.metrics[asset.id].masaJustificacion}
                              </p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between text-[9px] font-mono">
                              <span className="text-ink/60">DISTANCIA</span>
                              <span className="text-danger">{activeScenario.metrics[asset.id].distancia}%</span>
                            </div>
                            {activeScenario.metrics[asset.id].distanciaJustificacion && (
                              <p className="text-[7px] font-mono text-ink/30 leading-tight italic">
                                {activeScenario.metrics[asset.id].distanciaJustificacion}
                              </p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between text-[9px] font-mono">
                              <span className="text-ink/60">FRICCIÓN</span>
                              <span className="text-ink/60">{activeScenario.metrics[asset.id].friccion}%</span>
                            </div>
                            {activeScenario.metrics[asset.id].friccionJustificacion && (
                              <p className="text-[7px] font-mono text-ink/30 leading-tight italic">
                                {activeScenario.metrics[asset.id].friccionJustificacion}
                              </p>
                            )}
                          </div>
                        </div>
                        
                        <div className="p-2 rounded bg-accent/10 border border-accent/20">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[8px] font-mono text-ink/40 uppercase">Fuerza G</span>
                            <span className="text-[10px] font-mono text-accent font-bold">
                              {((activeScenario.metrics[asset.id].masa - activeScenario.metrics[asset.id].distancia) / Math.max(1, activeScenario.metrics[asset.id].friccion)).toFixed(2)}
                            </span>
                          </div>
                          <p className="text-[7px] font-mono text-ink/30 leading-tight">
                            ({activeScenario.metrics[asset.id].masa} - {activeScenario.metrics[asset.id].distancia}) / {activeScenario.metrics[asset.id].friccion}
                          </p>
                        </div>
                        
                        {tier === 'high' && (
                          <p className={cn("text-[8px] font-mono italic leading-tight", t.textColor, "opacity-60")}>
                            * Centro de gravedad activo — alta densidad de masa relativa.
                          </p>
                        )}
                        {tier === 'low' && (
                          <p className="text-[8px] font-mono text-red-400/60 italic leading-tight">
                            * Capital en fuga — baja atracción gravitacional.
                          </p>
                        )}
                      </motion.div>
                    )}
                  </button>
                  );
                });
              })()}
            </div>
              </>
            )}
          </section>

          <section className="p-6 rounded-xl border border-accent/20 bg-accent/5 relative group">
            <div className="absolute top-0 right-0 p-2">
              <Activity className="w-4 h-4 text-accent/40" />
            </div>
            <h3 className="text-sm font-bold uppercase mb-2">
              {activeScenario.id === 'live' ? 'Justificación del Modelo' : 'Sentimiento del Mercado'}
            </h3>
            {activeScenario.id === 'live' && activeScenario.rotationSignal && (
              <div className="flex items-center gap-2 mb-3 p-2 rounded bg-ink/5 border border-ink/5">
                <span className="text-[7px] font-mono text-ink/30 uppercase tracking-widest shrink-0">Rotación Sectorial</span>
                <span className={cn(
                  'text-[8px] font-mono font-bold uppercase tracking-widest',
                  activeScenario.rotationSignal.includes('RISK-ON')    ? 'text-accent' :
                  activeScenario.rotationSignal.includes('RISK-OFF')   ? 'text-danger' :
                  activeScenario.rotationSignal.includes('VALUE')      ? 'text-yellow-400' :
                  activeScenario.rotationSignal.includes('DEFENSIVO')  ? 'text-yellow-400' : 'text-ink/40'
                )}>
                  {activeScenario.rotationSignal}
                </span>
              </div>
            )}

            {activeScenario.id === 'live' && activeScenario.newsContext && activeScenario.newsContext.headlines.length > 0 && (
              <div className="space-y-2 border-t border-ink/10 pt-3 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-mono text-ink/30 uppercase tracking-widest">
                    Noticias · Yahoo &amp; Investing
                  </span>
                  <span className={cn(
                    'text-[8px] font-mono font-bold',
                    activeScenario.newsContext.newsSentiment === 'bullish' ? 'text-accent' :
                    activeScenario.newsContext.newsSentiment === 'bearish' ? 'text-danger' : 'text-ink/40'
                  )}>
                    {activeScenario.newsContext.newsSentiment === 'bullish' ? 'ALCISTA' :
                     activeScenario.newsContext.newsSentiment === 'bearish' ? 'BAJISTA' : 'NEUTRAL'}
                    {' '}({activeScenario.newsContext.sentimentScore > 0 ? '+' : ''}{activeScenario.newsContext.sentimentScore.toFixed(2)})
                  </span>
                </div>
                {activeScenario.newsContext.regimeSignal && (
                  <p className="text-[7px] font-mono text-ink/30 italic leading-tight">
                    {activeScenario.newsContext.regimeSignal}
                  </p>
                )}
                <div className="space-y-1.5 max-h-[360px] overflow-y-auto custom-scrollbar">
                  {activeScenario.newsContext.headlines.map((item, i) => {
                    const inner = (
                      <>
                        <div className={cn(
                          'w-1.5 h-1.5 rounded-full mt-[3px] shrink-0',
                          item.sentiment === 'bullish' ? 'bg-accent' :
                          item.sentiment === 'bearish' ? 'bg-danger' : 'bg-ink/30'
                        )} />
                        <div className="space-y-0.5 min-w-0">
                          <p className={cn(
                            'text-[8px] font-mono leading-tight',
                            item.url ? 'text-accent/80 group-hover:text-accent' : 'text-ink/70'
                          )}>{item.title}</p>
                          <span className="text-[7px] font-mono text-ink/30">
                            {item.source}{item.url ? ' · ↗' : ''}
                          </span>
                        </div>
                      </>
                    );
                    return item.url ? (
                      <a
                        key={i}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-start gap-2 p-2 rounded bg-ink/5 border border-ink/5 hover:bg-accent/5 hover:border-accent/20 transition-colors cursor-pointer"
                      >
                        {inner}
                      </a>
                    ) : (
                      <div key={i} className="flex items-start gap-2 p-2 rounded bg-ink/5 border border-ink/5">
                        {inner}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button className="w-full py-2 rounded border border-accent/30 text-[10px] font-bold uppercase tracking-widest hover:bg-accent hover:text-bg transition-all">
              Descargar Reporte
            </button>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border p-6 mt-12 glass">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4 text-[10px] font-mono text-ink/40 uppercase tracking-widest">
            <span>© 2026 MOTOR DE GRAVEDAD DE CAPITAL</span>
            <span className="hidden md:inline">|</span>
            <span>ESTADO DEL SISTEMA: OPERATIVO</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#" className="text-[10px] font-mono text-ink/40 hover:text-accent uppercase tracking-widest transition-colors">Documentación</a>
            <a href="#" className="text-[10px] font-mono text-ink/40 hover:text-accent uppercase tracking-widest transition-colors">Acceso API</a>
            <a href="#" className="text-[10px] font-mono text-ink/40 hover:text-accent uppercase tracking-widest transition-colors">Política de Privacidad</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
