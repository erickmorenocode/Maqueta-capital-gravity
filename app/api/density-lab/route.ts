import { NextResponse } from 'next/server';
import { SECTOR_ETFS, BENCHMARK, BACKTEST_START, type PriceBar, type TickerStaticInfo } from '@/src/lib/densityLab/engine';
import { downloadPriceHistory, fetchTickerStaticInfo } from '@/src/lib/densityLab/dataFetch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/density-lab -- historial OHLCV (2018-hoy) + market cap/shares
// outstanding actuales de los 11 ETFs sectoriales + SPY, para el
// laboratorio de Rotacion Sectorial. Todo el calculo de metricas (VMC,
// STR, FFT, ICD, correlaciones, backtest) pasa client-side en
// src/DensityLab.tsx -- esta ruta solo trae los datos crudos.
export async function GET() {
  const allTickers = [...SECTOR_ETFS, BENCHMARK];
  const today = new Date().toISOString().slice(0, 10);

  try {
    const [priceResults, staticResults] = await Promise.all([
      Promise.all(allTickers.map((t) => downloadPriceHistory(t, BACKTEST_START, today))),
      Promise.all(allTickers.map((t) => fetchTickerStaticInfo(t))),
    ]);

    const priceBars: Record<string, PriceBar[]> = {};
    const missingPrice: string[] = [];
    allTickers.forEach((t, i) => {
      const bars = priceResults[i];
      if (bars.length > 0) priceBars[t] = bars;
      else missingPrice.push(t);
    });

    const staticInfos: Record<string, TickerStaticInfo> = {};
    const missingStatic: string[] = [];
    allTickers.forEach((t, i) => {
      const info = staticResults[i];
      if (info) staticInfos[t] = info;
      else missingStatic.push(t);
    });

    return NextResponse.json({
      asOf: new Date().toISOString(),
      priceBars,
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
