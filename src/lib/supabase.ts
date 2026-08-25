import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Browser/client-side: anon key, RLS applies.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;

// Server-only (API routes): service role key, bypasses RLS. Never import this from client components.
export const supabaseAdmin = url && serviceKey ? createClient(url, serviceKey) : null;
