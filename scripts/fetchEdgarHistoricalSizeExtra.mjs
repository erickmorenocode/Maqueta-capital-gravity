/**
 * Escribe las anclas de GLD y QQQ en historicalSize.json (produccion,
 * mismo archivo que fetchEdgarHistoricalSize.mjs) -- integrado, GLD/QQQ
 * ya forman parte de SECTOR_ETFS en engine.ts. Merge seguro: solo toca
 * las claves GLD/QQQ, preserva las de los 11 sectores que administra el
 * otro script (y viceversa) para que ninguno de los dos se pise al
 * re-correr.
 *
 * Misma logica que
 * fetchEdgarHistoricalSize.mjs (los 11 sectores) pero cada uno via su
 * propia fuente, porque son estructuras de fondo distintas:
 *
 * GLD (SPDR Gold Trust, CIK 1222333): NO es investment company bajo la
 * Investment Company Act -- es un grantor trust que file 10-K/10-Q bajo
 * el Exchange Act. Tiene XBRL estructurado real:
 * dei:EntityCommonStockSharesOutstanding via la company concept API de
 * SEC -- 70 puntos TRIMESTRALES 2009-2026, sin parsear HTML. market_cap
 * se deriva como shares * precio_de_cierre_mas_cercano (no hay "net
 * assets" trimestral limpio para un grantor trust de oro, pero
 * shares*precio es un proxy real y preciso ya que el precio de GLD seguí
 * de cerca su NAV).
 *
 * QQQ (Invesco QQQ Trust Series 1, CIK 1067839): SI es investment
 * company pero NO usa N-CSR/N-CSRS regularmente (como SPY) -- usa
 * N-30B-2 anual (reportDate 9/30, un fondo unico por filing, mas simple
 * de parsear que el trust de 11 fondos). Formato HTML cambio de plantilla
 * entre 2018 y 2025 (orden shares/net-assets se invierte) -- el parser
 * busca "Shares outstanding (unlimited...)" y toma el primer numero
 * DESPUES como shares, el ultimo "$numero" ANTES como net assets, robusto
 * a los dos ordenes observados.
 *
 * Correr con:
 *   node --experimental-strip-types scripts/fetchEdgarHistoricalSizeExtra.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import YahooFinance from 'yahoo-finance2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '../src/lib/densityLab/historicalSize.json');
const UA = 'capital-gravity-research contact@example.com';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}
async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── GLD via XBRL company concept API (estructurado, sin HTML) ─────────
async function fetchGldAnchors() {
  console.log('GLD: bajando dei:EntityCommonStockSharesOutstanding via XBRL...');
  const data = await fetchJson('https://data.sec.gov/api/xbrl/companyconcept/CIK0001222333/dei/EntityCommonStockSharesOutstanding.json');
  const points = data.units.shares
    .filter((p) => p.end >= '2017-01-01') // cola extra para forward-fill antes de BACKTEST_START
    .map((p) => ({ date: p.end, sharesOutstanding: p.val }))
    .sort((a, b) => a.date.localeCompare(b.date));

  console.log(`GLD: ${points.length} puntos trimestrales. Bajando precio GLD para derivar market cap...`);
  const priceRes = await yf.chart('GLD', { period1: '2017-01-01', period2: new Date().toISOString().slice(0, 10), interval: '1d' });
  const closeByDate = new Map(priceRes.quotes.filter((q) => q.close != null).map((q) => [q.date.toISOString().slice(0, 10), q.adjclose ?? q.close]));
  const sortedDates = [...closeByDate.keys()].sort();

  function nearestClose(targetDate) {
    let result;
    for (const d of sortedDates) {
      if (d > targetDate) break;
      result = closeByDate.get(d);
    }
    return result ?? closeByDate.get(sortedDates[0]);
  }

  const anchors = points
    .map((p) => {
      const close = nearestClose(p.date);
      if (!close) return null;
      return { date: p.date, marketCap: p.sharesOutstanding * close, sharesOutstanding: p.sharesOutstanding };
    })
    .filter(Boolean);

  // Dedup por fecha (por si dos puntos caen el mismo dia).
  const byDate = new Map(anchors.map((a) => [a.date, a]));
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ─── QQQ via N-30B-2 (HTML, un solo fondo por filing) ───────────────────
//
// Formato cambio 3 veces entre 2017 y 2026 (igual que le paso al Select
// Sector SPDR Trust): tags <TD>/<FONT> simples en 2017-2023, <div>/<font>
// con mas anidamiento en 2024+ (el "$" y el numero quedan en <font> tags
// separados, hay que permitir 1-3 tags intermedios). "Net Assets" se
// busca como el ULTIMO match antes del label de shares outstanding (el
// de la Statement of Assets and Liabilities, mas cercano) -- los otros
// matches en el documento (header de holdings "Net Assets-100.0%",
// Statements of Changes) quedan mas lejos, se descartan por posicion.
function extractQqqSize(html) {
  const s = html.replace(/\s+/g, ' ');
  const labelRe = /Shares outstanding \((?:unlimited )?(?:shares authorized|amount authorized)/i;
  const m = labelRe.exec(s);
  if (!m) return null;
  const idx = m.index;

  const after = s.slice(idx, idx + 600);
  const sharesMatch = />\s*([\d,]{6,})\s*</.exec(after) || /\)\s*\|?\s*([\d,]{6,})/.exec(after);
  if (!sharesMatch) return null;
  const sharesOutstanding = parseFloat(sharesMatch[1].replace(/,/g, ''));

  const naRe = /Net Assets(?!\s+Consist)/g;
  let mm;
  const positions = [];
  while ((mm = naRe.exec(s)) && mm.index < idx) positions.push(mm.index);
  if (positions.length === 0) return null;
  const naIdx = positions[positions.length - 1];
  const naWindow = s.slice(naIdx, idx);
  const naMatch = />\s*\$?\s*(?:<[^>]{0,150}>\s*){0,3}([\d,]{6,})\s*</.exec(naWindow);
  if (!naMatch) return null;
  const netAssets = parseFloat(naMatch[1].replace(/,/g, ''));

  if (!sharesOutstanding || !netAssets) return null;
  return { marketCap: netAssets, sharesOutstanding };
}

async function fetchQqqAnchors() {
  console.log('QQQ: listando filings N-30B-2/N-CSRS...');
  const subs = await fetchJson('https://data.sec.gov/submissions/CIK0001067839.json');
  const recent = subs.filings.recent;
  const filings = [];
  for (let i = 0; i < recent.form.length; i++) {
    if ((recent.form[i] === 'N-30B-2' || recent.form[i] === 'N-CSRS') && recent.reportDate[i] >= '2017-01-01') {
      filings.push({ accessionNumber: recent.accessionNumber[i], reportDate: recent.reportDate[i], primaryDocument: recent.primaryDocument[i] });
    }
  }
  filings.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  console.log(`QQQ: ${filings.length} filings desde 2017 (${filings[0]?.reportDate} -> ${filings[filings.length - 1]?.reportDate})`);

  const anchors = [];
  for (const f of filings) {
    const accNoDash = f.accessionNumber.replace(/-/g, '');
    const url = `https://www.sec.gov/Archives/edgar/data/1067839/${accNoDash}/${f.primaryDocument}`;
    process.stdout.write(`  ${f.reportDate} ... `);
    try {
      const html = await fetchText(url);
      const size = extractQqqSize(html);
      if (size) {
        anchors.push({ date: f.reportDate, marketCap: size.marketCap, sharesOutstanding: size.sharesOutstanding });
        console.log(`ok (shares=${size.sharesOutstanding.toLocaleString()}, netAssets=$${size.marketCap.toLocaleString()})`);
      } else {
        console.log('FAILED: no matcheo el patron');
      }
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
    await sleep(400);
  }
  return anchors;
}

async function main() {
  const gldAnchors = await fetchGldAnchors();
  const qqqAnchors = await fetchQqqAnchors();

  let existing = {};
  try {
    existing = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
  } catch {
    // primera corrida, no hay archivo previo
  }
  const out = { ...existing, GLD: gldAnchors, QQQ: qqqAnchors };
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 1));
  console.log(`\nEscrito ${OUT_PATH}`);
  console.log(`GLD: ${gldAnchors.length} anclas, ${gldAnchors[0]?.date} -> ${gldAnchors[gldAnchors.length - 1]?.date}`);
  console.log(`QQQ: ${qqqAnchors.length} anclas, ${qqqAnchors[0]?.date} -> ${qqqAnchors[qqqAnchors.length - 1]?.date}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
