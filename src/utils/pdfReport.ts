import jsPDF from 'jspdf';
import type { GeoPoint, MarketPrices, MarketScenario } from '../data';

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 16;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = '#1a1a1a';
const MUTED = '#6b6b6b';
const ACCENT = '#0d7a5f';
const DANGER = '#b3261e';
const RULE = '#d9d9d9';

interface Writer {
  doc: jsPDF;
  y: number;
}

function newPage(w: Writer, title: string) {
  w.doc.addPage();
  w.y = MARGIN;
  header(w, title);
}

function ensure(w: Writer, h: number, title: string) {
  if (w.y + h > PAGE_H - MARGIN) newPage(w, title);
}

function header(w: Writer, title: string) {
  w.doc.setFont('helvetica', 'normal');
  w.doc.setFontSize(7.5);
  w.doc.setTextColor(MUTED);
  w.doc.text('CAPITAL GRAVITY — REPORTE DE MERCADO', MARGIN, w.y);
  w.doc.text(title.toUpperCase(), PAGE_W - MARGIN, w.y, { align: 'right' });
  w.y += 3;
  w.doc.setDrawColor(RULE);
  w.doc.line(MARGIN, w.y, PAGE_W - MARGIN, w.y);
  w.y += 8;
}

function sectionTitle(w: Writer, text: string, pageTitle: string) {
  ensure(w, 14, pageTitle);
  w.doc.setFont('helvetica', 'bold');
  w.doc.setFontSize(13);
  w.doc.setTextColor(INK);
  w.doc.text(text, MARGIN, w.y);
  w.y += 2;
  w.doc.setDrawColor(ACCENT);
  w.doc.setLineWidth(0.6);
  w.doc.line(MARGIN, w.y, MARGIN + 26, w.y);
  w.doc.setLineWidth(0.2);
  w.y += 7;
}

function subTitle(w: Writer, text: string, pageTitle: string, color = INK) {
  ensure(w, 8, pageTitle);
  w.doc.setFont('helvetica', 'bold');
  w.doc.setFontSize(9.5);
  w.doc.setTextColor(color);
  w.doc.text(text, MARGIN, w.y);
  w.y += 5;
}

function para(w: Writer, text: string, pageTitle: string, opts: { size?: number; color?: string; italic?: boolean } = {}) {
  const size = opts.size ?? 8.5;
  w.doc.setFont('helvetica', opts.italic ? 'italic' : 'normal');
  w.doc.setFontSize(size);
  w.doc.setTextColor(opts.color ?? INK);
  const lines: string[] = w.doc.splitTextToSize(text, CONTENT_W);
  const lh = size * 0.42;
  for (const line of lines) {
    ensure(w, lh + 1, pageTitle);
    w.doc.text(line, MARGIN, w.y);
    w.y += lh;
  }
  w.y += 2;
}

function formula(w: Writer, text: string, pageTitle: string) {
  ensure(w, 9, pageTitle);
  w.doc.setFillColor(245, 246, 244);
  w.doc.setDrawColor(RULE);
  w.doc.roundedRect(MARGIN, w.y - 4.5, CONTENT_W, 8, 1, 1, 'FD');
  w.doc.setFont('courier', 'bold');
  w.doc.setFontSize(9.5);
  w.doc.setTextColor(ACCENT);
  w.doc.text(text, MARGIN + 4, w.y);
  w.y += 8;
}

function bullet(w: Writer, label: string, value: string, pageTitle: string) {
  ensure(w, 6, pageTitle);
  w.doc.setFont('courier', 'normal');
  w.doc.setFontSize(7.5);
  w.doc.setTextColor(MUTED);
  const lines: string[] = w.doc.splitTextToSize(`${label}  ${value}`, CONTENT_W - 4);
  for (const line of lines) {
    ensure(w, 4, pageTitle);
    w.doc.text(line, MARGIN + 3, w.y);
    w.y += 3.6;
  }
}

function divider(w: Writer) {
  w.y += 1;
  w.doc.setDrawColor(RULE);
  w.doc.line(MARGIN, w.y, PAGE_W - MARGIN, w.y);
  w.y += 5;
}

interface ReportParams {
  marketPrices: MarketPrices;
  activeScenario: MarketScenario;
  geoPoints: GeoPoint[];
  darkMode: boolean;
}

