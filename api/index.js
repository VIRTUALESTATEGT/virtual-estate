const app     = require('../server.js');
const supabase = require('../src/config/supabase');

// Vercel serverless handler
module.exports = (req, res) => {
  // Health / warmup — intercepted before Express so no auth middleware can touch it.
  // Uses startsWith + strip-query-params to handle any URL variant Vercel might pass.
  const rawUrl  = req.url || '';
  const pathname = rawUrl.replace(/[?#].*$/, ''); // strip query string and hash
  const isHealth = req.method === 'GET' &&
    (pathname === '/api/health' || pathname === '/health' ||
     pathname.startsWith('/api/health/') || pathname.startsWith('/health/'));

  if (isHealth) {
    res.setHeader('Content-Type', 'application/json');
    // Include rawUrl so the caller can see exactly what Vercel is passing
    res.end(JSON.stringify({ ok: true, url: rawUrl, t: new Date().toISOString() }));
    // Keep the Supabase HTTPS connection alive for subsequent Instagram/WhatsApp requests
    supabase.from('conversaciones_multicanal').select('id').limit(1)
      .then(() => {}).catch(() => {});
    return;
  }

  return app(req, res);
};
