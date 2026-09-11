/**
 * Genera src/lib/densityLab/historicalSize.json -- serie historica de
 * shares_outstanding y net assets (market cap) de los 11 ETFs sectoriales
 * (Select Sector SPDR Trust, CIK 1064641), leyendo directo de SEC EDGAR
 * (N-CSR/N-CSRS, tabla "Financial Highlights" de cada fondo).
 *
 * Por que: computeDensityMetrics aplicaba shares_outstanding/market_cap
 * ACTUALES (Yahoo Finance, hoy) a toda la serie 2018-presente -- distorsion
 * de look-ahead en las ventanas de Backtest (2018-2023) y Validacion
 * (2024-2025). Esta serie da un punto real por cada cierre de periodo
 * fiscal (~2x al ano, marzo y septiembre), forward-fill entre puntos.
 *
 * Re-ejecutar cuando SSGA publique un N-CSR/N-CSRS nuevo (~cada 6 meses):
 *   node scripts/fetchEdgarHistoricalSize.mjs
 *
 * SEC exige un User-Agent identificable en cada request (no API key).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CIK = '1064641'; // Select Sector SPDR Trust (los 11 ETFs XL*)
const UA = 'capital-gravity-research contact@example.com';
const OUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src/lib/densityLab/historicalSize.json'
);

const FUND_TO_TICKER = {
  'Communication Services Select Sector SPDR Fund': 'XLC',
  'Consumer Discretionary Select Sector SPDR Fund': 'XLY',
  'Consumer Staples Select Sector SPDR Fund': 'XLP',
  'Energy Select Sector SPDR Fund': 'XLE',
  'Financial Select Sector SPDR Fund': 'XLF',
  'Health Care Select Sector SPDR Fund': 'XLV',
  'Industrial Select Sector SPDR Fund': 'XLI',
  'Materials Select Sector SPDR Fund': 'XLB',
  'Real Estate Select Sector SPDR Fund': 'XLRE',
  'Technology Select Sector SPDR Fund': 'XLK',
  'Utilities Select Sector SPDR Fund': 'XLU',
};

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Extrae {ticker, nav, netAssets000, sharesOut} de las 11 tablas
 * "FINANCIAL HIGHLIGHTS" de un filing N-CSR/N-CSRS. Formato HTML de SEC
 * cambia de mayusculas/espaciado entre anios -- todo normalizado antes de
 * buscar. Devuelve solo entradas con ticker reconocido (descarta ruido de
 * headers "(continued)" repetidos en saltos de pagina).
 */
function extractFundSizes(html) {
  const s = html.replace(/\s+/g, ' ');
  const headRe = /FINANCIAL HIGHLIGHTS/gi;
  const idxs = [];
  let m;
  while ((m = headRe.exec(s))) idxs.push(m.index);

  function firstValueAfter(label, from, to) {
    const li = s.indexOf(label, from);
    if (li === -1 || li > to) return null;
    const windowEnd = Math.min(li + 1500, to);
    const win = s.slice(li, windowEnd);
    const mm = />\s*\$?([\d,]+\.?\d*)\s*<\/TD>/i.exec(win);
    return mm ? parseFloat(mm[1].replace(/,/g, '')) : null;
  }

  const out = [];
  for (let k = 0; k < idxs.length; k++) {
    const start = idxs[k];
    const end = k + 1 < idxs.length ? idxs[k + 1] : s.length;
    const chunk = s.slice(start, Math.min(start + 2000, end));
    const nm = /<TD[^>]*>\s*(?:The\s+)?([A-Za-z ]*Select Sector SPDR Fund)\s*<\/TD>/i.exec(chunk);
    const fundName = nm ? nm[1].trim() : null;
    const ticker = fundName ? FUND_TO_TICKER[fundName] : null;
    if (!ticker) continue;

    const nav = firstValueAfter('Net asset value, end of period', start, end);
    const netAssets000 = firstValueAfter('Net assets, end of period (in 000s)', start, end);
    if (nav && netAssets000) {
      out.push({ ticker, nav, netAssets000, sharesOut: Math.round((netAssets000 * 1000) / nav) });
    }
  }
  return out;
}

async function main() {
  console.log('Fetching filing list from EDGAR submissions API...');
  const subs = JSON.parse(await fetchText(`https://data.sec.gov/submissions/CIK${CIK.padStart(10, '0')}.json`));
  const recent = subs.filings.recent;

  const filings = [];
  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i];
    if (form === 'N-CSR' || form === 'N-CSRS') {
      filings.push({
        accessionNumber: recent.accessionNumber[i],
        reportDate: recent.reportDate[i],
        primaryDocument: recent.primaryDocument[i],
      });
    }
  }
  filings.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  console.log(`Found ${filings.length} N-CSR/N-CSRS filings (${filings[0].reportDate} to ${filings[filings.length - 1].reportDate})`);

  const series = {}; // ticker -> [{date, marketCap, sharesOutstanding}]

  for (const f of filings) {
    const accNoDash = f.accessionNumber.replace(/-/g, '');
    const url = `https://www.sec.gov/Archives/edgar/data/${CIK}/${accNoDash}/${f.primaryDocument}`;
    process.stdout.write(`  ${f.reportDate}  ${url} ... `);
    try {
      const html = await fetchText(url);
      const rows = extractFundSizes(html);
      for (const row of rows) {
        if (!series[row.ticker]) series[row.ticker] = [];
        series[row.ticker].push({
          date: f.reportDate,
          marketCap: row.netAssets000 * 1000,
          sharesOutstanding: row.sharesOut,
        });
      }
      console.log(`ok (${rows.length} funds)`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
    await sleep(400); // respeta rate limit de SEC (~10 req/s max)
  }

  for (const ticker of Object.keys(series)) {
    series[ticker].sort((a, b) => a.date.localeCompare(b.date));
  }

  // Merge, no overwrite ciego -- historicalSize.json tambien lo escribe
  // fetchEdgarHistoricalSizeExtra.mjs (GLD/QQQ, fuentes distintas). Este
  // script solo administra los 11 tickers de SECTOR_ETFS; preserva
  // cualquier otra clave ya presente en el archivo.
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
  } catch {
    // primera corrida, no hay archivo previo
  }
  const merged = { ...existing, ...series };

  writeFileSync(OUT_PATH, JSON.stringify(merged, null, 1));
  console.log(`\nWrote ${OUT_PATH}`);
  for (const ticker of Object.keys(series).sort()) {
    console.log(`  ${ticker}: ${series[ticker].length} anchors, ${series[ticker][0].date} -> ${series[ticker][series[ticker].length - 1].date}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
