// src/routes/marketing.js — Módulo Marketing
const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');
const Anthropic = require('@anthropic-ai/sdk');

const claude  = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const HEX_RE  = /^#[0-9A-Fa-f]{6}$/;

// ── Status ────────────────────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  res.json({ ok: true, modulo: 'marketing', fase: 5 });
});

// ── TEST SPIKE: verificar fuentes TTF vía fontconfig + Sharp ─────────────────
// TEMPORAL — eliminar antes del commit final de Fase 5
router.get('/test-fuentes', async (_req, res) => {
  try {
    const sharp = require('sharp');
    const { setupFontconfig } = require('../utils/fonts');
    setupFontconfig();
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="300">
        <rect width="700" height="300" fill="#0D1A14"/>
        <text x="30" y="80"  font-family="Montserrat" font-weight="700" font-size="36" fill="#C19259">Virtual Estate GT</text>
        <text x="30" y="135" font-family="Montserrat" font-weight="400" font-size="22" fill="#F5F0E8">Fotografia inmobiliaria premium</text>
        <text x="30" y="200" font-family="Raleway"    font-weight="600" font-size="28" fill="#C19259">Escribenos por WhatsApp</text>
        <text x="30" y="255" font-family="Montserrat" font-weight="400" font-size="16" fill="#7A8D85">Si ves Montserrat y Raleway: fuentes OK en Lambda</text>
      </svg>`
    );
    const png = await sharp(svg).png().toBuffer();
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Identidad de Marca ────────────────────────────────────────────────────────
router.get('/identidad', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('marca_identidad').select('*').limit(1).maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/identidad', async (req, res) => {
  try {
    const { nombre_negocio, logo_url, enfoque_negocio,
            tono_comunicacion, publico_objetivo, colores, tipografias } = req.body;
    const payload = { updated_at: new Date().toISOString() };
    if (nombre_negocio    !== undefined) payload.nombre_negocio    = nombre_negocio;
    if (logo_url          !== undefined) payload.logo_url          = logo_url;
    if (enfoque_negocio   !== undefined) payload.enfoque_negocio   = enfoque_negocio;
    if (tono_comunicacion !== undefined) payload.tono_comunicacion = tono_comunicacion;
    if (publico_objetivo  !== undefined) payload.publico_objetivo  = publico_objetivo;
    if (colores !== undefined) {
      for (const [k, v] of [['primario', colores.primario], ['secundario', colores.secundario], ['acento', colores.acento]])
        if (v !== undefined && !HEX_RE.test(v))
          return res.status(400).json({ error: `colores.${k} debe tener formato #RRGGBB` });
      payload.colores = { primario: colores.primario, secundario: colores.secundario, acento: colores.acento };
    }
    if (tipografias !== undefined)
      payload.tipografias = { principal: tipografias.principal ?? null, secundaria: tipografias.secundaria ?? null };

    const { data: existing, error: chkErr } = await supabase
      .from('marca_identidad').select('id').limit(1).maybeSingle();
    if (chkErr) throw chkErr;
    const { data, error } = existing
      ? await supabase.from('marca_identidad').update(payload).eq('id', existing.id).select().single()
      : await supabase.from('marca_identidad').insert(payload).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Instrucciones ─────────────────────────────────────────────────────────────
router.get('/instrucciones', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('marketing_instrucciones').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/instrucciones', async (req, res) => {
  try {
    const { tipo, instruccion } = req.body;
    if (!tipo || !['general', 'individual'].includes(tipo))
      return res.status(400).json({ error: 'tipo debe ser general o individual' });
    if (!instruccion?.trim())
      return res.status(400).json({ error: 'instruccion es requerida' });
    const { data, error } = await supabase
      .from('marketing_instrucciones')
      .insert({ tipo, instruccion: instruccion.trim() }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/instrucciones/:id', async (req, res) => {
  try {
    const { instruccion, activa } = req.body;
    const payload = {};
    if (instruccion !== undefined) payload.instruccion = instruccion.trim();
    if (activa      !== undefined) payload.activa      = Boolean(activa);
    if (!Object.keys(payload).length)
      return res.status(400).json({ error: 'Nada que actualizar' });
    const { data, error } = await supabase
      .from('marketing_instrucciones').update(payload).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/instrucciones/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('marketing_instrucciones').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Órdenes de Contenido ──────────────────────────────────────────────────────
router.get('/ordenes', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('ordenes_contenido')
      .select(`*, contenido_generado(id, estado, formato, imagen_url, imagen_original_url, copy_texto, hashtags, prompt_usado, created_at)`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ordenes', async (req, res) => {
  try {
    const { titulo, descripcion, tipo_contenido, redes,
            instrucciones_extra, instrucciones_ids, formatos,
            logo_posicion, logo_tamano, logo_tamano_pct } = req.body;
    if (!titulo?.trim()) return res.status(400).json({ error: 'titulo es requerido' });
    const POSICIONES_VALIDAS = ['inferior-derecha','inferior-izquierda','superior-derecha','superior-izquierda','centro','sin-logo'];
    const TAMANOS_VALIDOS    = ['pequeno','mediano','grande'];
    if (logo_posicion && !POSICIONES_VALIDAS.includes(logo_posicion))
      return res.status(400).json({ error: 'logo_posicion inválida' });
    if (logo_tamano && !TAMANOS_VALIDOS.includes(logo_tamano))
      return res.status(400).json({ error: 'logo_tamano inválido' });
    if (logo_tamano_pct !== undefined && (!Number.isInteger(logo_tamano_pct) || logo_tamano_pct < 5 || logo_tamano_pct > 40))
      return res.status(400).json({ error: 'logo_tamano_pct debe ser entero entre 5 y 40' });
    const { data, error } = await supabase
      .from('ordenes_contenido')
      .insert({
        titulo:             titulo.trim(),
        descripcion:        descripcion        ?? null,
        tipo_contenido:     tipo_contenido     ?? 'imagen',
        redes:              redes              ?? [],
        instrucciones_extra: instrucciones_extra ?? null,
        instrucciones_ids:  instrucciones_ids  ?? [],
        formatos:           formatos?.length   ? formatos : ['1:1'],
        logo_posicion:      logo_posicion      ?? 'inferior-derecha',
        logo_tamano:        logo_tamano        ?? 'mediano',
        logo_tamano_pct:    logo_tamano_pct    ?? 15
      })
      .select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ordenes/:id/generar', async (req, res) => {
  try {
    const { formato = '1:1' } = req.body;
    const { ejecutar } = require('../services/contentEngine');
    const contenido = await ejecutar(Number(req.params.id), formato);
    res.json({ ok: true, contenido });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Contenido generado ────────────────────────────────────────────────────────
router.get('/contenido', async (req, res) => {
  try {
    const { estado } = req.query;
    let q = supabase.from('contenido_generado')
      .select('*, ordenes_contenido(logo_posicion, logo_tamano, logo_tamano_pct)')
      .order('created_at', { ascending: false });
    if (estado) q = q.eq('estado', estado);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/contenido/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('contenido_generado').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/contenido/:id', async (req, res) => {
  try {
    const { copy_texto, hashtags, estado, comentario_rechazo } = req.body;
    const ESTADOS = ['pendiente', 'aprobado', 'rechazado', 'publicado'];
    if (estado !== undefined && !ESTADOS.includes(estado))
      return res.status(400).json({ error: `estado inválido: ${estado}` });
    const payload = {};
    if (copy_texto          !== undefined) payload.copy_texto          = copy_texto;
    if (hashtags            !== undefined) payload.hashtags            = hashtags;
    if (estado              !== undefined) payload.estado              = estado;
    if (comentario_rechazo  !== undefined) payload.comentario_rechazo  = comentario_rechazo;
    if (!Object.keys(payload).length)
      return res.status(400).json({ error: 'Nada que actualizar' });
    const { data, error } = await supabase
      .from('contenido_generado').update(payload).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Genera imagen adicional en un formato distinto reutilizando el prompt del contenido base
router.post('/contenido/:id/generar-imagen', async (req, res) => {
  try {
    const { formato = '1:1' } = req.body;
    const { ejecutarFormato } = require('../services/contentEngine');
    const contenido = await ejecutarFormato(req.params.id, formato);
    res.json({ ok: true, contenido });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Alias legacy — mantiene compatibilidad con el botón de Fase 3
router.post('/contenido/:id/reintentar-imagen', async (req, res) => {
  try {
    const { formato } = req.body;
    const { ejecutarFormato } = require('../services/contentEngine');
    const { data: cont } = await supabase.from('contenido_generado').select('formato').eq('id', req.params.id).single();
    const contenido = await ejecutarFormato(req.params.id, formato ?? cont?.formato ?? '1:1');
    res.json({ ok: true, contenido });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/contenido/:id/regenerar', async (req, res) => {
  try {
    const { ajuste, logo_posicion, logo_tamano, logo_tamano_pct, formato } = req.body;
    const { regenerar } = require('../services/contentEngine');
    const contenido = await regenerar(req.params.id, {
      ajuste,
      logoPosicion:  logo_posicion,
      logoTamano:    logo_tamano,
      logoTamanoPct: typeof logo_tamano_pct === 'number' ? logo_tamano_pct : null,
      formato
    });
    res.json({ ok: true, contenido });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Subida de logo de marca ───────────────────────────────────────────────────
// Nombre fijo brand/logo.png + upsert:true → nunca acumula huérfanos.
// Sharp convierte cualquier formato entrada (jpg/webp/png) a PNG.
const multer = require('multer');
const sharp  = require('sharp');

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Solo PNG, JPG o WEBP permitidos'), ok);
  }
});

router.post('/brand/logo', (req, res) => {
  logoUpload.single('logo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    try {
      const pngBuffer = await sharp(req.file.buffer).png().toBuffer();
      const { error: upErr } = await supabase.storage
        .from('marketing')
        .upload('brand/logo.png', pngBuffer, {
          contentType: 'image/png',
          upsert: true           // sobrescribe siempre, sin huérfanos
        });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage
        .from('marketing').getPublicUrl('brand/logo.png');
      res.json({ url: `${publicUrl}?v=${Date.now()}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

// ── Prompt Studio (stateless) ─────────────────────────────────────────────────
const PROMPT_STUDIO_SYSTEM = `Eres un ingeniero de prompts senior especializado en IA generativa para marketing de bienes raíces premium en Guatemala.

Transforma la idea del usuario en un prompt profesional y detallado según el tipo de contenido:

IMAGEN FOTORREALISTA: tipo de toma (angular/aérea/macro/etc), iluminación (hora, dirección, calidad), lente/distancia focal, ambiente y atmósfera, paleta de color, estilo (editorial/arquitectónico/lifestyle), negativos (lo que NO debe aparecer).

VIDEO: movimiento de cámara, duración, ritmo, transiciones, música sugerida, estilo cinematográfico.

DISEÑO GRÁFICO: composición, tipografía sugerida, jerarquía visual, espacio negativo, paleta, estilo gráfico.

TEXTO PUBLICITARIO: hook, estructura (AIDA/PAS/storytelling), CTA, tono, longitud, plataforma destino.

Responde ÚNICAMENTE con el prompt mejorado. Sin explicaciones, sin prefijos, sin markdown.`;

router.post('/prompt-studio', async (req, res) => {
  try {
    const { idea, destino = 'imagen_fotorrealista', idioma = 'ingles' } = req.body;
    if (!idea?.trim()) return res.status(400).json({ error: 'idea es requerida' });

    const { data: identidad } = await supabase
      .from('marca_identidad').select('*').limit(1).maybeSingle();
    const id  = identidad ?? {};
    const col = id.colores ?? {};

    const userMsg = `IDENTIDAD DE MARCA:
- Nombre: ${id.nombre_negocio    ?? 'Virtual Estate GT'}
- Colores: ${col.primario ?? '#2D5016'} / ${col.acento ?? '#B8860B'}
- Tono: ${id.tono_comunicacion   ?? 'profesional y premium'}

IDEA: ${idea.trim()}
TIPO DE CONTENIDO: ${destino}
IDIOMA DEL PROMPT DE SALIDA: ${idioma === 'espanol' ? 'español' : 'inglés'}

Genera el prompt mejorado.`;

    const msg = await claude.messages.create(
      {
        model:      'claude-sonnet-4-6',
        max_tokens: 800,
        system:     PROMPT_STUDIO_SYSTEM,
        messages:   [{ role: 'user', content: userMsg }]
      },
      { timeout: 20000 }
    );

    const prompt = msg.content.find(b => b.type === 'text')?.text?.trim() ?? '';
    res.json({ prompt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
