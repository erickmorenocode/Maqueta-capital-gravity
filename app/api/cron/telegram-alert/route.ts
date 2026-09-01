import { NextRequest, NextResponse } from 'next/server';
import { computeLiveSnapshot } from '@/src/lib/liveSnapshot';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ASSET_ORDER = [
  'Norte America', 'Europe', 'Emerging Markets', 'Asia', 'Corea del Sur',
  'USD', 'Bonds', 'Gold', 'Oil', 'Crypto',
];

// Broader watch-list for surfacing in the alert even when no NEWS_FLOW_RULES tilt fired --
// some of these (bare "fed"/"treasury"/"bond"/"yields") are too ambiguous on their own to
// assign a bullish/bearish direction, but the user wants to see them the moment they show
// up, with a source link, not have them silently dropped for lack of a clean tilt.
// English + Spanish (matches the real es-419 Google News fetch added 2026-08-31).
const WATCH_KEYWORDS = [
  'russia', 'rusia', 'ukraine', 'ucrania', 'strait of hormuz', 'estrecho de ormuz',
  'war', 'guerra', 'nato', 'otan', 'fed', 'federal reserve', 'reserva federal',
  'treasury', 'tesoro', 'bond', 'bonos', 'yields', 'rendimientos',
];

function hasWordLoose(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function link(text: string, url?: string): string {
  const safe = escapeHtml(text);
  return url ? `<a href="${escapeHtml(url)}">${safe}</a>` : safe;
}

// GET /api/cron/telegram-alert -- hourly Vercel Cron. Sends a short bullish/bearish
// snapshot of the tracked assets/indices to Telegram, with sourced/linked news behind
// the biggest movers. Uses computeLiveSnapshot() directly (no Gemini call) -- Gemini's
// free tier caps at 20 requests/day, and 24 hourly cron runs would burn the whole daily
// quota on the alert alone.
export async function GET(req: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    return NextResponse.json({ error: 'Telegram not configured (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID)' }, { status: 500 });
  }

  const snap = await computeLiveSnapshot();

  const lines: string[] = [];
  const now = new Date().toISOString().slice(11, 16);
  lines.push(`📊 <b>Capital Gravity</b> — ${now} UTC`);
  lines.push(`Régimen: <b>${snap.regime.toUpperCase()}</b> · VIX ${snap.vix.toFixed(1)}`);
  lines.push('');

  for (const id of ASSET_ORDER) {
    const m = snap.metrics[id];
    if (!m || m.fuerzaG === undefined) continue;
    const g = m.fuerzaG;
    const emoji = snap.gravityCenters.includes(id) ? '🟢' : g < 0 ? '🔴' : '⚪';
    const label = snap.gravityCenters.includes(id) ? 'alcista' : g < 0 ? 'bajista' : 'neutro';
    const name = id.padEnd(18, ' ');
    lines.push(`${emoji} ${escapeHtml(name)} G=${g >= 0 ? '+' : ''}${g.toFixed(1)} (${label})`);
  }

  // Dedupe firings by headline (several targets can share the same source headline),
  // keep the strongest tilt per headline, sort by |tilt|.
  const shownHeadlines = new Set<string>();
  const byHeadline = new Map<string, { ruleLabel: string; id: string; tilt: number; headline: string; url?: string }>();
  for (const f of snap.newsFlowFirings) {
    if (!ASSET_ORDER.includes(f.id) && f.kind === 'asset') continue;
    const existing = byHeadline.get(f.headline);
    if (!existing || Math.abs(f.tilt) > Math.abs(existing.tilt)) {
      byHeadline.set(f.headline, { ruleLabel: f.ruleLabel, id: f.id, tilt: f.tilt, headline: f.headline, url: f.url });
    }
  }
  const topSignals = [...byHeadline.values()].sort((a, b) => Math.abs(b.tilt) - Math.abs(a.tilt)).slice(0, 4);

  if (topSignals.length > 0) {
    lines.push('');
    lines.push('📰 <b>Por qué (con fuente):</b>');
    for (const sig of topSignals) {
      shownHeadlines.add(sig.headline);
      const sign = sig.tilt >= 0 ? '+' : '';
      lines.push(`• <b>${escapeHtml(sig.id)}</b> ${sign}${sig.tilt}: ${escapeHtml(sig.ruleLabel)}`);
      lines.push(`  ${link(sig.headline, sig.url)}`);
    }
  }

  // Watch-keyword hits not already covered above -- surfaced even without a clean tilt.
  const watchHits: Array<{ keyword: string; title: string; url?: string; source: string }> = [];
  const seenTitles = new Set<string>(shownHeadlines);
  for (const h of snap.newsHeadlines) {
    if (seenTitles.has(h.title)) continue;
    const hit = WATCH_KEYWORDS.find(k => hasWordLoose(h.title, k));
    if (hit) {
      watchHits.push({ keyword: hit, title: h.title, url: h.url, source: h.source });
      seenTitles.add(h.title);
    }
    if (watchHits.length >= 4) break;
  }
  if (watchHits.length > 0) {
    lines.push('');
    lines.push('🚨 <b>Menciones clave:</b>');
    for (const w of watchHits) {
      lines.push(`• [${escapeHtml(w.keyword)}] ${link(w.title, w.url)} — ${escapeHtml(w.source)}`);
    }
  }

  const text = lines.join('\n');

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_notification: false, link_preview_options: { is_disabled: true } }),
  });
  const result = await res.json().catch(() => null);

  if (!res.ok) {
    console.error('[telegram-alert] sendMessage failed:', result);
    return NextResponse.json({ ok: false, telegramError: result }, { status: 502 });
  }

  return NextResponse.json({ ok: true, sentTo: chatId, textLength: text.length, signals: topSignals.length, watchHits: watchHits.length });
}
