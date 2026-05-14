import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { Type } from '@/src/data';
import type { MarketScenario } from '@/src/data';

export async function GET() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not set' }, { status: 500 });
  }

  const ai = new GoogleGenAI({ apiKey: key });
  const currentDate = new Date().toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Gemini request timed out after 30s')), 30_000)
  );

  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: buildPrompt(currentDate),
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: buildSchema(),
        },
      }),
      timeoutPromise,
    ]);

    const text = response.text;
    if (!text) throw new Error('Gemini returned empty response');

    const data = JSON.parse(text) as MarketScenario;
    if (!data.id || !data.flows || !data.metrics) {
      throw new Error('Gemini response missing required fields');
    }

    return NextResponse.json({ ...data, lastUpdated: Date.now() });
  } catch (error) {
    console.error('Gemini error:', error);
    return NextResponse.json({ error: 'Failed to fetch live analysis' }, { status: 500 });
  }
}

function buildPrompt(currentDate: string): string {
  return `
Eres un modelo cuantitativo de flujos de capital global. Fecha de análisis: ${currentDate}.

PASO 1 — BÚSQUEDA OBLIGATORIA (usa googleSearch):
Busca los siguientes datos de mercado en tiempo real:
- DXY (índice dólar) nivel actual y tendencia semanal
- VIX (volatilidad S&P500) nivel actual
- MOVE Index (volatilidad bonos del Tesoro)
- US10Y yield actual y pendiente de la curva (10Y-2Y spread)
- IG credit spread y HY credit spread (Bloomberg o ICE BofA)
- ETF flows de la última semana: SPY, QQQ, GLD, TLT, EEM (flujos netos en millones USD)
- Postura actual de la Fed (hawkish/neutral/dovish)
- PMI manufacturero global más reciente
- CDS spreads soberanos de Europa y Mercados Emergentes
- Precio del oro spot y variación semanal
- Precio del petróleo WTI y variación semanal

PASO 2 — IDENTIFICAR RÉGIMEN MACRO:
Basándote en los datos buscados, clasifica el régimen actual:
- "risk-on": VIX < 18, yield curve positiva, flujos ETF equity positivos, spreads HY estables
- "risk-off": VIX 18-28, yield curve plana/invertida, flujos hacia TLT/GLD, spreads ampliándose
- "crisis": VIX > 28, spreads HY > 500bps, flujos masivos a refugios (USD, bonos, oro)
- "neutral": señales mixtas, VIX 15-20, sin tendencia clara

Según el régimen, usa estos pesos dinámicos para calcular Masa:
- risk-on:  w1=0.40 (retorno), w2=0.35 (crecimiento), w3=0.15 (liquidez), w4=0.10 (confianza)
- risk-off: w1=0.15, w2=0.10, w3=0.35, w4=0.40
- crisis:   w1=0.05, w2=0.05, w3=0.45, w4=0.45
- neutral:  w1=0.25, w2=0.25, w3=0.25, w4=0.25

PASO 3 — CALCULAR MÉTRICAS POR ACTIVO (escala 0-100):
Para cada uno de los 8 activos (USD, Europe, Emerging Markets, Gold, Tech, Bonds, Crypto, Oil):

A) COMPONENTES DE MASA (cada sub-variable de 0 a 100):
   - retorno: yield esperado / earnings yield / dividend yield normalizado al rango histórico
   - crecimiento: crecimiento EPS / PIB esperado, momentum precio (mayor = más atractivo)
   - liquidezActivo: profundidad del mercado, volumen de trading, facilidad de entrada/salida
   - confianza: estabilidad institucional, confianza macro, certeza política monetaria
   - masa = w1×retorno + w2×crecimiento + w3×liquidezActivo + w4×confianza

B) COMPONENTES DE DISTANCIA (cada sub-variable de 0 a 100):
   - volatilidad: VIX / vol realizada del activo normalizada (mayor VIX = mayor distancia)
   - spread: credit spread / CDS soberano normalizado (mayor spread = mayor distancia)
   - correlacion: correlación cross-asset con mercado general 0.0-1.0 (usar como fracción)
   - Fórmula: distancia_raw = volatilidad + spread + (1 - correlacion) × 100
   - Normalizar distancia_raw a escala 0-100 relativa entre los 8 activos

C) COMPONENTES DE FRICCIÓN (cada sub-variable de 0 a 100):
   - bidAskSpread: costo de transacción implícito (mayor spread = mayor fricción)
   - restricciones: controles de capital, restricciones regulatorias, burocracia
   - profundidad: liquidez del libro de órdenes (INVERSO: mayor profundidad = menor fricción)
   - friccion = (bidAskSpread + restricciones + (100 - profundidad)) / 3
   - friccion debe quedar en rango 1-30 (muy importante: no puede ser 0)

D) CALCULAR:
   - fuerzaG = (masa - distancia) / friccion
   - gravityCenters son SOLO activos con fuerzaG > 8.0

PASO 4 — CALCULAR FLUJOS BILATERALES:
Para cada par de flujo que identifiques (mínimo 6 flujos, máximo 10):
   - flowTheoretical = (masa_from × masa_to) / (distancia_to × distancia_to) × (1 / friccion_to)
   - zscoreAdjustment: estima en qué medida el flujo actual de ETFs/fondos difiere del típico histórico
     * Usa datos de ETF flows buscados. Rango: -2.0 a +2.0
     * Positivo = flujos por encima del promedio histórico hacia ese destino
     * Negativo = flujos por debajo del promedio histórico
   - flowFinal = flowTheoretical × (1 + zscoreAdjustment)
   - Normaliza todos los flowFinal para que el mayor sea 1.0; ese es el campo strength

REGLA CRÍTICA: Los 8 IDs (USD, Europe, Emerging Markets, Gold, Tech, Bonds, Crypto, Oil) deben aparecer al menos una vez en flows.

PASO 5 — CONSTRUIR RESPUESTA JSON:
- id: "live"
- name: "Realidad del Mercado en Vivo"
- macroRegime: el régimen identificado en PASO 2
- regimeWeights: los pesos usados
- description: 2-3 frases en español justificando los centros de gravedad usando terminología del modelo (Masa, Distancia, Fricción, Flujo)
- gravityCenters: solo IDs con fuerzaG > 8.0
- flows: array con todos los flujos calculados
- metrics: objeto con los 8 activos y sus métricas completas

Todo el contenido de texto debe estar en ESPAÑOL.
  `;
}

