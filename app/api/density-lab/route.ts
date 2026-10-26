import { NextResponse } from 'next/server';
import { SECTOR_ETFS, BENCHMARK, BACKTEST_START, type PriceBar, type SizeAnchor, type TickerStaticInfo } from '@/src/lib/densityLab/engine';
import { downloadPriceHistory, fetchTickerStaticInfo } from '@/src/lib/densityLab/dataFetch';
import historicalSizeRaw from '@/src/lib/densityLab/historicalSize.json';

const historicalSize = historicalSizeRaw as Record<string, SizeAnchor[]>;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// sizeAt hace forward-fill (ancla mas reciente con date <= la pedida). Si
// el punto en vivo se fecha "hoy", nunca lo selecciona ningun bar real --
// el ultimo cierre de Yahoo siempre es de ayer o antes, asi que
// ancla.date <= bar.date nunca se cumple y el punto en vivo queda inerte
// (la ventana Live se quedaria pegada en la ultima ancla de EDGAR para
// siempre). Fix: fechar el punto en vivo el dia siguiente a la ultima
// ancla real -- asi cubre todo el hueco desde ahi hasta hoy.
function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// GET /api/density-lab -- historial OHLCV (2018-hoy) del universo del
// lab (SECTOR_ETFS: 11 sectores + GLD + QQQ) + SPY, mas la serie de
// tamano (market cap/shares outstanding) de cada uno: anclas reales de
// SEC EDGAR (historicalSize.json, ver scripts/fetchEdgarHistoricalSize.mjs
// y scripts/fetchEdgarHistoricalSizeExtra.mjs) mas el punto "hoy" en vivo
// de Yahoo Finance -- evita aplicar el tamano ACTUAL hacia atras en el
// tiempo (ver nota en computeDensityMetrics). Todo el calculo de metricas
// (VMC, STR, FFT, ICD, correlaciones, backtest) pasa client-side en
// src/DensityLab.tsx -- esta ruta solo trae los datos crudos.
//
// `?from=YYYY-MM-DD` (opcional): inicio del historial de precios. Sin el
// parametro se usa BACKTEST_START (2018) -- lo que usan las ventanas
// Backtest/Validacion/Live, sin cambios. La pestana Pruebas de Robustez
// pide desde 1997 (EXTENDED_FETCH_FROM) para usar todo el historial que
// Yahoo tiene de los ETFs.
export async function GET(request: Request) {
  const allTickers = [...SECTOR_ETFS, BENCHMARK];
  const today = new Date().toISOString().slice(0, 10);
  const fromParam = new URL(request.url).searchParams.get('from');
  const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && fromParam >= '1990-01-01' && fromParam < today ? fromParam : BACKTEST_START;

  try {
    const [priceResults, staticResults] = await Promise.all([
      Promise.all(allTickers.map((t) => downloadPriceHistory(t, from, today))),
      Promise.all(allTickers.map((t) => fetchTickerStaticInfo(t))),
    ]);

    const priceBars: Record<string, PriceBar[]> = {};
    const missingPrice: string[] = [];
    allTickers.forEach((t, i) => {
      const bars = priceResults[i];
      if (bars.length > 0) priceBars[t] = bars;
      else missingPrice.push(t);
    });

    const sizeSeries: Record<string, SizeAnchor[]> = {};
    // Fecha del ancla "en vivo" de cada ticker (valor de HOY fechado al dia
    // siguiente de la ultima ancla EDGAR) -- para que un consumidor que
    // necesita solo datos historicos reales (pestana Pruebas de Robustez)
    // la pueda descartar. No cambia nada para la pestana principal.
    const liveSizeAnchorDates: Record<string, string> = {};
    const staticInfos: Record<string, TickerStaticInfo> = {};
    const missingStatic: string[] = [];
    allTickers.forEach((t, i) => {
      const anchors: SizeAnchor[] = [...(historicalSize[t] ?? [])];
      const live = staticResults[i];
      if (live) {
        staticInfos[t] = live;
        const lastHistDate = anchors.length ? anchors[anchors.length - 1].date : null;
        const liveDate = lastHistDate ? addDaysISO(lastHistDate, 1) : today;
        liveSizeAnchorDates[t] = liveDate;
        anchors.push({
          date: liveDate,
          marketCap: live.marketCap,
          sharesOutstanding: live.sharesOutstanding,
          floatShares: live.floatSharesDirect,
        });
      }
      if (anchors.length === 0) {
        missingStatic.push(t);
        return;
      }
      sizeSeries[t] = anchors;
    });

    return NextResponse.json({
      asOf: new Date().toISOString(),
      priceBars,
      sizeSeries,
      liveSizeAnchorDates,
      staticInfos,
      missingPrice,
      missingStatic,
    });
  } catch (error) {
    console.error('[density-lab] fallo al descargar datos:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error desconocido consultando Yahoo Finance' },
      { status: 502 }
    );
  }
}
