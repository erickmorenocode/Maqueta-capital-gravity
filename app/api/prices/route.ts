import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

export const dynamic = 'force-dynamic';

interface YFQuote {
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
}

const yahooFinance = new YahooFinance();

const symbols: Record<string, string> = {
  dxy: 'DX-Y.NYB',
  gold: 'GC=F',
  btc: 'BTC-USD',
  nasdaq: '^IXIC',
  dowjones: '^DJI',
  sp500: '^GSPC',
  wti: 'CL=F',
  brent: 'BZ=F',
};

export async function GET() {
  const results = await Promise.all(
    Object.entries(symbols).map(async ([key, symbol]) => {
      try {
        const quote = await yahooFinance.quote(symbol) as YFQuote;
        const price = quote.regularMarketPrice;
        if (price == null) {
          return [key, { value: 'N/A', change: '0.00%', trend: 'neutral' }];
        }
        const changePercent = quote.regularMarketChangePercent ?? 0;
        const trend = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'neutral';

        let formattedValue = price.toString();
        if (key === 'gold' || key === 'btc') formattedValue = `$${price.toLocaleString()}`;
        if (key === 'wti' || key === 'brent') formattedValue = `$${price.toFixed(2)}`;
        if (key === 'dxy') formattedValue = price.toFixed(2);
        if (key === 'nasdaq' || key === 'dowjones' || key === 'sp500') formattedValue = price.toLocaleString();

        return [key, {
          value: formattedValue,
          change: `${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
          trend,
        }];
      } catch (e) {
        console.error(`Error fetching ${symbol}:`, e);
        return [key, { value: 'N/A', change: '0.00%', trend: 'neutral' }];
      }
    })
  );

  return NextResponse.json(Object.fromEntries(results));
}
