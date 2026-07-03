// src/routes/marketing.js — Módulo Marketing
const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');
const Anthropic = require('@anthropic-ai/sdk');

const claude  = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const HEX_RE  = /^#[0-9A-Fa-f]{6}$/;

// ── System prompt para plantillas compuestas (2 paneles) ──────────────────────
const SYSTEM_COMPUESTA = `Eres director creativo de una agencia de marketing premium de bienes raíces en Guatemala.
Creas contenido para imágenes comparativas de 2 paneles (antes/después, opción A/B, dos propiedades, etc.).
Responde ÚNICAMENTE con JSON válido, sin markdown ni texto extra.

Estructura exacta:
{
  "copy_texto": "...",
  "hashtags": "...",
  "paneles": [
    { "prompt_imagen": "...", "titulo": "...", "subtitulo": "...", "precio": "...", "detalle": "..." },
    { "prompt_imagen": "...", "titulo": "...", "subtitulo": "...", "precio": "...", "detalle": "..." }
  ]
}

Reglas:
- prompt_imagen: inglés, 60-100 palabras, solo la escena fotorrealista (sin texto, sin logos, sin personas identificables)
- titulo: máx 20 caracteres (ej: "ANTES", "DESPUÉS", "OPCIÓN A")
- subtitulo: máx 40 caracteres (características clave del panel)
- precio: máx 20 caracteres (precio con moneda, o "" si no aplica)
- detalle: máx 50 caracteres (ubicación u otro dato diferenciador)
- copy_texto: español, máx 150 palabras, listo para publicar en redes
- hashtags: mezcla español/inglés, relevantes a bienes raíces Guatemala`;

function construirPromptCompuesta(orden, ctx, plantilla) {
  const id  = ctx.identidad;
  const col = id?.colores ?? {};
  return `IDENTIDAD DE MARCA:
- Nombre: ${id?.nombre_negocio    ?? 'Virtual Estate GT'}
- Enfoque: ${id?.enfoque_negocio  ?? ''}
- Tono: ${id?.tono_comunicacion   ?? ''}
- Público: ${id?.publico_objetivo ?? ''}
- Colores: primario ${col.primario ?? '#2D5016'}, acento ${col.acento ?? '#B8860B'}

INSTRUCCIONES GENERALES:
${ctx.generales.length    ? ctx.generales.map(i    => `• ${i}`).join('\n') : '(ninguna)'}

INSTRUCCIONES ESPECÍFICAS:
${ctx.individuales.length ? ctx.individuales.map(i => `• ${i}`).join('\n') : '(ninguna)'}

ORDEN:
- Título: ${orden.titulo ?? ''}
- Descripción: ${orden.descripcion ?? ''}
- Plantilla: ${plantilla.nombre} — ${plantilla.descripcion ?? ''}
- Instrucciones extra: ${orden.instrucciones_extra ?? '(ninguna)'}

Genera el JSON para los 2 paneles de la imagen comparativa.`;
}

// ── Status ────────────────────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  res.json({ ok: true, modulo: 'marketing', fase: 5 });
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
            logo_posicion, logo_tamano, logo_tamano_pct,
            plantilla_id } = req.body;
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
        logo_tamano_pct:    logo_tamano_pct    ?? 15,
        plantilla_id:       plantilla_id       ?? null
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

