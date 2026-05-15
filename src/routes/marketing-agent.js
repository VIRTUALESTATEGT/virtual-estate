// src/routes/marketing-agent.js
const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');
const Anthropic = require('@anthropic-ai/sdk');
const axios    = require('axios');

const getAnthropicClient = (req) => {
  const apiKey = req?.headers?.['x-api-key'] || process.env.CLAUDE_API_KEY;
  return new Anthropic({ apiKey });
};

const INSTAGRAM_API        = 'https://graph.instagram.com/v18.0';
const INSTAGRAM_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID || '';
const ACCESS_TOKEN         = process.env.INSTAGRAM_ACCESS_TOKEN || '';

const BIZ_ID = (req) => req.user?.id || 'virtual-estate';

// ============================================================
// BRAND IDENTITY
// ============================================================

router.get('/brand-identity', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('brand_identity')
      .select('*')
      .eq('business_id', BIZ_ID(req))
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json(data || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/brand-identity', async (req, res) => {
  try {
    const { logo_url, color_primary, color_secondary, color_accent, brand_guidelines, reference_images } = req.body;
    const { data, error } = await supabase
      .from('brand_identity')
      .upsert({
        business_id: BIZ_ID(req),
        logo_url, color_primary, color_secondary, color_accent,
        brand_guidelines,
        reference_images: reference_images || [],
        updated_at: new Date()
      }, { onConflict: 'business_id' })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// GLOBAL INSTRUCTIONS
// ============================================================

router.get('/instructions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('global_instructions')
      .select('*')
      .eq('business_id', BIZ_ID(req))
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json(data || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/instructions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('global_instructions')
      .upsert({
        business_id: BIZ_ID(req),
        ...req.body,
        updated_at: new Date()
      }, { onConflict: 'business_id' })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// PENDING ORDERS
// ============================================================

router.get('/orders', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pending_orders')
      .select('*')
      .eq('business_id', BIZ_ID(req))
      .eq('status', 'active')
      .order('priority', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/orders', async (req, res) => {
  try {
    const { instruction, focus_theme, reference_images, priority, start_date, end_date } = req.body;
    const { data, error } = await supabase
      .from('pending_orders')
      .insert({
        business_id: BIZ_ID(req),
        instruction, focus_theme,
        reference_images: reference_images || [],
        priority: priority || 1,
        start_date, end_date,
        status: 'active'
      })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/orders/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('pending_orders')
      .update({ status: 'completed' })
      .eq('id', req.params.id)
      .eq('business_id', BIZ_ID(req));
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// GENERATED POSTS
// ============================================================

router.get('/posts/pending', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('generated_posts')
      .select('*')
      .eq('business_id', BIZ_ID(req))
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/posts/published', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('generated_posts')
      .select('*')
      .eq('business_id', BIZ_ID(req))
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/posts/:id/approve', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('generated_posts')
      .update({ status: 'approved', approval_notes: req.body.notes, approved_at: new Date(), updated_at: new Date() })
      .eq('id', req.params.id).eq('business_id', BIZ_ID(req))
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/posts/:id/reject', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('generated_posts')
      .update({ status: 'rejected', approval_notes: req.body.notes, updated_at: new Date() })
      .eq('id', req.params.id).eq('business_id', BIZ_ID(req))
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/posts/:id', async (req, res) => {
  try {
    const { instagram_caption, facebook_caption, hashtags, scheduled_time } = req.body;
    const { data, error } = await supabase
      .from('generated_posts')
      .update({ instagram_caption, facebook_caption, hashtags, scheduled_time, updated_at: new Date() })
      .eq('id', req.params.id).eq('business_id', BIZ_ID(req))
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// GENERATE — Claude genera los posts
// ============================================================

router.post('/generate', async (req, res) => {
  try {
    const biz = BIZ_ID(req);
    const [{ data: brand }, { data: instructions }, { data: orders }] = await Promise.all([
      supabase.from('brand_identity').select('*').eq('business_id', biz).single(),
      supabase.from('global_instructions').select('*').eq('business_id', biz).single(),
      supabase.from('pending_orders').select('*').eq('business_id', biz).eq('status', 'active')
    ]);

    const message = await getAnthropicClient(req).messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: buildGenerationPrompt(brand, instructions, orders) }]
    });

    const posts = parseGeneratedContent(message.content[0].text);
    const inserted = [];
    for (const post of posts) {
      const { data, error } = await supabase
        .from('generated_posts')
        .insert({
          business_id: biz,
          content:           post.content,
          image_url:         post.image_url || null,
          instagram_caption: post.instagram_caption,
          facebook_caption:  post.facebook_caption,
          hashtags:          post.hashtags,
          theme:             post.theme,
          image_description: post.image_description || null,
          source:            'auto',
          status:            'pending',
          scheduled_time:    post.scheduled_time
        })
        .select().single();
      if (!error) inserted.push(data);
    }

    res.json({ generated: inserted.length, posts: inserted });
  } catch (e) {
    console.error('[MarketingAgent/generate]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// PUBLISH to Instagram
// ============================================================

router.post('/posts/:id/publish', async (req, res) => {
  try {
    const biz = BIZ_ID(req);
    const { data: post, error: fetchErr } = await supabase
      .from('generated_posts').select('*')
      .eq('id', req.params.id).eq('business_id', biz).single();
    if (fetchErr) throw fetchErr;
    if (post.status !== 'approved') throw new Error('El post debe ser aprobado primero');
    if (!ACCESS_TOKEN) throw new Error('INSTAGRAM_ACCESS_TOKEN no configurado');

    const igPostId = await publishToInstagram(post);

    const { data, error } = await supabase
      .from('generated_posts')
      .update({ status: 'published', instagram_post_id: igPostId, published_at: new Date(), updated_at: new Date() })
      .eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error('[MarketingAgent/publish]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// HELPERS
// ============================================================

function buildGenerationPrompt(brand, instructions, orders) {
  return `Eres un generador de contenido para redes sociales de Virtual Estate GT, empresa inmobiliaria y de escaneo 3D en Guatemala.

IDENTIDAD DE MARCA:
- Color primario: ${brand?.color_primary || '#2D5016'}
- Color secundario: ${brand?.color_secondary || '#B8860B'}
- Guidelines: ${brand?.brand_guidelines || 'Profesional, elegante, enfocado en propiedades'}

INSTRUCCIONES GLOBALES:
- Tono: ${instructions?.tone || 'profesional'}
- Hashtags: ${(instructions?.hashtags || ['#inmobiliarioGuatemala','#virtualestate']).join(' ')}
- CTA: ${instructions?.required_cta || 'Contáctanos por WhatsApp'}
- Posts por semana: ${instructions?.min_posts_per_week || 5}
- Horarios: ${(instructions?.publish_times || ['09:00','13:00','18:00']).join(', ')}

ÓRDENES ACTIVAS:
${orders?.map(o => `- [Prioridad ${o.priority}] ${o.instruction}`).join('\n') || '- Genera contenido inmobiliario general de Virtual Estate GT'}

Genera exactamente 5 posts. Para cada uno incluye TODOS estos campos:
- theme, content, instagram_caption, facebook_caption, hashtags (array), image_description

Responde ÚNICAMENTE con un JSON array válido, sin texto adicional:
[{"theme":"...","content":"...","instagram_caption":"...","facebook_caption":"...","hashtags":["..."],"image_description":"..."}]`;
}

function parseGeneratedContent(content) {
  try {
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array found');
    return JSON.parse(match[0]).map((post, idx) => ({ ...post, scheduled_time: calculateScheduleTime(idx) }));
  } catch (e) {
    console.error('[parseGeneratedContent]', e.message);
    return [];
  }
}

function calculateScheduleTime(index) {
  const times = ['09:00', '13:00', '18:00'];
  const [h, m] = times[index % times.length].split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + Math.floor(index / times.length) + 1);
  return d.toISOString();
}

async function publishToInstagram(post) {
  const base    = `${INSTAGRAM_API}/${INSTAGRAM_ACCOUNT_ID}`;
  const caption = `${post.instagram_caption}\n\n${(post.hashtags || []).join(' ')}`;
  const { data: container } = await axios.post(`${base}/media`, { image_url: post.image_url, caption, access_token: ACCESS_TOKEN });
  const { data: published } = await axios.post(`${base}/media_publish`, { creation_id: container.id, access_token: ACCESS_TOKEN });
  return published.id;
}

module.exports = router;