function buildSchema() {
  const masaComponentsObj = {
    type: Type.OBJECT,
    properties: {
      retorno:       { type: Type.NUMBER },
      crecimiento:   { type: Type.NUMBER },
      liquidezActivo:{ type: Type.NUMBER },
      confianza:     { type: Type.NUMBER },
    },
    required: ['retorno', 'crecimiento', 'liquidezActivo', 'confianza'],
  };

  const masaWeightsObj = {
    type: Type.OBJECT,
    properties: {
      w1: { type: Type.NUMBER },
      w2: { type: Type.NUMBER },
      w3: { type: Type.NUMBER },
      w4: { type: Type.NUMBER },
    },
    required: ['w1', 'w2', 'w3', 'w4'],
  };

  const distanciaComponentsObj = {
    type: Type.OBJECT,
    properties: {
      volatilidad: { type: Type.NUMBER },
      spread:      { type: Type.NUMBER },
      correlacion: { type: Type.NUMBER },
    },
    required: ['volatilidad', 'spread', 'correlacion'],
  };

  const friccionComponentsObj = {
    type: Type.OBJECT,
    properties: {
      bidAskSpread:  { type: Type.NUMBER },
      restricciones: { type: Type.NUMBER },
      profundidad:   { type: Type.NUMBER },
    },
    required: ['bidAskSpread', 'restricciones', 'profundidad'],
  };

  const metricObject = {
    type: Type.OBJECT,
    properties: {
      masa:                 { type: Type.NUMBER },
      distancia:            { type: Type.NUMBER },
      friccion:             { type: Type.NUMBER },
      masaComponents:       masaComponentsObj,
      masaWeights:          masaWeightsObj,
      distanciaComponents:  distanciaComponentsObj,
      friccionComponents:   friccionComponentsObj,
      fuerzaG:              { type: Type.NUMBER },
      zscoreFlows:          { type: Type.NUMBER },
      masaJustificacion:    { type: Type.STRING },
      distanciaJustificacion: { type: Type.STRING },
      friccionJustificacion:  { type: Type.STRING },
    },
    required: [
      'masa', 'distancia', 'friccion',
      'masaComponents', 'masaWeights',
      'distanciaComponents', 'friccionComponents',
      'fuerzaG', 'zscoreFlows',
      'masaJustificacion', 'distanciaJustificacion', 'friccionJustificacion',
    ],
  };

  const regimeWeightsObj = {
    type: Type.OBJECT,
    properties: {
      w1: { type: Type.NUMBER },
      w2: { type: Type.NUMBER },
      w3: { type: Type.NUMBER },
      w4: { type: Type.NUMBER },
    },
    required: ['w1', 'w2', 'w3', 'w4'],
  };

  return {
    type: Type.OBJECT,
    properties: {
      id:            { type: Type.STRING },
      name:          { type: Type.STRING },
      description:   { type: Type.STRING },
      macroRegime:   { type: Type.STRING },
      regimeWeights: regimeWeightsObj,
      gravityCenters: { type: Type.ARRAY, items: { type: Type.STRING } },
      flows: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            from:              { type: Type.STRING },
            to:                { type: Type.STRING },
            strength:          { type: Type.NUMBER },
            flowTheoretical:   { type: Type.NUMBER },
            flowFinal:         { type: Type.NUMBER },
            zscoreAdjustment:  { type: Type.NUMBER },
            label:             { type: Type.STRING },
          },
          required: ['from', 'to', 'strength', 'flowTheoretical', 'flowFinal', 'zscoreAdjustment', 'label'],
        },
      },
      metrics: {
        type: Type.OBJECT,
        properties: {
          USD:                  metricObject,
          Europe:               metricObject,
          'Emerging Markets':   metricObject,
          Gold:                 metricObject,
          Tech:                 metricObject,
          Bonds:                metricObject,
          Crypto:               metricObject,
          Oil:                  metricObject,
        },
        required: ['USD', 'Europe', 'Emerging Markets', 'Gold', 'Tech', 'Bonds', 'Crypto', 'Oil'],
      },
    },
    required: ['id', 'name', 'description', 'macroRegime', 'regimeWeights', 'gravityCenters', 'flows', 'metrics'],
  };
}
