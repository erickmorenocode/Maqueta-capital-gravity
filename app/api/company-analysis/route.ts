import { NextRequest, NextResponse } from 'next/server';
import { COUNTRY_SECTOR_COMPANIES } from '@/src/data';
import type { CompanyGravityResult } from '@/src/data';
import { supabaseAdmin } from '@/src/lib/supabase';
import {
  yf, SECTOR_ETFS, YFQuote, fetchOptionsMetrics, computeCompanyG,
  fetchMacroContext, assignTiers, getGeoEventsSnapshot,
} from '@/src/lib/gravityEngine';

export const dynamic = 'force-dynamic';

interface PrevSnapshot { fuerzaG: number; tier: 'high' | 'medium' | 'low'; createdAt: string }

// ─── Most recent snapshot per ticker strictly before today (UTC) ─────────────
async function fetchPrevSnapshots(country: string, sector: string): Promise<Record<string, PrevSnapshot>> {
  const map: Record<string, PrevSnapshot> = {};
  if (!supabaseAdmin) return map;

  const todayUtcStart = new Date();
  todayUtcStart.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabaseAdmin
    .from('g_history')
    .select('ticker, fuerza_g, tier, created_at')
    .eq('country', country)
    .eq('sector', sector)
    .lt('created_at', todayUtcStart.toISOString())
    .order('created_at', { ascending: false })
    .limit(200);

  if (error || !data) return map;
  for (const row of data) {
    if (!map[row.ticker]) {
      map[row.ticker] = { fuerzaG: row.fuerza_g, tier: row.tier, createdAt: row.created_at };
    }
  }
  return map;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const country = searchParams.get('country') ?? 'EE.UU.';
  const sector  = searchParams.get('sector')  ?? 'technology';

  const companies = COUNTRY_SECTOR_COMPANIES[country]?.[sector];
  if (!companies?.length) {
    return NextResponse.json({ error: 'No companies found', results: [] }, { status: 404 });
  }

  const sectorEtf = SECTOR_ETFS[sector] ?? 'XLK';

  const [macro, sectorEtfQuote, companyQuotes, companyOptions, prevSnapshots] = await Promise.all([
    fetchMacroContext(),
    (yf.quote(sectorEtf) as Promise<YFQuote>).catch(() => null),
    Promise.all(companies.map(co => (yf.quote(co.ticker) as Promise<YFQuote>).catch(() => null))),
    Promise.all(companies.map(co => fetchOptionsMetrics(co.ticker))),
    fetchPrevSnapshots(country, sector),
  ]);

  const { vix, us10y, us2y, move, hygStress, regime, regimeMult, weights } = macro;
  const sectorChangePct = sectorEtfQuote?.regularMarketChangePercent ?? 0;

  // Compute G for each company
  const results: CompanyGravityResult[] = companies.map((co, i) => {
    const quote = companyQuotes[i];
    if (!quote || !quote.regularMarketPrice) {
      return {
        ticker: co.ticker, name: co.name, price: 0, open: 0, changePct: 0,
        masa: 0, distancia: 0, friccion: 0, fuerzaG: -99,
        institutionalPressure: 0, optionsPressure: 0, gammaFlip: null, putCallRatio: 1,
        isGravityCenter: false, tier: 'low' as const,
        masaComponents: { retorno: 0, crecimiento: 0, liquidez: 0, confianza: 0 },
        marketCap: 0, error: true,
      };
    }
    const computed = computeCompanyG(
      quote, companyOptions[i], vix, us10y, us2y, move, hygStress,
      regime, regimeMult, weights, sectorChangePct, country,
    );
    return { ticker: co.ticker, name: co.name, isGravityCenter: false, tier: 'medium' as const, ...computed } as CompanyGravityResult;
  });

  assignTiers(results);

  // Sort by fuerzaG descending
  results.sort((a, b) => b.fuerzaG - a.fuerzaG);

  // Attach flow-change signal: delta vs last known snapshot before today
  const resultsWithDelta = results.map(r => {
    const prev = prevSnapshots[r.ticker];
    if (!prev || r.error) return { ...r, previousFuerzaG: null, deltaG: null, tierChanged: false, previousSnapshotAt: null };
    return {
      ...r,
      previousFuerzaG: prev.fuerzaG,
      deltaG: parseFloat((r.fuerzaG - prev.fuerzaG).toFixed(2)),
      tierChanged: prev.tier !== r.tier,
      previousSnapshotAt: prev.createdAt,
    };
  });

  // Fire-and-forget: persist snapshot for historical trend queries. Never blocks the response.
  if (supabaseAdmin) {
    const geoEvents = getGeoEventsSnapshot();
    const rows = results.filter(r => !r.error).map(r => ({
      country, sector,
      ticker: r.ticker, name: r.name, open: r.open, price: r.price,
      masa: r.masa, distancia: r.distancia, friccion: r.friccion, fuerza_g: r.fuerzaG,
      tier: r.tier, geo_events: geoEvents,
    }));
    if (rows.length > 0) {
      supabaseAdmin.from('g_history').insert(rows).then(({ error }) => {
        if (error) console.error('[supabase] g_history insert failed:', error.message);
      });
    }
  }

  return NextResponse.json({
    country, sector, regime, vix, results: resultsWithDelta,
    meta: { sectorChangePct, hygStress, us10y, us2y },
  });
}
