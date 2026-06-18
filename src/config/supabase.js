const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
// Service role key bypasses RLS — correct for all backend (server-side) operations
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

// Custom fetch with AbortController: cuts the underlying HTTP request at 8s.
// Without this, a stale/frozen TCP socket to Supabase (documented Vercel cold-start
// issue) causes queries to hang for ~53s. The AbortController cancels at the network
// layer — not just a Promise.race wrapper — so resources are actually freed.
// If options already carry a signal, we race ours against it so neither is ignored.
const FETCH_TIMEOUT_MS = 8000;
const customFetch = (url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  // If caller passed its own signal, abort ours when theirs fires too
  const existingSignal = options.signal;
  if (existingSignal) {
    if (existingSignal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      existingSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
};

const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: customFetch },
});

module.exports = supabase;
