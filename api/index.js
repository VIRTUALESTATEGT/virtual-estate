const app     = require('../server.js');
const supabase = require('../src/config/supabase');

// Vercel serverless handler
module.exports = (req, res) => {
  // Health / warmup — intercepted before Express so no auth middleware can touch it.
  // Handles both /api/health (Vercel keeps full path) and /health (Vercel strips /api prefix).
  const url = req.url || '';
  if (req.method === 'GET' && (url === '/api/health' || url === '/health')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, t: new Date().toISOString() }));
    // Keep the Supabase HTTPS connection alive for subsequent Instagram/WhatsApp requests
    supabase.from('conversaciones_multicanal').select('id').limit(1)
      .then(() => {}).catch(() => {});
    return;
  }

  return app(req, res);
};
