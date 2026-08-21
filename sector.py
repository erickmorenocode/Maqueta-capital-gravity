Aquí está el código completo de la sección de rotación: src/app/rotacion/page.tsx (551 líneas).
 
  "use client";
 
  import { useState, useCallback, useEffect } from "react";
  import { useTheme } from "@/hooks/useTheme";
  import Nav from "@/components/Nav";
  import PageHeader from "@/components/PageHeader";
  import {
    ResponsiveContainer, LineChart, Line, CartesianGrid,
    XAxis, YAxis, Tooltip, Legend, ReferenceLine,
  } from "recharts";
 
  type Group = "broad" | "sector" | "alternative";
  type Verdict = "ALCISTA" | "BAJISTA" | "NEUTRAL";
 
  interface ETFResult {
    ticker: string;
    label: string;
    group: Group;
    spot: number;
    netGex: number;
    institutionalPressure: number;
    putCallRatio: number;
    gammaFlip: number;
    support: number;
    resistance: number;
    verdict: Verdict;
    error?: string;
  }
 
  interface RotationData {
    etfs: ETFResult[];
    signal: string;
    timestamp: string;
  }
 
  interface HistorySnapshot {
    id: number;
    created_at: string;
    signal: string;
    growth_avg: number;
    defensive_avg: number;
    alt_avg: number;
    etfs: ETFResult[];
  }
 
  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function avg(etfs: ETFResult[], tickers: string[]): number {
    const subset = etfs.filter((e) => tickers.includes(e.ticker) && !e.error);
    if (subset.length === 0) return 0;
    return subset.reduce((s, e) => s + e.institutionalPressure, 0) / subset.length;
  }
 
  function computeRotationSignal(etfs: ETFResult[]): {
    signal: string;
    color: string;
    description: string;
  } {
    const growthScore   = avg(etfs, ["XLK", "XLY", "XLC", "QQQ"]);
    const defensiveScore= avg(etfs, ["XLP", "XLV"]);
    const altScore      = avg(etfs, ["GLD", "TLT"]);
    const energyScore   = avg(etfs, ["XLE"]);
    const finScore      = avg(etfs, ["XLF"]);
 
    if (growthScore > 20 && altScore < -5)
      return { signal: "RISK-ON · GROWTH", color: "text-accent", description: "Flujo institucional concentrado en tecnología y consumo discrecional. Capital saliendo de refugios." };
    if (altScore > 20 && growthScore < -5)
      return { signal: "RISK-OFF · REFUGIO", color: "text-danger", description: "Capital migrando a bonos y oro. Tecnología y consumo discrecional bajo presión vendedora institucional." };
    if ((energyScore > 20 || finScore > 20) && growthScore < -5)
      return { signal: "ROTACIÓN VALUE", color: "text-warning", description: "Salida de growth/tech hacia energía o finanzas. Típico de entornos de tipos altos o reflación." };
    if (defensiveScore > 20 && growthScore < 0)
      return { signal: "DEFENSIVO · CAUTELA", color: "text-warning", description: "Flujo hacia sectores defensivos (salud, consumo básico). El mercado anticipa desaceleración." };
    return { signal: "MIXTO · SIN TENDENCIA CLARA", color: "text-muted", description: "Flujo institucional disperso entre sectores. Sin señal de rotación dominante." };
  }
 
  function verdictColor(v: Verdict) {
    return v === "ALCISTA" ? "text-accent" : v === "BAJISTA" ? "text-danger" : "text-muted";
  }
  function verdictBorder(v: Verdict) {
    return v === "ALCISTA" ? "border-accent" : v === "BAJISTA" ? "border-danger" : "border-border";
  }
 
  // ─── ScoreBar ─────────────────────────────────────────────────────────────────
  function ScoreBar({ score }: { score: number }) {
    const pct = Math.abs(score) / 2;
    const isPos = score >= 0;
    return (
<div className="w-full h-2 bg-surface rounded-full relative overflow-hidden">
<div className="absolute inset-0 flex items-center">
<div className="w-px h-full bg-border mx-auto" style={{ marginLeft: "50%" }} />
</div>
<div
          className={`absolute top-0 h-full rounded-full ${isPos ? "bg-accent left-1/2" : "bg-danger right-1/2"}`}
          style={{ width: `${pct}%` }}
        />
</div>
    );
  }
 
  // ─── ETF Card ─────────────────────────────────────────────────────────────────
  function ETFCard({ etf }: { etf: ETFResult }) {
    const vc = verdictColor(etf.verdict);
    const vb = verdictBorder(etf.verdict);
    const fmt = (n: number) => n > 0 ? `$${n.toFixed(n >= 100 ? 0 : 2)}` : "—";
 
    if (etf.error) {
      return (
<div className="bg-card border border-border border-t-4 border-t-border p-4 space-y-2 opacity-50">
<div className="flex items-center justify-between">
<span className="text-sm font-bold text-accent tracking-widest">{etf.ticker}</span>
<span className="text-[9px] text-muted tracking-widest">{etf.label}</span>
</div>
<p className="text-xs text-danger">Error: {etf.error}</p>
</div>
      );
    }
 
    return (
<div className={`bg-card border border-border border-t-4 ${vb} p-4 space-y-3`}>
        {/* Header */}
<div className="flex items-center justify-between">
<span className="text-sm font-bold text-accent tracking-widest">{etf.ticker}</span>
<span className="text-[9px] text-muted tracking-widest uppercase">{etf.label}</span>
</div>
 
        {/* Verdict + Score */}
<div className="flex items-end justify-between">
<span className={`text-lg font-black ${vc}`}>{etf.verdict}</span>
<span className={`text-2xl font-black font-mono ${vc}`}>
            {etf.institutionalPressure > 0 ? "+" : ""}{Math.round(etf.institutionalPressure)}
</span>
</div>
 
        {/* Score bar */}
<ScoreBar score={etf.institutionalPressure} />
 
        {/* Metrics */}
<div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
<div>
<p className="text-muted">SPOT</p>
<p className="font-mono text-foreground">${etf.spot.toFixed(2)}</p>
</div>
<div>
<p className="text-muted">PCR</p>
<p className={`font-mono ${etf.putCallRatio > 1.2 ? "text-danger" : etf.putCallRatio < 0.8 ? "text-accent" : "text-foreground"}`}>
              {etf.putCallRatio.toFixed(2)}
</p>
</div>
<div>
<p className="text-muted">SOPORTE</p>
<p className="font-mono text-accent">{fmt(etf.support)}</p>
</div>
<div>
<p className="text-muted">RESIST.</p>
<p className="font-mono text-danger">{fmt(etf.resistance)}</p>
</div>
<div className="col-span-2">
<p className="text-muted">GAMMA FLIP</p>
<p className="font-mono text-warning">{fmt(etf.gammaFlip)}</p>
</div>
</div>
 
        {/* GEX direction */}
<div className="flex items-center gap-1.5 text-[10px] text-muted border-t border-border pt-2">
<span>GEX</span>
<span className={`font-mono font-bold ${etf.netGex >= 0 ? "text-accent" : "text-danger"}`}>
            {etf.netGex >= 0 ? "POSITIVO" : "NEGATIVO"}
</span>
<span className="ml-auto opacity-60">
            {etf.netGex >= 0 ? "Dealers compran → soporte" : "Dealers venden → expansión"}
</span>
</div>
</div>
    );
  }
 
  // ─── Heatmap 12 celdas ───────────────────────────────────────────────────────
  function RotationHeatmap({ etfs }: { etfs: ETFResult[] }) {
    // Ordenar por posición geográfica de sector (de más growth a más refugio)
    const ORDER = ["QQQ","XLK","XLC","XLY","XLI","XLF","XLE","SPY","XLV","XLP","GLD","TLT"];
    const sorted = ORDER.map((t) => etfs.find((e) => e.ticker === t)).filter(Boolean) as ETFResult[];
 
    return (
<div className="space-y-2">
<p className="text-[9px] text-muted tracking-widest font-bold">MAPA DE CALOR · PRESIÓN INSTITUCIONAL POR SECTOR</p>
<div className="grid grid-cols-6 sm:grid-cols-12 gap-1">
          {sorted.map((etf) => {
            const p    = etf.institutionalPressure;
            const abs  = Math.min(Math.abs(p) / 100, 1);
            const bg   = p > 0
              ? `rgba(34,197,94,${0.12 + abs * 0.78})`
              : `rgba(239,68,68,${0.12 + abs * 0.78})`;
            const textColor = abs > 0.45 ? "#fff" : p > 0 ? "#16a34a" : "#dc2626";
            return (
<div
                key={etf.ticker}
                style={{ backgroundColor: bg }}
                className="flex flex-col items-center justify-center py-3 px-1 rounded gap-0.5 border border-white/5"
                title={`${etf.ticker} · ${etf.label} · ${p > 0 ? "+" : ""}${Math.round(p)}`}
>
<span className="text-[10px] font-black tracking-widest" style={{ color: textColor }}>
                  {etf.ticker}
</span>
<span className="text-[9px] font-mono" style={{ color: textColor }}>
                  {p > 0 ? "+" : ""}{Math.round(p)}
</span>
</div>
            );
          })}
</div>
<div className="flex items-center justify-between text-[9px] text-muted mt-1">
<span>← GROWTH / TECH</span>
<span>REFUGIO →</span>
</div>
</div>
    );
  }
 
  // ─── Resumen en bullets ───────────────────────────────────────────────────────
  function buildSummaryLines(etfs: ETFResult[], signal: { signal: string }): string[] {
    const sorted     = [...etfs].filter((e) => !e.error).sort((a, b) => b.institutionalPressure - a.institutionalPressure);
    const top        = sorted[0];
    const bottom     = sorted[sorted.length - 1];
    const alcistas   = sorted.filter((e) => e.verdict === "ALCISTA");
    const bajistas   = sorted.filter((e) => e.verdict === "BAJISTA");
    const growthAvg  = avg(etfs, ["XLK","XLY","XLC","QQQ"]);
    const altAvg     = avg(etfs, ["GLD","TLT"]);
    const spread     = growthAvg - altAvg;
 
    const lines: string[] = [];
 
    // 1. Señal dominante
    lines.push(`Señal dominante: ${signal.signal}. ${alcistas.length} sectores con flujo alcista, ${bajistas.length} con flujo bajista.`);
 
    // 2. Sector líder
    if (top) lines.push(`Mayor presión institucional: ${top.ticker} (${top.label}) con score ${top.institutionalPressure > 0 ? "+" : ""}${Math.round(top.institutionalPressure)}. ${top.verdict ===
   "ALCISTA" ? "Dealers acumulando gamma positiva — soporte mecánico activo." : "Gamma negativa dominante — dealers en modo vendedor."}`);
 
    // 3. Sector más débil
    if (bottom) lines.push(`Mayor presión bajista: ${bottom.ticker} (${bottom.label}) con score ${Math.round(bottom.institutionalPressure)}. ${bottom.putCallRatio > 1.2 ? `PCR
  ${bottom.putCallRatio.toFixed(2)} — cobertura institucional elevada.` : "Sin señal de cobertura significativa aún."}`);
 
    // 4. Divergencia growth vs refugio
    if (Math.abs(spread) > 20)
      lines.push(`Divergencia growth/refugio: ${spread > 0 ? `+${spread.toFixed(0)} puntos a favor del growth (XLK/QQQ vs GLD/TLT). Entorno de apetito por riesgo.` : `${spread.toFixed(0)} puntos
  a favor de los refugios (GLD/TLT vs XLK/QQQ). El mercado se posiciona defensivamente.`}`);
    else
      lines.push(`Divergencia growth/refugio contenida (${spread.toFixed(0)} pts). No hay rotación clara entre activos de riesgo y refugios.`);
 
    // 5. PCR del mercado
    const spyEtf = etfs.find((e) => e.ticker === "SPY");
    if (spyEtf && !spyEtf.error)
      lines.push(`SPY PCR ${spyEtf.putCallRatio.toFixed(2)} — ${spyEtf.putCallRatio > 1.3 ? "cobertura bajista elevada, posible suelo técnico cercano." : spyEtf.putCallRatio < 0.8 ? "complacencia
   alcista, escasa cobertura institucional." : "equilibrio entre calls y puts, sin señal extrema."}`);
 
    return lines;
  }
 
  function SummaryLines({ lines }: { lines: string[] }) {
    return (
<div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-4 border-t border-border">
        {lines.map((line, i) => (
<div key={i} className="text-xs text-muted leading-relaxed px-2 border-l-2 border-border">
            {line}
</div>
        ))}
</div>
    );
  }
 
  // ─── Sector colors ────────────────────────────────────────────────────────────
  const TICKER_COLOR: Record<string, string> = {
    SPY: "#22c55e", QQQ: "#60a5fa", XLK: "#3b82f6", XLE: "#f59e0b",
    XLF: "#8b5cf6", XLV: "#10b981", XLI: "#6b7280", XLY: "#ec4899",
    XLP: "#14b8a6", XLC: "#f97316", GLD: "#eab308", TLT: "#94a3b8",
  };
 
 
  // ─── Group heatmap bar ────────────────────────────────────────────────────────
  function GroupBar({ label, etfs, tickers }: { label: string; etfs: ETFResult[]; tickers: string[] }) {
    const score = avg(etfs, tickers);
    const pct   = Math.abs(score) / 2;
    const isPos = score >= 0;
    return (
<div className="space-y-1">
<div className="flex items-center justify-between text-xs">
<span className="text-muted tracking-widest">{label}</span>
<span className={`font-mono font-bold ${isPos ? "text-accent" : "text-danger"}`}>
            {score > 0 ? "+" : ""}{score.toFixed(0)}
</span>
</div>
<div className="w-full h-3 bg-surface rounded-full relative overflow-hidden">
<div className="absolute inset-0 flex items-center">
<div className="w-px h-full bg-border" style={{ marginLeft: "50%" }} />
</div>
<div
            className={`absolute top-0 h-full rounded-full ${isPos ? "bg-accent left-1/2" : "bg-danger right-1/2"}`}
            style={{ width: `${pct}%`, opacity: 0.7 }}
          />
</div>
</div>
    );
  }
 
  // ─── Main page ────────────────────────────────────────────────────────────────
  const GROUP_LABELS: Record<Group, string> = {
    broad:       "AMPLIOS",
    sector:      "SECTORES",
    alternative: "ALTERNATIVOS",
  };
 
  type GroupFilter = "all" | Group;
 
  // ─── Mini heatmap para historial ─────────────────────────────────────────────
  const HEATMAP_ORDER = ["QQQ","XLK","XLC","XLY","XLI","XLF","XLE","XLB","XLV","XLP","GLD","TLT","HYG"];
 
  function MiniHeatmap({ etfs }: { etfs: ETFResult[] }) {
    return (
<div className="flex gap-0.5 flex-wrap mt-1">
        {HEATMAP_ORDER.map((t) => {
          const etf = etfs.find((e) => e.ticker === t);
          if (!etf) return null;
          const p   = etf.institutionalPressure;
          const abs = Math.min(Math.abs(p) / 100, 1);
          const bg  = p > 0
            ? `rgba(34,197,94,${0.15 + abs * 0.75})`
            : `rgba(239,68,68,${0.15 + abs * 0.75})`;
          return (
<div
              key={t}
              title={`${t}: ${p > 0 ? "+" : ""}${Math.round(p)}`}
              style={{ backgroundColor: bg }}
              className="w-6 h-5 rounded-sm flex items-center justify-center"
>
<span className="text-[7px] font-bold text-white/80">{t.replace("XL","")}</span>
</div>
          );
        })}
</div>
    );
  }
 
  function signalColor(signal: string) {
    if (signal.includes("RISK-ON"))    return "text-accent";
    if (signal.includes("RISK-OFF"))   return "text-danger";
    if (signal.includes("VALUE"))      return "text-warning";
    if (signal.includes("DEFENSIVO"))  return "text-warning";
    return "text-muted";
  }
 
  export default function RotacionPage() {
    const { dark, toggleTheme } = useTheme();
    const [data, setData] = useState<RotationData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
    const [history, setHistory] = useState<HistorySnapshot[]>([]);
 
    useEffect(() => {
      fetch("/api/rotation/history")
        .then((r) => r.json())
        .then((j) => setHistory(j.snapshots ?? []))
        .catch((e) => console.error("rotation history fetch failed:", e));
    }, []);
 
    const handleScan = useCallback(async () => {
      setLoading(true);
      setError("");
      try {
        const res  = await fetch("/api/rotation");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Error al obtener datos");
        setData(json);
        // Refrescar historial tras el nuevo scan
        fetch("/api/rotation/history")
          .then((r) => r.json())
          .then((j) => setHistory(j.snapshots ?? []))
          .catch((e) => console.error("rotation history refresh failed:", e));
      } catch (e: any) {
        setError(e.message);
      }
      setLoading(false);
    }, []);
 
    const rotationSignal = data ? computeRotationSignal(data.etfs) : null;
 
    const visibleEtfs = data
      ? groupFilter === "all"
        ? data.etfs
        : data.etfs.filter((e) => e.group === groupFilter)
      : [];
 
    return (
<div className="min-h-screen bg-bg text-text">
 
        <Nav active="rotacion" />
 
        <div className="px-4 sm:px-6 pt-6 pb-2">
<PageHeader
            title="ROTACIÓN"
            summary="Flujo institucional sector por sector: qué ETFs están entrando y saliendo del capital. Genera una señal global RISK-ON, RISK-OFF, VALUE o CAUTELA con base en los 13 ETFs
  principales."
          />
</div>
 
        {/* Intro */}
<div className="bg-surface border-b border-border px-4 sm:px-6 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
<div>
<div className="text-[9px] text-muted tracking-widest font-bold mb-1">QUÉ DETECTA</div>
<div className="text-xs text-subtle leading-relaxed">Flujo institucional de opciones en 12 ETFs sectoriales. Identifica hacia qué sectores está migrando el capital.</div>
</div>
<div>
<div className="text-[9px] text-muted tracking-widest font-bold mb-1">CÓMO FUNCIONA</div>
<div className="text-xs text-subtle leading-relaxed">Corre el modelo GEX (M1) en paralelo sobre SPY, QQQ y 10 sector ETFs. Compara la presión institucional entre grupos para detectar
  rotación.</div>
</div>
<div>
<div className="text-[9px] text-muted tracking-widest font-bold mb-1">SEÑAL DE ROTACIÓN</div>
<div className="text-xs text-subtle leading-relaxed">RISK-ON: flujo en XLK/XLY/QQQ. RISK-OFF: flujo en GLD/TLT. VALUE: flujo en XLE/XLF con XLK bajista.</div>
</div>
</div>
 
        {/* Scan button */}
<div className="border-b border-border px-4 sm:px-6 py-3 bg-bg flex items-center justify-between">
<div className="text-xs text-muted tracking-widest">
            12 ETFs sectoriales · SPY · QQQ · XLK · XLE · XLF · XLV · XLI · XLY · XLP · XLC · GLD · TLT
</div>
<button
            onClick={handleScan}
            disabled={loading}
            className="bg-accent text-white px-6 py-2 text-sm font-bold tracking-widest hover:opacity-80 disabled:opacity-40 transition-opacity"
>
            {loading ? "ANALIZANDO..." : "ESCANEAR ROTACIÓN"}
</button>
</div>
 
        {/* Error */}
        {error && (
<div className="mx-4 sm:mx-6 mt-4 border border-danger text-danger text-sm p-3">{error}</div>
        )}
 
        {/* Empty state */}
        {!data && !loading && !error && (
<div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-muted">
<p className="text-base tracking-widest font-bold">ROTACIÓN DE CAPITAL INSTITUCIONAL</p>
<p className="text-sm opacity-60">Presiona ESCANEAR ROTACIÓN para analizar los 12 ETFs</p>
<div className="grid grid-cols-6 gap-2 text-xs opacity-30 mt-2">
              {["SPY","QQQ","XLK","XLE","XLF","XLV","XLI","XLY","XLP","XLC","GLD","TLT"].map((t) => (
<span key={t} className="border border-border px-2 py-1 text-center">{t}</span>
              ))}
</div>
</div>
        )}
 
        {/* Loading */}
        {loading && (
<div className="flex flex-col items-center justify-center h-[60vh] gap-4">
<div className="w-10 h-10 border-4 border-accent border-t-transparent animate-spin rounded-full" />
<p className="text-sm text-muted tracking-widest">ANALIZANDO 12 ETFs EN PARALELO...</p>
<p className="text-xs text-muted opacity-50">SPY · QQQ · XLK · XLE · XLF · XLV · XLI · XLY · XLP · XLC · GLD · TLT</p>
</div>
        )}
 
        {/* Results */}
        {data && !loading && (
<main className="p-4 sm:p-6 space-y-6">
 
            {/* Rotation signal hero */}
            {rotationSignal && (
<section className="bg-card border border-border p-6 space-y-4">
<p className="text-[9px] text-muted tracking-widest">SEÑAL GLOBAL DE ROTACIÓN · GEX INSTITUCIONAL · {new Date(data.timestamp).toLocaleTimeString("es-ES")}</p>
<p className={`text-3xl sm:text-4xl font-black tracking-widest ${rotationSignal.color}`}>
                  {rotationSignal.signal}
</p>
<p className="text-sm text-subtle leading-relaxed max-w-2xl">{rotationSignal.description}</p>
 
                {/* Group pressure bars */}
<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-border">
<div className="space-y-2">
<p className="text-[9px] text-muted tracking-widest font-bold">GROWTH / TECH</p>
<GroupBar label="XLK · XLY · XLC · QQQ" etfs={data.etfs} tickers={["XLK","XLY","XLC","QQQ"]} />
</div>
<div className="space-y-2">
<p className="text-[9px] text-muted tracking-widest font-bold">DEFENSIVOS</p>
<GroupBar label="XLP · XLV · XLI" etfs={data.etfs} tickers={["XLP","XLV","XLI"]} />
<GroupBar label="XLE · XLF" etfs={data.etfs} tickers={["XLE","XLF"]} />
</div>
<div className="space-y-2">
<p className="text-[9px] text-muted tracking-widest font-bold">ALTERNATIVOS (REFUGIO)</p>
<GroupBar label="GLD · TLT" etfs={data.etfs} tickers={["GLD","TLT"]} />
</div>
</div>
</section>
            )}
 
            {/* Heatmap */}
<section className="bg-card border border-border p-6">
<RotationHeatmap etfs={data.etfs} />
<SummaryLines lines={buildSummaryLines(data.etfs, rotationSignal!)} />
</section>
 
            {/* Group filter */}
<div className="flex items-center gap-2">
<p className="text-[9px] text-muted tracking-widest font-bold">FILTRAR:</p>
              {(["all", "broad", "sector", "alternative"] as const).map((g) => (
<button
                  key={g}
                  onClick={() => setGroupFilter(g)}
                  className={`text-xs px-3 py-1 border tracking-widest transition-colors ${
                    groupFilter === g
                      ? "bg-accent text-white border-accent"
                      : "border-border text-muted hover:text-text"
                  }`}
>
                  {g === "all" ? "TODOS" : GROUP_LABELS[g]}
</button>
              ))}
</div>
 
            {/* ETF grid */}
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {visibleEtfs.map((etf) => (
<ETFCard key={etf.ticker} etf={etf} />
              ))}
</div>
 
            {/* Footer note */}
<p className="text-[10px] text-muted text-center pb-4 opacity-50 tracking-widest">
              Actualizado {new Date(data.timestamp).toLocaleString("es-ES")} · Score basado en GEX + PCR (M1) · Presión institucional −100 a +100
</p>
 
            {/* Historial de scans */}
            {history.length > 0 && (
<section className="bg-card border border-border p-6 space-y-4">
<p className="text-[9px] text-muted tracking-widest font-bold">HISTORIAL DE SCANS · ULTIMOS {history.length}</p>
<div className="space-y-3">
                  {history.map((snap) => (
<div key={snap.id} className="border border-border p-3 space-y-1">
<div className="flex items-center justify-between">
<span className={`text-xs font-bold tracking-widest ${signalColor(snap.signal)}`}>{snap.signal}</span>
<span className="text-[10px] text-muted">{new Date(snap.created_at).toLocaleString("es-ES")}</span>
</div>
<div className="flex gap-4 text-[10px] text-muted">
<span>GROWTH <span className={snap.growth_avg >= 0 ? "text-accent" : "text-danger"}>{snap.growth_avg > 0 ? "+" : ""}{Math.round(snap.growth_avg)}</span></span>
<span>DEFENSIVO <span className={snap.defensive_avg >= 0 ? "text-accent" : "text-danger"}>{snap.defensive_avg > 0 ? "+" : ""}{Math.round(snap.defensive_avg)}</span></span>
<span>REFUGIO <span className={snap.alt_avg >= 0 ? "text-accent" : "text-danger"}>{snap.alt_avg > 0 ? "+" : ""}{Math.round(snap.alt_avg)}</span></span>
</div>
<MiniHeatmap etfs={snap.etfs} />
</div>
                  ))}
</div>
</section>
            )}
</main>
        )}
</div>
    );
  }