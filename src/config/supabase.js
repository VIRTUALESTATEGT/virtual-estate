const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
// Service role key bypasses RLS — correct for all backend (server-side) operations
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

// AbortSignal.timeout() cuts the underlying HTTP request at the network level.
// More reliable than setTimeout+AbortController in Lambda environments because
// it doesn't depend on the JS event loop ticking during a potential freeze.
// 5s: warm connections complete in <200ms; 5s only fires on dead sockets.
const customFetch = (url, options = {}) => {
  console.log('[SUPABASE-FETCH]', String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0]);
  return fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
};

const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: customFetch },
});

module.exports = supabase;
