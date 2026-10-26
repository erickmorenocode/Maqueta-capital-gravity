/**
 * Agrega `filed` (fecha en que el dato se publico en SEC EDGAR) a cada
 * ancla de src/lib/densityLab/historicalSize.json. `date` es el cierre
 * del periodo reportado (reportDate / period end), pero el valor recien
 * es publico en la fecha de filing: 61-68 dias despues para los N-CSR de
 * los XL*, 81-95 para los N-30B-2 de QQQ, 0-4 para el 10-Q/10-K de GLD.
 * La pestana Pruebas de Robustez usa `filed` para no aplicar un tamaño
 * antes de que existiera (ver prepareCommonData).
 *
 * Idempotente: re-correr despues de fetchEdgarHistoricalSize*.mjs. Si
 * hay varios filings para el mismo periodo (enmiendas), usa el primero.
 * Un ancla sin filing encontrado queda sin `filed` y la pestana de
 * robustez la descarta.
 *
 * Uso: node scripts/addEdgarFilingDates.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '../src/lib/densityLab/historicalSize.json');
const UA = 'capital-gravity-research contact@example.com';

const SECTOR_TICKERS = ['XLC', 'XLY', 'XLP', 'XLE', 'XLF', 'XLV', 'XLI', 'XLB', 'XLRE', 'XLK', 'XLU'];

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function earliest(map, key, value) {
  if (!map.has(key) || value < map.get(key)) map.set(key, value);
}

/** reportDate -> primer filingDate, de la submissions API. */
async function filingDatesByReportDate(cik, forms) {
  const subs = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = subs.filings.recent;
  const out = new Map();
  for (let i = 0; i < r.form.length; i++) {
    if (forms.includes(r.form[i]) && r.reportDate[i]) earliest(out, r.reportDate[i], r.filingDate[i]);
  }
  return out;
}

async function main() {
  const data = JSON.parse(readFileSync(OUT_PATH, 'utf8'));

  const sources = [
    { tickers: SECTOR_TICKERS, dates: await filingDatesByReportDate('0001064641', ['N-CSR', 'N-CSRS']) },
    { tickers: ['QQQ'], dates: await filingDatesByReportDate('0001067839', ['N-30B-2', 'N-CSRS']) },
  ];
  const gld = await fetchJson('https://data.sec.gov/api/xbrl/companyconcept/CIK0001222333/dei/EntityCommonStockSharesOutstanding.json');
  const gldDates = new Map();
  for (const p of gld.units.shares) earliest(gldDates, p.end, p.filed);
  sources.push({ tickers: ['GLD'], dates: gldDates });

  for (const { tickers, dates } of sources) {
    for (const t of tickers) {
      const anchors = data[t] ?? [];
      let missing = 0;
      for (const a of anchors) {
        const filed = dates.get(a.date);
        if (filed) a.filed = filed;
        else {
          delete a.filed;
          missing++;
        }
      }
      console.log(`${t}: ${anchors.length - missing}/${anchors.length} anclas con fecha de filing`);
    }
  }

  writeFileSync(OUT_PATH, JSON.stringify(data, null, 1));
  console.log(`Escrito ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