const TIER_LABEL: Record<'high' | 'medium' | 'low', string> = { high: 'ALTA', medium: 'MEDIA', low: 'BAJA' };
const TIER_COLOR: Record<'high' | 'medium' | 'low', string> = { high: ACCENT, medium: MUTED, low: DANGER };

export function generateMarketReportPDF({ marketPrices, activeScenario, geoPoints }: ReportParams) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const w: Writer = { doc, y: MARGIN };
  const now = new Date();
  const stamp = now.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });

  // ── Portada ────────────────────────────────────────────────
  doc.setFillColor(17, 17, 17);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  doc.setTextColor(230, 230, 230);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.text('CAPITAL GRAVITY', PAGE_W / 2, 110, { align: 'center' });
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 180, 180);
  doc.text('Reporte de Análisis de Mercado en Vivo', PAGE_W / 2, 120, { align: 'center' });
  doc.text('y Puntos de Gravedad de Capital por País', PAGE_W / 2, 127, { align: 'center' });

  doc.setFontSize(9);
  doc.setTextColor(140, 140, 140);
  doc.text(`Generado: ${stamp}`, PAGE_W / 2, 145, { align: 'center' });
  doc.text(`Escenario activo: ${activeScenario.name}`, PAGE_W / 2, 151, { align: 'center' });
  if (activeScenario.macroRegime) {
    doc.text(`Régimen macro: ${activeScenario.macroRegime}`, PAGE_W / 2, 157, { align: 'center' });
  }

  doc.setDrawColor(80, 80, 80);
  doc.line(PAGE_W / 2 - 30, 168, PAGE_W / 2 + 30, 168);
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text('Motor de Gravedad de Capital — Modelo cuantitativo de flujos globales', PAGE_W / 2, 178, { align: 'center' });
  doc.text('Contenido: cotizaciones en vivo · centros de gravedad · metodología completa · alcance del proyecto', PAGE_W / 2, 183, { align: 'center', maxWidth: 160 });

  // ── 1. Cotizaciones en vivo ────────────────────────────────
  const pt1 = 'Cotizaciones en Vivo';
  newPage(w, pt1);
  sectionTitle(w, '1. Cotizaciones en Vivo', pt1);
  para(w, 'Precios de referencia macro obtenidos en tiempo real (Yahoo Finance). Estos valores alimentan directamente el cálculo de DISTANCIA (volatilidad, spread) y RÉGIMEN MACRO del modelo de gravedad.', pt1, { size: 8, color: MUTED, italic: true });

  const quoteRows: [string, MarketPrices[keyof MarketPrices]][] = [
    ['Índice DXY', marketPrices.dxy],
    ['Oro Spot', marketPrices.gold],
    ['BTC / USD', marketPrices.btc],
    ['NASDAQ', marketPrices.nasdaq],
    ['Dow Jones', marketPrices.dowjones],
    ['S&P 500', marketPrices.sp500],
    ['Crudo WTI', marketPrices.wti],
    ['Crudo Brent', marketPrices.brent],
  ];
  const colW = CONTENT_W / 2;
  quoteRows.forEach(([label, data], i) => {
    const col = i % 2;
    if (col === 0) ensure(w, 10, pt1);
    const x = MARGIN + col * colW;
    const rowY = w.y;
    doc.setDrawColor(RULE);
    doc.roundedRect(x, rowY - 5, colW - 4, 9, 1, 1, 'S');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text(label.toUpperCase(), x + 3, rowY - 1.3);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(INK);
    doc.text(String(data.value), x + 3, rowY + 3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(data.trend === 'up' ? ACCENT : data.trend === 'down' ? DANGER : MUTED);
    doc.text(String(data.change), x + colW - 7, rowY + 3, { align: 'right' });
    if (col === 1) w.y += 11;
  });
  if (quoteRows.length % 2 === 1) w.y += 11;
  divider(w);

  if (activeScenario.description) {
    subTitle(w, 'Lectura del escenario activo', pt1);
    para(w, activeScenario.description, pt1);
  }
  if (activeScenario.rotationSignal) {
    bullet(w, 'Rotación sectorial:', activeScenario.rotationSignal, pt1);
  }
  if (activeScenario.newsContext) {
    bullet(w, 'Sentimiento de noticias:', `${activeScenario.newsContext.newsSentiment.toUpperCase()} (score ${activeScenario.newsContext.sentimentScore.toFixed(2)})`, pt1);
    if (activeScenario.newsContext.regimeSignal) bullet(w, 'Señal de régimen:', activeScenario.newsContext.regimeSignal, pt1);
  }

  // ── 2. Puntos de gravedad por país / activo ───────────────
  const pt2 = 'Puntos de Gravedad';
  newPage(w, pt2);
  sectionTitle(w, '2. Puntos de Gravedad de Capital por País', pt2);
  para(w, 'Fuerza gravitacional G = (MASA − DISTANCIA) / FRICCIÓN calculada para cada centro geográfico/activo del escenario activo. Clasificación en tres niveles por umbral dinámico media ± 0.5σ sobre el conjunto de puntos.', pt2, { size: 8, color: MUTED, italic: true });

  const metrics = activeScenario.metrics ?? {};
  const rows = geoPoints.map(p => {
    const m = metrics[p.id];
    const force = m ? (m.masa - m.distancia) / Math.max(1, m.friccion) : 0;
    return { point: p, m, force };
  }).filter(r => r.m);
  const forces = rows.map(r => r.force);
  const mean = forces.reduce((a, b) => a + b, 0) / Math.max(1, forces.length);
  const sigma = Math.sqrt(forces.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, forces.length));
  const highT = mean + 0.5 * sigma;
  const lowT = mean - 0.5 * sigma;
  rows.sort((a, b) => b.force - a.force);

  // table header
  ensure(w, 8, pt2);
  doc.setFillColor(238, 238, 236);
  doc.rect(MARGIN, w.y - 4.5, CONTENT_W, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(INK);
  const cols = [MARGIN + 2, MARGIN + 42, MARGIN + 66, MARGIN + 90, MARGIN + 114, MARGIN + 138, MARGIN + 158];
  doc.text('PUNTO', cols[0], w.y);
  doc.text('TIPO', cols[1], w.y);
  doc.text('MASA', cols[2], w.y);
  doc.text('DIST.', cols[3], w.y);
  doc.text('FRICC.', cols[4], w.y);
  doc.text('FUERZA G', cols[5], w.y);
  doc.text('NIVEL', cols[6], w.y);
  w.y += 6;

  rows.forEach(({ point, m, force }) => {
    ensure(w, 6.5, pt2);
    const tier: 'high' | 'medium' | 'low' = force >= highT ? 'high' : force <= lowT ? 'low' : 'medium';
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(INK);
    doc.text(point.name, cols[0], w.y);
    doc.setTextColor(MUTED);
    doc.text(point.type === 'country' ? 'País/Región' : 'Activo', cols[1], w.y);
    doc.text(String(m!.masa), cols[2], w.y);
    doc.text(String(m!.distancia), cols[3], w.y);
    doc.text(String(m!.friccion), cols[4], w.y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(TIER_COLOR[tier]);
    doc.text(force.toFixed(2), cols[5], w.y);
    doc.text(TIER_LABEL[tier], cols[6], w.y);
    w.y += 5.5;
  });

  divider(w);
  bullet(w, 'Umbral ALTA:', `≥ ${highT.toFixed(2)}`, pt2);
  bullet(w, 'Umbral MEDIA:', `${lowT.toFixed(2)} — ${highT.toFixed(2)}`, pt2);
  bullet(w, 'Umbral BAJA:', `≤ ${lowT.toFixed(2)}`, pt2);

  if (activeScenario.gravityCenters?.length) {
    w.y += 3;
    subTitle(w, 'Centros de gravedad declarados del escenario', pt2);
    para(w, activeScenario.gravityCenters.join(', '), pt2);
  }
  if (activeScenario.flows?.length) {
    w.y += 2;
    subTitle(w, 'Flujos de capital dominantes', pt2);
    activeScenario.flows.slice(0, 10).forEach(f => {
      bullet(w, `${f.from} -> ${f.to}`, `(fuerza ${f.strength.toFixed(2)}) ${f.label}`, pt2);
    });
  }

  // ── 3. Metodología: fórmulas ───────────────────────────────
  const pt3 = 'Metodología y Fórmulas';
  newPage(w, pt3);
  sectionTitle(w, '3. Metodología — Leyes de Gravedad Financiera', pt3);
  para(w, 'El modelo trata al capital global como masas que se atraen o repelen entre centros de gravedad (países, activos, sectores, empresas). Cada fórmula cuantifica una fuerza física-financiera análoga a la ley de gravitación universal.', pt3);

  subTitle(w, 'Fuerza gravitacional principal', pt3, ACCENT);
  formula(w, 'G = (MASA − DISTANCIA) / FRICCIÓN', pt3);
  para(w, 'Utilidad: mide qué tan fuertemente un centro atrae capital. A mayor MASA (atractivo fundamental) y menor DISTANCIA (riesgo) y FRICCIÓN (costo de entrada/salida), mayor la fuerza G y mayor probabilidad de que el capital fluya hacia ese punto.', pt3);

  subTitle(w, 'MASA (M) — Atractivo del activo [0-100]', pt3, ACCENT);
  formula(w, 'M = w1*Return + w2*Growth + w3*Liquidez + w4*Confianza', pt3);
  bullet(w, 'Return =', 'PriceReturn*0.20 + Momentum*0.20 + RetornoDiario*0.30 + EarningsYield*0.30', pt3);
  bullet(w, 'Growth =', 'CrecimientoEPS*0.50 + ROE*0.30 + DivYield*0.20', pt3);
  bullet(w, 'Liquidez =', 'Volumen*0.50 + MarketCap*0.30 + DivYield*0.20', pt3);
  bullet(w, 'Confianza =', 'Momentum*0.40 + ROE*0.30 + CreditRating*0.30', pt3);
  para(w, 'Utilidad: cuantifica cuán "pesado" o fundamentalmente sólido es un activo/país — rentabilidad, crecimiento, capacidad de convertirse en efectivo y confianza institucional. Es la fuerza de atracción bruta antes de descontar riesgo y costos.', pt3, { size: 8, color: MUTED, italic: true });

  subTitle(w, 'DISTANCIA (d) — Riesgo y barreras [0-100]', pt3, DANGER);
  formula(w, 'd = Volatilidad + Spread + (1 - correlación) * 30', pt3);
  bullet(w, 'Volatilidad =', 'VIX*rango52sem + VolatilidadHistórica + índice MOVE', pt3);
  bullet(w, 'Spread =', 'EstrésHYG + proxy CDS + CPI*0.5 + Tasas + RiesgoPolítico', pt3);
  bullet(w, 'correlación =', 'correlación de retornos contra activo de referencia', pt3);
  para(w, 'Utilidad: representa cuánto "cuesta" en riesgo llegar hasta ese centro de gravedad. Mayor volatilidad, mayor estrés crediticio o menor correlación con el activo ancla implican mayor distancia efectiva, penalizando la fuerza G.', pt3, { size: 8, color: MUTED, italic: true });

  subTitle(w, 'FRICCIÓN (f) — Costos operativos [1-100]', pt3, MUTED);
  formula(w, 'f = BidAsk + CostoTx + ControlCapital + Slippage', pt3);
  bullet(w, 'BidAsk =', '(ask - bid) / Precio', pt3);
  bullet(w, 'CostoTx + ControlCapital =', 'costos regulatorios y fiscales por jurisdicción', pt3);
  bullet(w, 'Slippage =', '1 / MarketCap (proxy de profundidad de mercado)', pt3);
  para(w, 'Utilidad: mide el costo real de ejecutar una operación — spread, impuestos, controles de capital y profundidad del libro de órdenes. Divide la fuerza neta: alta fricción diluye incluso una MASA muy atractiva.', pt3, { size: 8, color: MUTED, italic: true });

  divider(w);
  subTitle(w, 'Presión institucional (robustez sectorial)', pt3, '#b8860b');
  formula(w, 'P = PrecioVolumen*0.40 + Opciones*0.60', pt3);
  bullet(w, 'PrecioVolumen =', 'momentum(MA50) + volSurge + variación % diaria', pt3);
  bullet(w, 'Opciones =', 'GEX neto / PCR derivado de Black-Scholes (gamma)', pt3);
  formula(w, 'gamma = N\'(d1) / (S * sigma * sqrt(T))', pt3);
  formula(w, 'd1 = (ln(S/K) + (r + sigma^2/2)*T) / (sigma*sqrt(T))', pt3);
  formula(w, 'GEX = suma( gamma * OI * 100 * S^2/100 ) calls - puts', pt3);
  para(w, 'Utilidad: incorpora el posicionamiento de grandes jugadores institucionales vía el mercado de opciones. Un GEX positivo alto sugiere que los creadores de mercado amortiguan movimientos (menor volatilidad esperada); un PCR elevado señala cobertura defensiva o pesimismo.', pt3, { size: 8, color: MUTED, italic: true });

  ensure(w, 20, pt3);
  subTitle(w, 'Fuerza G ajustada por sector y país', pt3, ACCENT);
  formula(w, 'G_adj = (M - d) + clamp(P/5, -15, 15) * domFactor', pt3);
  para(w, 'Utilidad: ajusta la fuerza base de un sector según la presión institucional reciente (opciones/volumen) ponderada por el peso estructural de ese sector en la economía del país (domFactor). Permite detectar rotación sectorial en tiempo real.', pt3, { size: 8, color: MUTED, italic: true });

  subTitle(w, 'Régimen macro (ajuste VIX + noticias)', pt3, DANGER);
  formula(w, 'régimen = VIX_base + delta_sentimiento_noticias', pt3);
  bullet(w, 'VIX < 15 ->', 'RISK-ON', pt3);
  bullet(w, 'VIX 15-20 ->', 'NEUTRAL', pt3);
  bullet(w, 'VIX 20-30 ->', 'RISK-OFF', pt3);
  bullet(w, 'VIX > 30 ->', 'CRISIS', pt3);
  para(w, 'Utilidad: clasifica el clima de mercado global en 4 regímenes que reponderan MASA/DISTANCIA/FRICCIÓN de todo el modelo. El sentimiento de noticias (score -3 a +3, extraído de titulares de Yahoo Finance e Investing.com) puede desplazar el régimen un nivel arriba o abajo.', pt3, { size: 8, color: MUTED, italic: true });

  // ── página fuerza G por empresa ────────────────────────────
  const pt3b = 'Metodología — Fuerza G por Empresa';
  newPage(w, pt3b);
  sectionTitle(w, '3.1 Fuerza G por Empresa (cálculo on-demand)', pt3b);
  para(w, 'Al seleccionar sector + país en el mapa, el sistema calcula en vivo la fuerza G individual de las 10 empresas representativas de esa combinación, usando precios y opciones reales.', pt3b);

  formula(w, 'G = (M_adj - d) / f', pt3b);
  formula(w, 'M_adj = M + clamp(P_inst/5, -15, +15)', pt3b);

  subTitle(w, 'MASA — componentes de empresa', pt3b, ACCENT);
  bullet(w, 'Return =', 'PriceReturn52sem*0.20 + Momentum50d*0.20 + Var%día*0.30 + E/P*0.30', pt3b);
  bullet(w, 'Growth =', 'CrecimientoEPS*0.50 + ROE*0.30 + DivYield*0.20', pt3b);
  bullet(w, 'Liquidez =', 'Vol/VolPromedio*0.50 + log(MarketCap)*0.30 + DivYield*0.20', pt3b);
  bullet(w, 'Confianza =', 'Momentum50d*0.40 + ROE*0.30 + InstScore*0.30', pt3b);

  subTitle(w, 'Presión institucional — P_inst', pt3b, '#b8860b');
  formula(w, 'P_inst = PrecioVolumen*0.40 + Opciones*0.60', pt3b);
  bullet(w, 'GEX =', 'suma(gamma*OI*100*S^2) calls - suma(gamma*OI*100*S^2) puts', pt3b);
  bullet(w, 'gamma =', 'e^(-d1^2/2) / (S*sigma*sqrt(T)*sqrt(2*pi))', pt3b);
  bullet(w, 'GammaFlip =', 'precio donde el GEX neto acumulado cambia de signo', pt3b);
  bullet(w, 'PCR =', 'volumen de puts / volumen de calls', pt3b);
  para(w, 'Utilidad: el GammaFlip identifica el nivel de precio donde los creadores de mercado pasan de estabilizar a amplificar movimientos — una zona crítica de riesgo/oportunidad para trading institucional.', pt3b, { size: 8, color: MUTED, italic: true });

  subTitle(w, 'DISTANCIA y FRICCIÓN — empresa', pt3b, DANGER);
  bullet(w, 'd =', 'clamp(Volat + Spread + (1-correl)*30 / 1.2, 10, 90)', pt3b);
  bullet(w, 'f =', '(BidAsk + Slippage + CostoTx - LiqBonus) * multRégimen', pt3b);

  subTitle(w, 'Umbral dinámico y clasificación', pt3b, ACCENT);
  bullet(w, 'threshold =', 'media(G_empresas) + 0.5 * sigma(G_empresas)', pt3b);
  para(w, 'Empresas con G >= threshold se marcan como Centro de Gravedad (verde); las que caen 0.5sigma por debajo se marcan en rojo (capital en fuga); el resto queda en la franja media (gris). El cálculo se recalcula on-demand con datos en vivo cada vez que se selecciona un sector y país.', pt3b, { size: 8, color: MUTED, italic: true });

  // ── 4. Utilidad, alcance y escalabilidad ──────────────────
  const pt4 = 'Utilidad, Alcance y Escalabilidad';
  newPage(w, pt4);
  sectionTitle(w, '4. Utilidad del Proyecto', pt4);
  para(w, 'Capital Gravity traduce señales macro, de mercado y de opciones dispersas en un único indicador comparable — la Fuerza G — que responde a la pregunta operativa "¿hacia dónde se está moviendo el capital ahora, y por qué". Sustituye la lectura manual de decenas de dashboards (VIX, ETFs, opciones, noticias, geopolítica) por un modelo unificado y explicable, donde cada número final es trazable hasta sus componentes fundamentales.', pt4);
  para(w, 'Casos de uso: (1) mesas de asignación táctica que necesitan justificar rotaciones sectoriales o geográficas con una métrica cuantitativa y no solo intuición; (2) analistas que monitorean riesgo geopolítico y su impacto sectorial en tiempo real vía el overlay de eventos; (3) research que necesita una capa narrativa (IA) sobre datos duros para comunicar hallazgos rápidamente.', pt4);

  sectionTitle(w, 'Alcance actual', pt4);
  bullet(w, '-', 'Cobertura macro: DXY, oro, BTC, Nasdaq (^NDX), Dow Jones, S&P 500, WTI, Brent en vivo (Yahoo Finance2).', pt4);
  bullet(w, '-', '9 centros de gravedad globales (países/regiones y clases de activo) con métricas MASA/DISTANCIA/FRICCIÓN por escenario.', pt4);
  bullet(w, '-', '11 sectores x 7 países G7 (EE.UU., Canadá, Francia, Alemania, Italia, Japón, Reino Unido) con perfil estructural propio.', pt4);
  bullet(w, '-', '770 empresas representativas (10 por sector/país) con Fuerza G calculada on-demand vía Black-Scholes (GEX/PCR/gamma).', pt4);
  bullet(w, '-', '6 focos geopolíticos activos (Rusia-Ucrania, Medio Oriente, Mar Rojo, Taiwán, Mar del Sur de China, Irán) con sectores beneficiados/perjudicados e impacto en cadena de suministro.', pt4);
  bullet(w, '-', 'Capa de análisis narrativo generada con IA (Gemini) sobre el estado del régimen macro, con caché de 60 min y fallback determinístico si la IA no responde.', pt4);

  sectionTitle(w, 'Escalabilidad', pt4);
  para(w, 'La arquitectura (Next.js + rutas API independientes por dominio: precios, análisis en vivo, análisis por empresa) permite escalar en tres ejes sin rediseño:', pt4);
  bullet(w, 'Cobertura geográfica:', 'agregar países fuera del G7 solo requiere un nuevo perfil sectorial (domFactor) y su set de tickers ETF/local — no cambia el motor de cálculo.', pt4);
  bullet(w, 'Profundidad de datos:', 'el cálculo on-demand de empresas (Black-Scholes sobre opciones reales) es la misma ruta que soportaría expandir de 10 a N empresas por sector, o añadir clases de activo (renta fija corporativa, FX cruzado, commodities agrícolas).', pt4);
  bullet(w, 'Distribución:', 'el modelo entrega un número único (Fuerza G) y sus componentes trazables, lo que lo hace apto para exponerse como API a mesas de trading, alimentarse a un motor de alertas (umbral dinámico ya calculado) o integrarse en un backtester histórico guardando snapshots de escenario.', pt4);
  bullet(w, 'Capa IA:', 'el patrón de caché por régimen + fallback silencioso usado para Gemini es reutilizable para incorporar otros proveedores de LLM o señales adicionales (transcripciones de earnings calls, sentiment de redes sociales) sin tocar el resto del sistema.', pt4);

  divider(w);
  para(w, 'Este documento fue generado automáticamente desde los datos en vivo de la sesión activa. Los valores reflejan el estado del mercado y del modelo en el momento de la descarga.', pt4, { size: 7.5, color: MUTED, italic: true });

  const pageCount = doc.getNumberOfPages();
  for (let i = 2; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text(`${i - 1} / ${pageCount - 1}`, PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' });
  }

  const fname = `capital-gravity-reporte-${now.toISOString().slice(0, 10)}.pdf`;
  doc.save(fname);
}
