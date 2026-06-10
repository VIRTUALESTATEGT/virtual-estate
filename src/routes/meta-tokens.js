const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const supabase = require('../config/supabase');

// ── Get token from DB, falling back to env var ───────────────────────────────
async function getMetaToken(platform) {
  try {
    const { data } = await supabase
      .from('meta_tokens')
      .select('token, expires_at')
      .eq('platform', platform)
      .maybeSingle();
    if (data?.token) {
      console.log(`[META-TOKEN] loaded from DB — platform: ${platform} | expires_at: ${data.expires_at || 'n/a'}`);
      return data.token;
    }
  } catch (e) {
    console.warn(`[META-TOKEN] DB read failed: ${e.message} — falling back to env var`);
  }
  // Fallback to env var
  const envToken = platform === 'instagram'
    ? process.env.INSTAGRAM_ACCESS_TOKEN
    : process.env.MESSENGER_ACCESS_TOKEN;
  console.log(`[META-TOKEN] using env var for ${platform} — present: ${!!envToken}`);
  return envToken || null;
}

// ── Refresh a long-lived token via Meta Graph API ───────────────────────────
// Meta long-lived tokens are valid for 60 days; refreshing before expiry
// extends them for another 60 days. Run weekly to be safe.
async function refreshMetaToken(platform) {
  const APP_ID     = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET;

  if (!APP_ID || !APP_SECRET || APP_SECRET === 'PENDING') {
    throw new Error('META_APP_ID / META_APP_SECRET not configured');
  }

  const currentToken = await getMetaToken(platform);
  if (!currentToken) throw new Error(`No token found for platform: ${platform}`);

  console.log(`[META-TOKEN] refreshing token for ${platform}...`);
  const { data } = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
    params: {
      grant_type:    'fb_exchange_token',
      client_id:     APP_ID,
      client_secret: APP_SECRET,
      access_token:  currentToken,
    },
  });

  const newToken   = data.access_token;
  const expiresIn  = data.expires_in; // seconds
  const expiresAt  = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  console.log(`[META-TOKEN] new token received | expires_in: ${expiresIn}s | expires_at: ${expiresAt}`);

  // Upsert into meta_tokens
  const { error } = await supabase
    .from('meta_tokens')
    .upsert({ platform, token: newToken, expires_at: expiresAt, updated_at: new Date().toISOString() },
             { onConflict: 'platform' });

  if (error) throw new Error(`DB upsert failed: ${error.message}`);
  console.log(`[META-TOKEN] ✅ token saved to DB for ${platform}`);
  return { platform, expires_at: expiresAt };
}

// ── POST /api/meta/refresh-token ─────────────────────────────────────────────
// Called manually or by Vercel cron (protected by CRON_SECRET)
router.post('/refresh-token', async (req, res) => {
  const secret   = req.headers['x-cron-secret'] || req.query.secret;
  const platform = req.body?.platform || req.query.platform || 'instagram';

  if (!['instagram', 'messenger'].includes(platform)) {
    return res.status(400).json({ error: 'platform must be instagram or messenger' });
  }
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await refreshMetaToken(platform);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[META-TOKEN] refresh error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/meta/token-status ───────────────────────────────────────────────
router.get('/token-status', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { data } = await supabase
      .from('meta_tokens')
      .select('platform, expires_at, updated_at');
    const status = ['instagram', 'messenger'].map(p => {
      const row = data?.find(r => r.platform === p);
      return {
        platform: p,
        source:      row ? 'database' : 'env_var',
        expires_at:  row?.expires_at || null,
        updated_at:  row?.updated_at || null,
        env_present: p === 'instagram' ? !!process.env.INSTAGRAM_ACCESS_TOKEN : !!process.env.MESSENGER_ACCESS_TOKEN,
      };
    });
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.getMetaToken = getMetaToken;
