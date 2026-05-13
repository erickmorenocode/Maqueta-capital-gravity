import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API route to fetch market prices from Yahoo Finance
  app.get("/api/prices", async (req, res) => {
    try {
      const symbols = {
        dxy: 'DX-Y.NYB',
        gold: 'GC=F',
        btc: 'BTC-USD',
        nasdaq: '^IXIC',
        dowjones: '^DJI',
        sp500: '^GSPC',
        wti: 'CL=F',
        brent: 'BZ=F'
      };

      const results = await Promise.all(
        Object.entries(symbols).map(async ([key, symbol]) => {
          try {
            const quote: any = await yahooFinance.quote(symbol);
            const changePercent = quote.regularMarketChangePercent || 0;
            const trend = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'neutral';
            
            // Format values based on asset type
            let formattedValue = quote.regularMarketPrice?.toString() || '0';
            if (key === 'gold') formattedValue = `$${Number(quote.regularMarketPrice).toLocaleString()}`;
            if (key === 'btc') formattedValue = `$${Number(quote.regularMarketPrice).toLocaleString()}`;
            if (key === 'wti' || key === 'brent') formattedValue = `$${Number(quote.regularMarketPrice).toFixed(2)}`;
            if (key === 'dxy') formattedValue = Number(quote.regularMarketPrice).toFixed(2);
            if (key === 'nasdaq' || key === 'dowjones' || key === 'sp500') formattedValue = Number(quote.regularMarketPrice).toLocaleString();

            return [key, {
              value: formattedValue,
              change: `${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
              trend
            }];
          } catch (e) {
            console.error(`Error fetching ${symbol}:`, e);
            return [key, { value: 'N/A', change: '0%', trend: 'neutral' }];
          }
        })
      );

      const prices = Object.fromEntries(results);
      res.json(prices);
    } catch (error) {
      console.error("Failed to fetch prices from Yahoo Finance:", error);
      res.status(500).json({ error: "Failed to fetch prices" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
