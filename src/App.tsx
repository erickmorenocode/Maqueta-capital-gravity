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
  ArrowDownLeft
} from 'lucide-react';
import { SCENARIOS, GEO_POINTS, MarketScenario, GeoPoint, DEFAULT_PRICES, MarketPrices } from './data';
import { WorldMap, SECTORS, getSectorData } from './components/WorldMap';
import { fetchLiveMarketGravity } from './services/geminiService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [activeScenario, setActiveScenario] = useState<MarketScenario>(SCENARIOS[0]);
  const [marketPrices, setMarketPrices] = useState<MarketPrices>(DEFAULT_PRICES);
  const [isLiveLoading, setIsLiveLoading] = useState(false);
  const [scenarios, setScenarios] = useState<MarketScenario[]>(SCENARIOS);
  const [selectedPoint, setSelectedPoint] = useState<GeoPoint | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);

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
      // If error, remove the "Cargando..." placeholder and fallback to Hawkish
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
            <p className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Motor de Flujo de Liquidez Global v1.0</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <button 
            onClick={() => handleFetchLive(true)}
            disabled={isLiveLoading}
            className={cn(
              "flex items-center gap-2 px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all",
              isLiveLoading 
                ? "bg-white/10 text-white/40 cursor-not-allowed" 
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
          <div className="hidden md:flex items-center gap-4 text-[10px] font-mono text-white/60">
            <div className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-accent" />
              <span>FEED EN VIVO: ACTIVO</span>
            </div>
            {activeScenario.lastUpdated && (
              <div className="flex items-center gap-1.5 border-l border-white/10 pl-4">
                <span className="text-white/40">SINC:</span>
                <span className="text-white/80">
                  {new Date(activeScenario.lastUpdated).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-accent" />
              <span>CAPAS: MULTI-ACTIVO</span>
            </div>
          </div>
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
              <h2 className="text-[11px] font-mono text-white/40 uppercase tracking-widest flex items-center gap-2">
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
            
            <div className="grid grid-cols-1 gap-2">
              {scenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  onClick={() => setActiveScenario(scenario)}
                  className={cn(
                    "group relative p-4 rounded-lg border text-left transition-all duration-300 overflow-hidden",
                    activeScenario.id === scenario.id 
                      ? "bg-accent/10 border-accent/50 glow-accent" 
                      : "bg-surface/40 border-border hover:border-white/20",
                    scenario.id === 'live' && "border-accent/40 bg-accent/5"
                  )}
                >
                  {activeScenario.id === scenario.id && (
                    <motion.div 
                      layoutId="active-indicator"
                      className="absolute left-0 top-0 bottom-0 w-1 bg-accent"
                    />
                  )}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-xs font-bold uppercase tracking-tight",
                        activeScenario.id === scenario.id ? "text-accent" : "text-white/80"
                      )}>
                        {scenario.name}
                      </span>
                      {scenario.id === 'live' && (
                        <span className="px-1.5 py-0.5 rounded bg-accent text-bg text-[8px] font-bold animate-pulse">VIVO</span>
                      )}
                    </div>
                    {scenario.id === 'crisis' && <ShieldAlert className="w-3 h-3 text-danger" />}
                    {scenario.id === 'hawkish' && <TrendingUp className="w-3 h-3 text-accent" />}
                  </div>
                  <p className="text-[10px] text-white/40 leading-relaxed font-mono">
                    {scenario.description}
                  </p>
                </button>
              ))}
            </div>
          </section>

          <section className="p-4 rounded-lg border border-border bg-surface/20 space-y-4">
            <h2 className="text-[11px] font-mono text-white/40 uppercase tracking-widest flex items-center gap-2">
              <Activity className="w-3 h-3" />
              Leyes de Gravedad Financiera
            </h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <span className="text-[8px] font-mono text-white/30 uppercase tracking-widest block">Versión Teórica</span>
                <div className="p-3 rounded bg-black/40 border border-white/5 text-center">
                  <p className="text-[10px] font-mono text-accent font-bold italic">
                    Flujo ∝ (A₁ · A₂) / Riesgo²
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <span className="text-[8px] font-mono text-white/30 uppercase tracking-widest block">Versión Práctica</span>
                <div className="p-3 rounded bg-black/40 border border-white/5 text-center">
                  <p className="text-[10px] font-mono text-accent font-bold">
                    Flujo ≈ (Retorno - Riesgo) / Fricción
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 text-[9px] font-mono">
                <div className="flex flex-col border-b border-white/5 pb-1">
                  <div className="flex justify-between">
                    <span className="text-accent font-bold">MASA (M)</span>
                    <span className="text-white/80">Atractivo / Retorno</span>
                  </div>
                  <span className="text-[7px] text-white/30 leading-tight">Yield, Crecimiento, Seguridad (Bonos), Estabilidad Accionaria.</span>
                </div>
                <div className="flex flex-col border-b border-white/5 pb-1">
                  <div className="flex justify-between">
                    <span className="text-danger font-bold">DISTANCIA (d)</span>
                    <span className="text-white/80">Riesgo / Espacio</span>
                  </div>
                  <span className="text-[7px] text-white/30 leading-tight">Volatilidad, Riesgo País, Incertidumbre Macro, Geopolítica.</span>
                </div>
                <div className="flex flex-col">
                  <div className="flex justify-between">
                    <span className="text-white/60 font-bold">FRICCIÓN (f)</span>
                    <span className="text-white/80">Liquidez / Costos</span>
                  </div>
                  <span className="text-[7px] text-white/30 leading-tight">Facilidad Entrada/Salida, Controles de Capital, Costos Operativos.</span>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-white/5">
                <span className="text-[8px] font-mono text-white/30 uppercase tracking-widest block">Rangos de Fuerza G</span>
                <div className="grid grid-cols-3 gap-1 text-[8px] font-mono">
                  <div className="p-1 rounded bg-accent/10 border border-accent/20 text-center">
                    <div className="text-accent font-bold uppercase">Alta</div>
                    <div className="text-white/40">&gt; 8.0</div>
                  </div>
                  <div className="p-1 rounded bg-white/5 border border-white/10 text-center">
                    <div className="text-white/80 font-bold uppercase">Media</div>
                    <div className="text-white/40">2.0 - 8.0</div>
                  </div>
                  <div className="p-1 rounded bg-danger/10 border border-danger/20 text-center">
                    <div className="text-danger font-bold uppercase">Baja</div>
                    <div className="text-white/40">&lt; 2.0</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="p-4 rounded-lg border border-border bg-surface/20 space-y-4">
            <h2 className="text-[11px] font-mono text-white/40 uppercase tracking-widest flex items-center gap-2">
              <Info className="w-3 h-3" />
              Insight de Gravedad
            </h2>
            <div className="space-y-3">
              <div className="p-3 rounded bg-black/40 border border-white/5">
                <p className="text-[10px] font-mono text-white/60 leading-relaxed italic">
                  {activeScenario.id === 'live' 
                    ? "Análisis basado en noticias de último minuto y datos macro en tiempo real. El capital se mueve hacia la mayor atracción ajustada por riesgo."
                    : "El capital no va al mayor retorno absoluto; va al mejor retorno ajustado por riesgo y liquidez. El dinero se mueve hacia donde hay mayor atracción ajustada por riesgo."}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-white/40">Volatilidad Global</span>
                  <span className="text-accent">14.2%</span>
                </div>
                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: '42%' }}
                    className="h-full bg-accent"
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Main Content - Map */}
        <div className="lg:col-span-6 space-y-6">
          <div className="h-[600px] relative">
            <WorldMap
              scenario={activeScenario}
              geoPoints={GEO_POINTS}
              onPointClick={handlePointClick}
              onCountrySelect={handleCountrySelect}
              onSectorClick={handleSectorClick}
            />
            
            {/* Sector Drill-down Overlay */}
            <AnimatePresence>
              {selectedSectorId && selectedCountry && (() => {
                const { nodes, flows } = getSectorData(activeScenario.id);
                const node = nodes.find(n => n.id === selectedSectorId);
                const sector = SECTORS.find(s => s.id === selectedSectorId);
                if (!node || !sector) return null;
                const fuerza = (node.masa - node.distancia) / 10;
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
                        <div className={cn('w-2 h-2 rounded-full', node.isGravityCenter ? 'bg-accent animate-pulse' : 'bg-white/20')} />
                        <h3 className="text-sm font-bold uppercase tracking-tight">{sector.fullName}</h3>
                      </div>
                      <button onClick={() => setSelectedSectorId(null)} className="p-1 hover:bg-white/10 rounded transition-colors">
                        <X className="w-4 h-4 text-white/40" />
                      </button>
                    </div>
                    <div className="space-y-4">
                      <div className="flex justify-between text-[10px] font-mono">
                        <span className="text-white/40 uppercase">Estado</span>
                        <span className={node.isGravityCenter ? 'text-accent' : 'text-white/40'}>
                          {node.isGravityCenter ? 'Centro Activo' : 'Sector Secundario'}
                        </span>
                      </div>
                      <div className="pt-3 border-t border-white/5 space-y-3">
                        <h4 className="text-[9px] font-mono text-white/40 uppercase tracking-widest flex items-center gap-1">
                          <Zap className="w-3 h-3" />Desglose de Gravedad
                        </h4>
                        <div className="space-y-2">
                          <div className="space-y-1">
                            <div className="flex justify-between text-[9px] font-mono">
                              <span className="text-white/60">MASA (Atractivo)</span>
                              <span className="text-accent">{node.masa}%</span>
                            </div>
                            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                              <motion.div initial={{ width: 0 }} animate={{ width: `${node.masa}%` }} className="h-full bg-accent" />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between text-[9px] font-mono">
                              <span className="text-white/60">DISTANCIA (Riesgo)</span>
                              <span className="text-danger">{node.distancia}%</span>
                            </div>
                            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                              <motion.div initial={{ width: 0 }} animate={{ width: `${node.distancia}%` }} className="h-full bg-danger/60" />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between text-[9px] font-mono">
                              <span className="text-white/60">FRICCIÓN (Liquidez)</span>
                              <span className="text-white/40">10%</span>
                            </div>
                            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-white/20 w-[10%]" />
                            </div>
                          </div>
                        </div>
                        <div className="p-2 rounded bg-accent/5 border border-accent/10 text-center">
                          <p className="text-[9px] font-mono text-accent">
                            ({node.masa} - {node.distancia}) / 10 = {fuerza.toFixed(2)}
                          </p>
                        </div>
                      </div>
                      <div className="pt-3 border-t border-white/5 space-y-3">
                        <div>
                          <h4 className="text-[9px] font-mono text-white/40 uppercase tracking-widest mb-2 flex items-center gap-1">
                            <ArrowUpRight className="w-3 h-3" />Salida de Capital
                          </h4>
                          <div className="space-y-1.5">
                            {outFlows.length > 0 ? outFlows.map((flow, i) => {
                              const dest = SECTORS.find(s => s.id === flow.to);
                              return (
                                <div key={i} className="p-2 rounded bg-white/5 border border-white/5">
                                  <div className="flex justify-between">
                                    <span className="text-[9px] font-mono text-white/70">Hacia {dest?.fullName ?? flow.to}</span>
                                    <span className="text-[9px] font-mono text-accent">{(flow.strength * 100).toFixed(0)}%</span>
                                  </div>
                                </div>
                              );
                            }) : <p className="text-[9px] font-mono text-white/20 italic">Sin salidas significativas</p>}
                          </div>
                        </div>
                        <div>
                          <h4 className="text-[9px] font-mono text-white/40 uppercase tracking-widest mb-2 flex items-center gap-1">
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
                            }) : <p className="text-[9px] font-mono text-white/20 italic">Sin entradas significativas</p>}
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
                        activeScenario.gravityCenters.includes(selectedPoint.id) ? "bg-accent animate-pulse" : "bg-white/20"
                      )} />
                      <h3 className="text-sm font-bold uppercase tracking-tight">{selectedPoint.name}</h3>
                    </div>
                    <button 
                      onClick={() => setSelectedPoint(null)}
                      className="p-1 hover:bg-white/10 rounded transition-colors"
                    >
                      <X className="w-4 h-4 text-white/40" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-white/40 uppercase">Clasificación</span>
                      <span className="text-white/80 uppercase">{selectedPoint.type === 'country' ? 'País' : 'Activo'}</span>
                    </div>
                    
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-white/40 uppercase">Estado de Gravedad</span>
                      <span className={cn(
                        "uppercase",
                        activeScenario.gravityCenters.includes(selectedPoint.id) ? "text-accent" : "text-white/40"
                      )}>
                        {activeScenario.gravityCenters.includes(selectedPoint.id) ? 'Centro Activo' : 'Mercado Secundario'}
                      </span>
                    </div>

                    {/* Gravity Formula Breakdown */}
                    {activeScenario.metrics?.[selectedPoint.id] && (
                      <div className="pt-4 border-t border-white/5 space-y-3">
                        <h4 className="text-[9px] font-mono text-white/40 uppercase tracking-widest flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          Desglose de Gravedad
                        </h4>
                        <div className="grid grid-cols-1 gap-3">
                          <div className="space-y-1">
                            <div className="flex justify-between text-[9px] font-mono">
                              <span className="text-white/60">MASA (Atractivo)</span>
                              <span className="text-accent">{activeScenario.metrics[selectedPoint.id].masa}%</span>
                            </div>
                            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${activeScenario.metrics[selectedPoint.id].masa}%` }}
                                className="h-full bg-accent"
                              />
                            </div>
                            {activeScenario.metrics[selectedPoint.id].masaJustificacion && (
                              <p className="text-[8px] font-mono text-white/30 leading-tight italic">
                                {activeScenario.metrics[selectedPoint.id].masaJustificacion}
                              </p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between text-[9px] font-mono">
                              <span className="text-white/60">DISTANCIA (Riesgo)</span>
                              <span className="text-danger">{activeScenario.metrics[selectedPoint.id].distancia}%</span>
                            </div>
                            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${activeScenario.metrics[selectedPoint.id].distancia}%` }}
                                className="h-full bg-danger/60"
                              />
                            </div>
                            {activeScenario.metrics[selectedPoint.id].distanciaJustificacion && (
                              <p className="text-[8px] font-mono text-white/30 leading-tight italic">
                                {activeScenario.metrics[selectedPoint.id].distanciaJustificacion}
                              </p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between text-[9px] font-mono">
                              <span className="text-white/60">FRICCIÓN (Liquidez)</span>
                              <span className="text-white/40">{activeScenario.metrics[selectedPoint.id].friccion}%</span>
                            </div>
                            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${activeScenario.metrics[selectedPoint.id].friccion}%` }}
                                className="h-full bg-white/20"
                              />
                            </div>
                            {activeScenario.metrics[selectedPoint.id].friccionJustificacion && (
                              <p className="text-[8px] font-mono text-white/30 leading-tight italic">
                                {activeScenario.metrics[selectedPoint.id].friccionJustificacion}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-accent/5 border border-accent/10 text-center">
                          <p className="text-[9px] font-mono text-accent">
                            ({activeScenario.metrics[selectedPoint.id].masa} - {activeScenario.metrics[selectedPoint.id].distancia}) / {activeScenario.metrics[selectedPoint.id].friccion} = {((activeScenario.metrics[selectedPoint.id].masa - activeScenario.metrics[selectedPoint.id].distancia) / Math.max(1, activeScenario.metrics[selectedPoint.id].friccion)).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="pt-4 border-t border-white/5 space-y-4">
                      {/* Outgoing Flows */}
                      <div>
                        <h4 className="text-[9px] font-mono text-white/40 uppercase tracking-widest mb-2 flex items-center gap-1">
                          <ArrowUpRight className="w-3 h-3" />
                          Salida de Capital
                        </h4>
                        <div className="space-y-1.5">
                          {activeScenario.flows.filter(f => f.from === selectedPoint.id).length > 0 ? (
                            activeScenario.flows.filter(f => f.from === selectedPoint.id).map((flow, i) => {
                              const fromMetrics = activeScenario.metrics?.[flow.from];
                              const toMetrics = activeScenario.metrics?.[flow.to];
                              return (
                                <div key={i} className="p-2 rounded bg-white/5 border border-white/5">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] font-bold text-white/80">Hacia {flow.to}</span>
                                    <span className="text-[9px] font-mono text-accent">{(flow.strength * 100).toFixed(0)}%</span>
                                  </div>
                                  {fromMetrics && toMetrics && (
                                    <p className="text-[7px] font-mono text-accent/60 mb-1">
                                      ({fromMetrics.masa} · {toMetrics.masa}) / {toMetrics.distancia}²
                                    </p>
                                  )}
                                  <p className="text-[9px] font-mono text-white/40 leading-tight">{flow.label}</p>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-[9px] font-mono text-white/20 italic">Sin salidas significativas</p>
                          )}
                        </div>
                      </div>

                      {/* Incoming Flows */}
                      <div>
                        <h4 className="text-[9px] font-mono text-white/40 uppercase tracking-widest mb-2 flex items-center gap-1">
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
                                  {fromMetrics && toMetrics && (
                                    <p className="text-[7px] font-mono text-accent/60 mb-1">
                                      ({fromMetrics.masa} · {toMetrics.masa}) / {toMetrics.distancia}²
                                    </p>
                                  )}
                                  <p className="text-[9px] font-mono text-white/40 leading-tight">{flow.label}</p>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-[9px] font-mono text-white/20 italic">Sin entradas significativas</p>
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
                <span className="text-[8px] font-mono text-white/40 uppercase tracking-widest block mb-1">{item.label}</span>
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
                      item.data.trend === 'up' ? "text-accent" : item.data.trend === 'down' ? "text-danger" : "text-white/40"
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
                <h2 className="text-[11px] font-mono text-white/40 uppercase tracking-widest flex items-center gap-2">
                  <BarChart3 className="w-3 h-3" />
                  Sectores · {selectedCountry}
                </h2>
                <div className="space-y-2">
                  {(() => {
                    const { nodes } = getSectorData(activeScenario.id);
                    return SECTORS.map(sector => {
                      const node = nodes.find(n => n.id === sector.id);
                      if (!node) return null;
                      const fuerza = (node.masa - node.distancia) / 10;
                      const isSelected = selectedSectorId === sector.id;
                      let statusLabel = 'BAJA';
                      let valueColor = 'text-danger';
                      if (fuerza > 8) { statusLabel = 'ALTA'; valueColor = 'text-accent'; }
                      else if (fuerza >= 2) { statusLabel = 'MEDIA'; valueColor = 'text-white/60'; }
                      return (
                        <button
                          key={sector.id}
                          onClick={() => setSelectedSectorId(isSelected ? null : sector.id)}
                          className={cn(
                            'w-full p-3 rounded-lg border transition-all text-left',
                            node.isGravityCenter ? 'bg-accent/5 border-accent/30' : 'bg-surface/20 border-border opacity-60 hover:opacity-90',
                            isSelected && 'border-accent ring-1 ring-accent/50'
                          )}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[9px] font-mono text-white/70 uppercase">{sector.fullName}</span>
                            {node.isGravityCenter && <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
                          </div>
                          <div className="flex items-center justify-between text-[9px] font-mono">
                            <span className="text-white/30">Fuerza G · {statusLabel}</span>
                            <span className={valueColor}>{fuerza.toFixed(2)}</span>
                          </div>
                          <div className="mt-1.5 h-0.5 bg-white/5 rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full', node.isGravityCenter ? 'bg-accent' : 'bg-white/20')}
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
            <h2 className="text-[11px] font-mono text-white/40 uppercase tracking-widest flex items-center gap-2">
              <TrendingUp className="w-3 h-3" />
              Centros de Gravedad de Activos
            </h2>
            <div className="space-y-3">
              {GEO_POINTS.filter(p => p.type === 'asset').map((asset) => {
                const metrics = activeScenario.metrics?.[asset.id];
                const force = metrics ? (metrics.masa - metrics.distancia) / Math.max(1, metrics.friccion) : 0;
                const isHigh = force > 8.0;
                const isActive = isHigh; // Centros de gravedad son solo los altos
                const isSelected = selectedPoint?.id === asset.id;
                
                let statusLabel = 'BAJA';
                let barColor = 'bg-danger/60';
                let barWidth = '15%';
                
                if (isHigh) {
                  statusLabel = 'ALTA';
                  barColor = 'bg-accent';
                  barWidth = '90%';
                } else if (force >= 2.0) {
                  statusLabel = 'MEDIA';
                  barColor = 'bg-white/40';
                  barWidth = '50%';
                } else {
                  statusLabel = 'BAJA';
                  barColor = 'bg-danger/60';
                  barWidth = '15%';
                }

                return (
                  <button 
                    key={asset.id}
                    onClick={() => setSelectedPoint(asset)}
                    className={cn(
                      "w-full p-4 rounded-lg border transition-all duration-500 text-left group",
                      isActive ? "bg-accent/5 border-accent/30" : "bg-surface/20 border-border opacity-50 hover:opacity-80",
                      isSelected && "border-accent ring-1 ring-accent/50"
                    )}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className={cn(
                        "text-xs font-bold uppercase",
                        isSelected ? "text-accent" : "text-white/80"
                      )}>{asset.name}</span>
                      {isActive && <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: barWidth }}
                          className={cn("h-full", barColor)}
                        />
                      </div>
                      <span className={cn(
                        "text-[10px] font-mono",
                        statusLabel === 'ALTA' ? "text-accent" : statusLabel === 'MEDIA' ? "text-white/60" : "text-danger"
                      )}>
                        {statusLabel}
                      </span>
                    </div>
                    {isSelected && activeScenario.metrics?.[asset.id] && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="mt-3 pt-3 border-t border-white/5 space-y-3"
                      >
                        <div className="grid grid-cols-1 gap-2">
                          <div className="space-y-1">
                            <div className="flex justify-between text-[9px] font-mono">
                              <span className="text-white/60">MASA</span>
                              <span className="text-accent">{activeScenario.metrics[asset.id].masa}%</span>
                            </div>
                            {activeScenario.metrics[asset.id].masaJustificacion && (
                              <p className="text-[7px] font-mono text-white/30 leading-tight italic">
                                {activeScenario.metrics[asset.id].masaJustificacion}
                              </p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between text-[9px] font-mono">
                              <span className="text-white/60">DISTANCIA</span>
                              <span className="text-danger">{activeScenario.metrics[asset.id].distancia}%</span>
                            </div>
                            {activeScenario.metrics[asset.id].distanciaJustificacion && (
                              <p className="text-[7px] font-mono text-white/30 leading-tight italic">
                                {activeScenario.metrics[asset.id].distanciaJustificacion}
                              </p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between text-[9px] font-mono">
                              <span className="text-white/60">FRICCIÓN</span>
                              <span className="text-white/60">{activeScenario.metrics[asset.id].friccion}%</span>
                            </div>
                            {activeScenario.metrics[asset.id].friccionJustificacion && (
                              <p className="text-[7px] font-mono text-white/30 leading-tight italic">
                                {activeScenario.metrics[asset.id].friccionJustificacion}
                              </p>
                            )}
                          </div>
                        </div>
                        
                        <div className="p-2 rounded bg-accent/10 border border-accent/20">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[8px] font-mono text-white/40 uppercase">Fuerza G</span>
                            <span className="text-[10px] font-mono text-accent font-bold">
                              {((activeScenario.metrics[asset.id].masa - activeScenario.metrics[asset.id].distancia) / Math.max(1, activeScenario.metrics[asset.id].friccion)).toFixed(2)}
                            </span>
                          </div>
                          <p className="text-[7px] font-mono text-white/30 leading-tight">
                            ({activeScenario.metrics[asset.id].masa} - {activeScenario.metrics[asset.id].distancia}) / {activeScenario.metrics[asset.id].friccion}
                          </p>
                        </div>
                        
                        {isActive && (
                          <p className="text-[8px] font-mono text-accent/60 italic leading-tight">
                            * Punto de atracción activo por alta densidad de masa relativa.
                          </p>
                        )}
                      </motion.div>
                    )}
                  </button>
                );
              })}
            </div>
              </>
            )}
          </section>

          <section className="p-6 rounded-xl border border-accent/20 bg-accent/5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-2">
              <Activity className="w-4 h-4 text-accent/40" />
            </div>
            <h3 className="text-sm font-bold uppercase mb-2">
              {activeScenario.id === 'live' ? 'Justificación del Modelo' : 'Sentimiento del Mercado'}
            </h3>
            <p className="text-[10px] font-mono text-white/60 leading-relaxed mb-4">
              {activeScenario.id === 'live' 
                ? activeScenario.description 
                : `La atracción gravitacional actual se está desplazando hacia ${activeScenario.gravityCenters.join(' y ')} debido a condiciones de ${activeScenario.name.toLowerCase()}.`}
            </p>
            <button className="w-full py-2 rounded border border-accent/30 text-[10px] font-bold uppercase tracking-widest hover:bg-accent hover:text-bg transition-all">
              Descargar Reporte
            </button>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border p-6 mt-12 glass">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4 text-[10px] font-mono text-white/40 uppercase tracking-widest">
            <span>© 2026 MOTOR DE GRAVEDAD DE CAPITAL</span>
            <span className="hidden md:inline">|</span>
            <span>ESTADO DEL SISTEMA: OPERATIVO</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#" className="text-[10px] font-mono text-white/40 hover:text-accent uppercase tracking-widest transition-colors">Documentación</a>
            <a href="#" className="text-[10px] font-mono text-white/40 hover:text-accent uppercase tracking-widest transition-colors">Acceso API</a>
            <a href="#" className="text-[10px] font-mono text-white/40 hover:text-accent uppercase tracking-widest transition-colors">Política de Privacidad</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