// ── Plantillas compuestas ─────────────────────────────────────────────────────
router.get('/plantillas', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('plantillas_compuestas').select('*').eq('activa', true).order('id');
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fase 1 de la generación compuesta: Claude genera plan (textos + prompts) y
// crea el registro contenido_generado con paneles sin imagen_url todavía.
router.post('/ordenes/:id/plan-compuesta', async (req, res) => {
  const ordenId = Number(req.params.id);
  const { formato = '1:1' } = req.body;
  try {
    const { data: orden, error: ordErr } = await supabase
      .from('ordenes_contenido').select('*').eq('id', ordenId).single();
    if (ordErr) throw ordErr;
    if (!orden.plantilla_id) throw new Error('Esta orden no tiene plantilla asignada');

    const { data: plantilla, error: ptErr } = await supabase
      .from('plantillas_compuestas').select('*').eq('id', orden.plantilla_id).single();
    if (ptErr) throw ptErr;

    const { leerContextoMarca } = require('../services/contentEngine');
    const ctx = await leerContextoMarca(orden.instrucciones_ids ?? []);

    const msg = await claude.messages.create(
      {
        model:      'claude-sonnet-4-6',
        max_tokens: 1200,
        system:     SYSTEM_COMPUESTA,
        messages:   [{ role: 'user', content: construirPromptCompuesta(orden, ctx, plantilla) }]
      },
      { timeout: 25000 }
    );

    const raw = msg.content.find(b => b.type === 'text')?.text ?? '';
    let plan;
    try {
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      plan = JSON.parse(clean);
    } catch { throw new Error('Claude no devolvió JSON válido para la compuesta'); }

    if (!Array.isArray(plan.paneles) || plan.paneles.length < 2)
      throw new Error('Claude no devolvió los 2 paneles requeridos');

    const panelesInicial = plan.paneles.map(p => ({
      prompt_imagen: p.prompt_imagen ?? '',
      titulo:        p.titulo        ?? '',
      subtitulo:     p.subtitulo     ?? '',
      precio:        p.precio        ?? '',
      detalle:       p.detalle       ?? '',
      imagen_url:    null
    }));

    const { data: fila, error: insErr } = await supabase
      .from('contenido_generado')
      .insert({
        orden_id:     ordenId,
        plantilla_id: orden.plantilla_id,
        copy_texto:   plan.copy_texto ?? '',
        hashtags:     plan.hashtags   ?? '',
        prompt_usado: 'compuesta',
        paneles:      panelesInicial,
        formato,
        imagen_url:   null,
        estado:       'pendiente'
      })
      .select().single();
    if (insErr) throw insErr;

    await supabase.from('ordenes_contenido').update({ estado: 'generando' }).eq('id', ordenId);
    res.json({ contenido: fila });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fase 2: el frontend llama este endpoint en paralelo (uno por panel).
// Genera la foto IA del panel y guarda su URL en paneles[idx].imagen_url.
router.post('/contenido/:id/paneles/:idx/foto', async (req, res) => {
  const contenidoId = req.params.id;
  const idx         = Number(req.params.idx);
  try {
    const { data: cont, error: contErr } = await supabase
      .from('contenido_generado').select('*').eq('id', contenidoId).single();
    if (contErr) throw contErr;

    const paneles = cont.paneles ?? [];
    if (!paneles[idx]) throw new Error(`Panel ${idx} no existe`);
    const prompt = paneles[idx].prompt_imagen;
    if (!prompt?.trim()) throw new Error(`Panel ${idx} sin prompt_imagen`);

    const { generarImagen } = require('../services/imageProvider');
    const { buffer } = await generarImagen(prompt, { formato: cont.formato ?? '1:1' });
    const pngBuf = await require('sharp')(buffer).png().toBuffer();

    const slug = (cont.formato ?? '1:1').replace(':', '-');
    const path = `ordenes/${cont.orden_id}/panel-${idx}-${slug}-${Date.now()}.png`;
    const { error: upErr } = await supabase.storage
      .from('marketing').upload(path, pngBuf, { contentType: 'image/png', upsert: false });
    if (upErr) throw upErr;

    const { data: { publicUrl } } = supabase.storage.from('marketing').getPublicUrl(path);

    const { data: updated, error: updErr } = await supabase
      .rpc('mkt_set_panel_foto', {
        p_contenido_id: Number(contenidoId),
        p_panel_idx:    idx,
        p_url:          publicUrl
      });
    if (updErr) throw updErr;

    res.json({ ok: true, imagen_url: publicUrl, contenido: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fase 3: compone la imagen final a partir de las fotos de los paneles.
router.post('/contenido/:id/componer', async (req, res) => {
  try {
    const { data: cont, error: contErr } = await supabase
      .from('contenido_generado').select('*').eq('id', req.params.id).single();
    if (contErr) throw contErr;
    if (!cont.paneles?.length) throw new Error('Sin paneles para componer');

    const faltantes = cont.paneles
      .map((p, i) => p.imagen_url ? null : i)
      .filter(i => i !== null);
    if (faltantes.length)
      return res.status(409).json({ error: 'Paneles sin foto', faltantes });

    const { data: identidad } = await supabase
      .from('marca_identidad').select('*').limit(1).maybeSingle();

    const { renderComparativa2Col } = require('../services/templateEngine');
    const composed = await renderComparativa2Col(
      cont.paneles, { formato: cont.formato ?? '1:1', identidad: identidad ?? {} }
    );

    const slug = (cont.formato ?? '1:1').replace(':', '-');
    const path = `ordenes/${cont.orden_id}/compuesta-${slug}-${Date.now()}.png`;
    const { error: upErr } = await supabase.storage
      .from('marketing').upload(path, composed, { contentType: 'image/png', upsert: false });
    if (upErr) throw upErr;

    const { data: { publicUrl } } = supabase.storage.from('marketing').getPublicUrl(path);
    const { data: updated, error: updErr } = await supabase
      .from('contenido_generado').update({ imagen_url: publicUrl }).eq('id', req.params.id).select().single();
    if (updErr) throw updErr;

    await supabase.from('ordenes_contenido').update({ estado: 'generada' }).eq('id', cont.orden_id);
    res.json({ ok: true, imagen_url: publicUrl, contenido: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Editar textos de los paneles sin regenerar imágenes.
router.put('/contenido/:id/paneles-textos', async (req, res) => {
  try {
    const { paneles: upd } = req.body;
    if (!Array.isArray(upd)) return res.status(400).json({ error: 'paneles debe ser un array' });

    const { data: cont, error: contErr } = await supabase
      .from('contenido_generado').select('paneles').eq('id', req.params.id).single();
    if (contErr) throw contErr;

    const updPaneles = (cont.paneles ?? []).map((p, i) => {
      const u = upd[i] ?? {};
      return {
        ...p,
        titulo:    u.titulo    !== undefined ? u.titulo    : p.titulo,
        subtitulo: u.subtitulo !== undefined ? u.subtitulo : p.subtitulo,
        precio:    u.precio    !== undefined ? u.precio    : p.precio,
        detalle:   u.detalle   !== undefined ? u.detalle   : p.detalle,
      };
    });
    const { data, error } = await supabase
      .from('contenido_generado').update({ paneles: updPaneles }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
