import { NextRequest, NextResponse } from 'next/server';
import { computeLiveSnapshot } from '@/src/lib/liveSnapshot';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ASSET_ORDER = [
  'Norte America', 'Europe', 'Emerging Markets', 'Asia', 'Corea del Sur',
  'USD', 'Bonds', 'Gold', 'Oil', 'Crypto',
];

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// GET /api/cron/telegram-alert -- hourly Vercel Cron. Sends a short bullish/bearish
// snapshot of the tracked assets/indices to Telegram. Uses computeLiveSnapshot()
// directly (no Gemini call) -- Gemini's free tier caps at 20 requests/day, and 24
// hourly cron runs would burn the whole daily quota on the alert alone.
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

  const topSignals = Object.entries(snap.newsFlowSignal)
    .filter(([id]) => ASSET_ORDER.includes(id))
    .sort((a, b) => Math.abs(b[1].tilt) - Math.abs(a[1].tilt))
    .slice(0, 2);
  if (topSignals.length > 0) {
    lines.push('');
    lines.push('📰 <b>Por qué:</b>');
    for (const [id, sig] of topSignals) {
      lines.push(`• ${escapeHtml(id)}: ${escapeHtml(sig.reasons[0] ?? '')}`);
    }
  }

  const text = lines.join('\n');

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_notification: false }),
  });
  const result = await res.json().catch(() => null);

  if (!res.ok) {
    console.error('[telegram-alert] sendMessage failed:', result);
    return NextResponse.json({ ok: false, telegramError: result }, { status: 502 });
  }

  return NextResponse.json({ ok: true, sentTo: chatId, textLength: text.length });
}
