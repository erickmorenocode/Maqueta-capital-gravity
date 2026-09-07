/**
 * Descarga de datos server-side (Yahoo Finance via yahoo-finance2) para el
 * laboratorio de Rotacion Sectorial. Solo se importa desde
 * app/api/density-lab/route.ts -- nunca desde un client component.
 */

import { yf } from '@/src/lib/gravityEngine';
import type { PriceBar, TickerStaticInfo } from '@/src/lib/densityLab/engine';

/**
 * Historial OHLCV diario ajustado de un ticker entre dos fechas.
 * Devuelve [] (nunca lanza) si Yahoo Finance falla -- el llamador decide
 * como degradar.
 */
export async function downloadPriceHistory(
  ticker: string,
  start: string,
  end: string
): Promise<PriceBar[]> {
  try {
    const res = await yf.chart(ticker, { period1: start, period2: end, interval: '1d' });
    return res.quotes
      .filter((q) => q.close !== null && q.close !== undefined && q.volume !== null && q.volume !== undefined)
      .map((q) => ({
        date: q.date.toISOString().slice(0, 10),
        open: q.open ?? q.close!,
        high: q.high ?? q.close!,
        low: q.low ?? q.close!,
        close: (q.adjclose ?? q.close)!,
        volume: q.volume!,
      }));
  } catch {
    return [];
  }
}

/**
 * market_cap / shares_outstanding / free_float ACTUALES de un ETF.
 *
 * Yahoo Finance no expone sharesOutstanding/marketCap de forma confiable
 * para ETFs (vienen undefined) -- solo totalAssets (AUM) esta poblado.
 * Por eso:
 *   - market_cap se aproxima con totalAssets (AUM), que es el equivalente
 *     real de "tamano" para un ETF.
 *   - shares_outstanding se deriva como totalAssets / precio_actual
 *     cuando el campo viene vacio (AUM = shares * NAV).
 *   - free_float queda para que el llamador lo derive (shares * ratio
 *     configurable), salvo que floatShares venga poblado.
 *
 * Devuelve null si no hay ni AUM ni precio -- nunca se inventa un numero.
 */
export async function fetchTickerStaticInfo(ticker: string): Promise<TickerStaticInfo | null> {
  let defaultKeyStatistics: Record<string, unknown> = {};
  let price: Record<string, unknown> = {};
  try {
    const qs = await yf.quoteSummary(ticker, { modules: ['defaultKeyStatistics', 'price'] });
    defaultKeyStatistics = (qs.defaultKeyStatistics ?? {}) as Record<string, unknown>;
    price = (qs.price ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }

  const totalAssets = defaultKeyStatistics.totalAssets as number | undefined;
  const lastPrice = price.regularMarketPrice as number | undefined;
  const floatShares = defaultKeyStatistics.floatShares as number | undefined;
  let marketCap = price.marketCap as number | undefined;
  let sharesOutstanding = defaultKeyStatistics.sharesOutstanding as number | undefined;

  let source: 'info' | 'proxy' = 'info';

  if (marketCap === undefined) {
    marketCap = totalAssets;
    source = 'proxy';
  }
  if (sharesOutstanding === undefined) {
    if (totalAssets && lastPrice) {
      sharesOutstanding = totalAssets / lastPrice;
      source = 'proxy';
    } else if (marketCap && lastPrice) {
      sharesOutstanding = marketCap / lastPrice;
      source = 'proxy';
    }
  }

  if (!marketCap || !sharesOutstanding) return null;

  return {
    ticker,
    marketCap,
    sharesOutstanding,
    floatSharesDirect: floatShares,
    source,
  };
}
