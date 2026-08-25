import { NextRequest, NextResponse } from 'next/server';
import { COUNTRY_SECTOR_COMPANIES, ASSET_CLASSES } from '@/src/data';
import type { CompanyGravityResult } from '@/src/data';
import { supabaseAdmin } from '@/src/lib/supabase';
import {
  yf, SECTOR_ETFS, YFQuote, fetchOptionsMetrics, computeCompanyG, computeAssetG,
  fetchMacroContext, assignTiers,
} from '@/src/lib/gravityEngine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CONCURRENCY = 15;
const INSERT_CHUNK = 400;

interface Job { country: string; sector: string; ticker: string; name: string }
type GroupedResult = CompanyGravityResult & { country: string; sector: string };

interface AssetJob { assetClass: string; region: string; ticker: string; name: string }
type GroupedAssetResult = CompanyGravityResult & { region: string; assetClass: string };

async function pMap<T, R>(items: T[], mapper: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await mapper(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function GET(req: NextRequest) {
  const started = Date.now();

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when CRON_SECRET is set.
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // Build the full job list: every ticker across every country x sector.
  const jobs: Job[] = [];
  for (const [country, sectors] of Object.entries(COUNTRY_SECTOR_COMPANIES)) {
    for (const [sector, companies] of Object.entries(sectors)) {
      for (const co of companies) {
        jobs.push({ country, sector, ticker: co.ticker, name: co.name });
      }
    }
  }

  // Global macro (VIX, rates, HYG, MOVE) and all sector ETFs fetched once and reused for every job.
  const [macro, sectorEtfQuotes] = await Promise.all([
    fetchMacroContext(),
    Promise.all(
      Object.entries(SECTOR_ETFS).map(async ([sector, etf]) => {
        const q = await (yf.quote(etf) as Promise<YFQuote>).catch(() => null);
        return [sector, q?.regularMarketChangePercent ?? 0] as const;
      }),
    ),
  ]);
  const sectorChangeMap = Object.fromEntries(sectorEtfQuotes);
  const { vix, us10y, us2y, move, hygStress, regime, regimeMult, weights } = macro;

  let failed = 0;
  const flat: GroupedResult[] = await pMap(jobs, async (job) => {
    const [quote, opts] = await Promise.all([
      (yf.quote(job.ticker) as Promise<YFQuote>).catch(() => null),
      fetchOptionsMetrics(job.ticker),
    ]);
    if (!quote || !quote.regularMarketPrice) {
      failed++;
      return {
        ticker: job.ticker, name: job.name, price: 0, changePct: 0,
        masa: 0, distancia: 0, friccion: 0, fuerzaG: -99,
        institutionalPressure: 0, optionsPressure: 0, gammaFlip: null, putCallRatio: 1,
        isGravityCenter: false, tier: 'low' as const,
        masaComponents: { retorno: 0, crecimiento: 0, liquidez: 0, confianza: 0 },
        marketCap: 0, error: true,
        country: job.country, sector: job.sector,
      };
    }
    const computed = computeCompanyG(
      quote, opts, vix, us10y, us2y, move, hygStress,
      regime, regimeMult, weights, sectorChangeMap[job.sector] ?? 0, job.country,
    );
    return {
      ticker: job.ticker, name: job.name, isGravityCenter: false, tier: 'medium' as const,
      ...computed, country: job.country, sector: job.sector,
    };
  }, CONCURRENCY);

  // Tiers (mean ± 0.5σ) are relative within each country+sector group, same as the on-demand endpoint.
  const groups: Record<string, GroupedResult[]> = {};
  for (const r of flat) {
    const key = `${r.country}|${r.sector}`;
    (groups[key] ??= []).push(r);
  }
  for (const group of Object.values(groups)) assignTiers(group);

  const rows = flat.filter(r => !r.error).map(r => ({
    country: r.country, sector: r.sector,
    ticker: r.ticker, name: r.name, price: r.price,
    masa: r.masa, distancia: r.distancia, friccion: r.friccion, fuerza_g: r.fuerzaG,
    tier: r.tier,
  }));

  // ── Phase 2: cross-asset macro instruments (USD, bonds, crypto, gold, oil, regional indices) ──
  const assetJobs: AssetJob[] = [];
  for (const [assetClass, group] of Object.entries(ASSET_CLASSES)) {
    for (const inst of group.instruments) {
      assetJobs.push({ assetClass, region: group.region, ticker: inst.ticker, name: inst.name });
    }
  }

  let assetFailed = 0;
  const flatAssets: GroupedAssetResult[] = await pMap(assetJobs, async (job) => {
    const [quote, opts] = await Promise.all([
      (yf.quote(job.ticker) as Promise<YFQuote>).catch(() => null),
      fetchOptionsMetrics(job.ticker),
    ]);
    if (!quote || !quote.regularMarketPrice) {
      assetFailed++;
      return {
        ticker: job.ticker, name: job.name, price: 0, changePct: 0,
        masa: 0, distancia: 0, friccion: 0, fuerzaG: -99,
        institutionalPressure: 0, optionsPressure: 0, gammaFlip: null, putCallRatio: 1,
        isGravityCenter: false, tier: 'low' as const,
        masaComponents: { retorno: 0, crecimiento: 0, liquidez: 0, confianza: 0 },
        marketCap: 0, error: true,
        region: job.region, assetClass: job.assetClass,
      };
    }
    const computed = computeAssetG(quote, opts, vix, us10y, us2y, move, hygStress, regime, regimeMult, weights);
    return {
      ticker: job.ticker, name: job.name, isGravityCenter: false, tier: 'medium' as const,
      ...computed, region: job.region, assetClass: job.assetClass,
    };
  }, CONCURRENCY);

  // Tiers relative within each asset class (n=1 groups trivially resolve to 'high').
  const assetGroups: Record<string, GroupedAssetResult[]> = {};
  for (const r of flatAssets) (assetGroups[r.assetClass] ??= []).push(r);
  for (const group of Object.values(assetGroups)) assignTiers(group);

  const assetRows = flatAssets.filter(r => !r.error).map(r => ({
    country: r.region, sector: r.assetClass, asset_class: r.assetClass,
    ticker: r.ticker, name: r.name, price: r.price,
    masa: r.masa, distancia: r.distancia, friccion: r.friccion, fuerza_g: r.fuerzaG,
    tier: r.tier,
  }));

  const insertErrors: string[] = [];
  async function insertBatch(batch: typeof rows | typeof assetRows): Promise<number> {
    let ok = 0;
    for (let i = 0; i < batch.length; i += INSERT_CHUNK) {
      const chunk = batch.slice(i, i + INSERT_CHUNK);
      const { error } = await supabaseAdmin!.from('g_history').insert(chunk);
      if (error) insertErrors.push(error.message);
      else ok += chunk.length;
    }
    return ok;
  }
  const inserted = await insertBatch(rows);
  const assetInserted = await insertBatch(assetRows);

  return NextResponse.json({
    ok: insertErrors.length === 0,
    totalJobs: jobs.length,
    inserted,
    failedQuotes: failed,
    assetClassJobs: assetJobs.length,
    assetClassInserted: assetInserted,
    assetClassFailed: assetFailed,
    insertErrors,
    durationMs: Date.now() - started,
  });
}
