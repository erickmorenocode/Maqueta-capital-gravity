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
        model: 'gemini-3-flash-preview',
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
    Analiza la realidad financiera global ACTUAL a fecha de ${currentDate} utilizando el modelo de "GRAVEDAD FINANCIERA".

    IMPORTANTE: Debes utilizar la herramienta de búsqueda (googleSearch) para obtener NOTICIAS DE ÚLTIMO MINUTO y datos macroeconómicos actualizados al día de hoy. Tu análisis debe reflejar la realidad de mercado más reciente y realista posible.

    LÓGICA DEL MODELO (ESTRICTO):
    Debes aplicar la Ley de Gravedad Financiera:
    1. Versión Teórica (INTENSIDAD DE FLUJO): El 'strength' de cada flujo debe estimarse mediante:
       Intensidad ∝ (Masa_origen · Masa_destino) / (Distancia_destino)²
       *Nota: Normaliza el resultado para que 'strength' esté entre 0 y 1.*
    2. Versión Práctica (FUERZA G INDIVIDUAL): Fuerza G = (Masa - Distancia) / Fricción

    DEFINICIONES DETALLADAS PARA TU ANÁLISIS:
    - MASA (ATRACTIVO): Es la fuerza de succión de capital. Depende de:
        * Rentabilidad esperada (Yield, dividendos, crecimiento de capital).
        * Seguridad relativa (Tasas de interés de bonos soberanos).
        * Estabilidad institucional (Earnings yield, estado de derecho).
        * Confianza macroeconómica y crecimiento del PIB esperado.
    - DISTANCIA (RIESGO/ESPACIO): Es la resistencia al flujo. Equivale a:
        * Volatilidad del activo (VIX, desviaciones estándar).
        * Riesgo País y Riesgo Político (Inestabilidad gubernamental).
        * Incertidumbre Macro (Guerra, inflación descontrolada, giros en política monetaria).
        * Riesgo Geopolítico y costos de transacción implícitos por riesgo.
    - FRICCIÓN (LIQUIDEZ): Es la viscosidad del mercado. Se enfoca en:
        * Liquidez (Facilidad de entrada/salida, profundidad del libro de órdenes).
        * Controles de capital (Restricciones de salida de divisas).
        * Costos operativos y regulatorios (Impuestos, burocracia financiera).

    TU OBJETIVO: Identificar los 'gravityCenters' y 'flows' de capital basados en esta física financiera.

    REQUERIMIENTOS DE ANÁLISIS:
    1. JERARQUÍA DE RIESGO: Los flujos deben seguir una lógica de "Risk-On" o "Risk-Off".
    2. CONSISTENCIA TEMPORAL: El capital tiene inercia. Si no han ocurrido eventos disruptivos en las últimas 24-48 horas, los cambios en las métricas y flujos deben ser incrementales y no drásticos.
    3. SELECCIÓN DE CENTROS DE GRAVEDAD: Los 'gravityCenters' DEBEN ser ÚNICAMENTE aquellos activos o regiones cuya Fuerza G calculada sea SUPERIOR a 8.0 (Fuerza G > 8.0). Si ningún activo supera este umbral, selecciona el que tenga el valor más alto cercano a 8.0.
    4. JUSTIFICACIÓN: La descripción debe explicar el escenario actual usando los términos del modelo (Masa, Distancia, Fricción).

    ESTRUCTURA DE SALIDA (JSON):
    Devuelve un objeto MarketScenario con:
    - id: 'live'
    - name: 'Realidad del Mercado en Vivo'
    - description: Un resumen profundo (máx 3 frases) que JUSTIFIQUE los centros usando el modelo de Gravedad Financiera.
    - gravityCenters: Array de IDs (USD, Europe, Emerging Markets, Gold, Tech, Bonds, Crypto, Oil).
    - flows: Array de objetos CapitalFlow { from, to, strength (0-1), label }.
    - metrics: Un objeto donde cada clave es un ID de activo/país y el valor es:
      { masa, masaJustificacion, distancia, distanciaJustificacion, friccion, friccionJustificacion }

    REGLA CRÍTICA DE CONECTIVIDAD:
    - TODOS los IDs (USD, Europe, Emerging Markets, Gold, Tech, Bonds, Crypto, Oil) DEBEN aparecer al menos una vez en el array de 'flows'.

    Usa estos IDs para consistencia: USD, Europe, Emerging Markets, Gold, Tech, Bonds, Crypto, Oil.
    IMPORTANTE: Todo el contenido de texto debe estar en ESPAÑOL.
  `;
}

function buildSchema() {
  const metricObject = {
    type: Type.OBJECT,
    properties: {
      masa: { type: Type.NUMBER },
      masaJustificacion: { type: Type.STRING },
      distancia: { type: Type.NUMBER },
      distanciaJustificacion: { type: Type.STRING },
      friccion: { type: Type.NUMBER },
      friccionJustificacion: { type: Type.STRING },
    },
    required: ['masa', 'masaJustificacion', 'distancia', 'distanciaJustificacion', 'friccion', 'friccionJustificacion'],
  };

  return {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      name: { type: Type.STRING },
      description: { type: Type.STRING },
      gravityCenters: { type: Type.ARRAY, items: { type: Type.STRING } },
      flows: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            from: { type: Type.STRING },
            to: { type: Type.STRING },
            strength: { type: Type.NUMBER },
            label: { type: Type.STRING },
          },
          required: ['from', 'to', 'strength', 'label'],
        },
      },
      metrics: {
        type: Type.OBJECT,
        properties: {
          USD: metricObject,
          Europe: metricObject,
          'Emerging Markets': metricObject,
          Gold: metricObject,
          Tech: metricObject,
          Bonds: metricObject,
          Crypto: metricObject,
          Oil: metricObject,
        },
        required: ['USD', 'Europe', 'Emerging Markets', 'Gold', 'Tech', 'Bonds', 'Crypto', 'Oil'],
      },
    },
    required: ['id', 'name', 'description', 'gravityCenters', 'flows', 'metrics'],
  };
}
