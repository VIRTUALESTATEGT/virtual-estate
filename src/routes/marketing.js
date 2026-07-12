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
      .select(`*, contenido_generado(id, estado, formato, imagen_url, imagen_original_url, copy_texto, hashtags, prompt_usado, video_url, video_operation, duracion_seg, plantilla_id, paneles, clips, created_at)`)
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
            plantilla_id, duracion_seg, guion_clips,
            permitir_voces, video_calidad, referencia_id } = req.body;
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
        plantilla_id:       plantilla_id       ?? null,
        duracion_seg:       duracion_seg       ?? 8,
        guion_clips:        Array.isArray(guion_clips) && guion_clips.length ? guion_clips : null,
        permitir_voces:     Boolean(permitir_voces),
        video_calidad:      ['fast', 'quality'].includes(video_calidad) ? video_calidad : 'fast',
        referencia_id:      referencia_id ? Number(referencia_id) : null
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

function buildSystemVideoStudio(permitirVoces = false) {
  const sonidoRegla = permitirVoces
    ? ''
    : '\n- Cada prompt debe incluir al final: "ambient sound only, no dialogue, no speech"';
  return `Eres director de fotografía y guionista de video especializado en bienes raíces premium de Guatemala.
Creas prompts para Veo 3.1 (IA generativa de Google). Responde ÚNICAMENTE con JSON válido, sin markdown ni texto extra.

ESTRUCTURA OBLIGATORIA por cada clip:
[SUJETO] → [UNA SOLA ACCIÓN] → [MOVIMIENTO DE CÁMARA] → [ILUMINACIÓN] → [AMBIENTE/ATMÓSFERA]

Reglas absolutas:
- Inglés, máximo 100 palabras por clip
- UNA sola acción por clip (Veo falla con múltiples acciones simultáneas)
- Prohibido: texto en pantalla, logos visibles
- Personas sí permitidas (familias, agentes, compradores) cuando la idea lo requiera
- En multi-clip: consistencia visual entre todos los clips (misma paleta, iluminación y locación coherentes para que al editarlos en secuencia se sientan continuos)
- Cada clip es un prompt independiente y completo
- Integra anclas fotográficas de realismo como parte natural de la descripción cinematográfica: especifica cámara y lente (ej. "shot on Sony A7III, 35mm lens"), incluye "natural skin texture" cuando haya personas, usa "documentary style" cuando refuerce la atmósfera real, añade "subtle handheld movement" cuando la escena lo permita${sonidoRegla}

Para CLIP ÚNICO (≤8 seg) responde EXACTAMENTE con este JSON:
{
  "tipo": "single",
  "prompt": "...",
  "limitantes": "..."
}

Para MULTI-CLIP (>8 seg) responde EXACTAMENTE con este JSON:
{
  "tipo": "multi",
  "clips": [
    { "numero": 1, "duracion_seg": N, "prompt": "..." },
    { "numero": 2, "duracion_seg": N, "prompt": "..." }
  ],
  "limitantes": "..."
}

El campo "limitantes" va en español, 80-120 palabras. Debe ser específico a la idea del usuario:
qué puede hacer Veo bien con esa idea, qué probablemente no puede lograr (texto en pantalla,
logos, múltiples acciones distintas dentro de un clip, continuidad perfecta de movimiento entre
clips, escenas muy complejas), y cómo resolverlo en edición externa (agregar texto/logo en
post-producción, unir clips con corte o transición, etc.).`;
}

const SYSTEM_VIDEO_MODIFY = `Eres asistente de dirección de video. El usuario quiere modificar ÚNICAMENTE un aspecto específico de un prompt de video para Veo 3.1.

Aplica SOLO el cambio solicitado. No modifiques nada más: mantén la estructura, el movimiento de cámara, la iluminación, el ambiente y todos los demás detalles idénticos salvo lo pedido explícitamente.

Responde ÚNICAMENTE con el prompt modificado en inglés. Sin explicaciones, sin JSON, solo el texto del prompt.`;

router.post('/prompt-studio', async (req, res) => {
  try {
    const { idea, destino = 'imagen_fotorrealista', idioma = 'ingles',
            duracion_seg, duraciones_por_clip, permitir_voces = false } = req.body;
    if (!idea?.trim()) return res.status(400).json({ error: 'idea es requerida' });

    const { data: identidad } = await supabase
      .from('marca_identidad').select('*').limit(1).maybeSingle();
    const id  = identidad ?? {};
    const col = id.colores ?? {};

    // ── Rama video: usa SYSTEM_VIDEO_STUDIO y devuelve { tipo, prompt?, clips?, limitantes }
    if (destino === 'video') {
      const dur  = Number(duracion_seg) || 8;
      const dist = Array.isArray(duraciones_por_clip) && duraciones_por_clip.length
        ? duraciones_por_clip
        : Array.from({ length: Math.ceil(dur / 8) }, (_, i) => Math.min(8, dur - i * 8));
      const tipo = dist.length === 1 ? 'single' : 'multi';

      const userMsg = `IDENTIDAD DE MARCA:
- Nombre: ${id.nombre_negocio   ?? 'Virtual Estate GT'}
- Colores: ${col.primario ?? '#2D5016'} / ${col.acento ?? '#B8860B'}
- Tono: ${id.tono_comunicacion  ?? 'profesional y premium'}

IDEA: ${idea.trim()}
DURACIÓN TOTAL: ${dur} segundos
DISTRIBUCIÓN DE CLIPS: ${dist.map((d, i) => `Clip ${i + 1}: ${d}s`).join(', ')}
TIPO REQUERIDO: ${tipo === 'single' ? 'CLIP ÚNICO' : `MULTI-CLIP (${dist.length} clips)`}

Genera el JSON de video.`;

      const msg = await claude.messages.create(
        {
          model:      'claude-sonnet-4-6',
          max_tokens: 2000,
          system:     buildSystemVideoStudio(Boolean(permitir_voces)),
          messages:   [{ role: 'user', content: userMsg }]
        },
        { timeout: 25000 }
      );

      const raw = msg.content.find(b => b.type === 'text')?.text ?? '';
      try {
        const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        return res.json(JSON.parse(clean));
      } catch { return res.status(500).json({ error: 'Claude no devolvió JSON válido' }); }
    }

    // ── Rama no-video: comportamiento original
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

router.post('/prompt-studio/modificar', async (req, res) => {
  try {
    const { tipo, prompt, clips, clip_idx, modificacion } = req.body;
    if (!modificacion?.trim()) return res.status(400).json({ error: 'modificacion es requerida' });

    const applyModify = async (originalPrompt) => {
      const msg = await claude.messages.create(
        {
          model:      'claude-sonnet-4-6',
          max_tokens: 600,
          system:     SYSTEM_VIDEO_MODIFY,
          messages:   [{ role: 'user', content: `PROMPT ORIGINAL:\n${originalPrompt}\n\nMODIFICACIÓN SOLICITADA: ${modificacion.trim()}` }]
        },
        { timeout: 15000 }
      );
      return msg.content.find(b => b.type === 'text')?.text?.trim() ?? originalPrompt;
    };

    if (tipo === 'single') {
      if (!prompt) return res.status(400).json({ error: 'prompt es requerido para tipo single' });
      const modified = await applyModify(prompt);
      return res.json({ tipo: 'single', prompt: modified });
    }

    // multi: apply to specific clip or all
    if (!Array.isArray(clips) || !clips.length)
      return res.status(400).json({ error: 'clips es requerido para tipo multi' });

    const applyAll = clip_idx === 'all' || clip_idx === null || clip_idx === undefined;
    const updatedClips = await Promise.all(
      clips.map(async (c, i) => {
        if (applyAll || Number(clip_idx) === i) {
          return { ...c, prompt: await applyModify(c.prompt) };
        }
        return c;
      })
    );
    res.json({ tipo: 'multi', clips: updatedClips });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Video con Veo 3.1 ─────────────────────────────────────────────────────────
const SYSTEM_VIDEO = `Eres director creativo de una agencia de marketing premium de bienes raíces en Guatemala.
Creas prompts de video para Veo (IA generativa de Google). Responde ÚNICAMENTE con JSON válido, sin markdown.

Estructura exacta:
{
  "prompt_video": "...",
  "copy_texto":   "...",
  "hashtags":     "..."
}

Reglas para prompt_video:
- Inglés, 80-120 palabras, estilo cinematográfico editorial
- Describe movimiento de cámara (drone tracking shot, slow dolly, cinematic pan, aerial orbit, etc.)
- Describe iluminación (golden hour, soft morning light, dramatic shadows, etc.) y materiales/texturas
- SIN texto en pantalla, SIN logos visibles, SIN personas identificables
- Para 9:16: encuadre vertical, detalles macro, perspectiva íntima
- Para 16:9: planos amplios, arquitectura, paisaje, vuelo aéreo
- Integra anclas fotográficas de realismo como descripción cinematográfica natural: cámara y lente (ej. "shot on Sony A7III, 35mm lens"), "documentary style" si refuerza la atmósfera, "subtle handheld movement" si aplica
- Respeta la instrucción de sonido que viene en la orden
- copy_texto: español, máx 150 palabras, listo para publicar en redes
- hashtags: mezcla español/inglés, relevantes a bienes raíces Guatemala`;

function construirPromptVideo(orden, ctx) {
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
- Aspecto: ${(orden.formatos ?? ['16:9'])[0]} · Duración: ${orden.duracion_seg ?? 8} segundos
- Instrucciones extra: ${orden.instrucciones_extra ?? '(ninguna)'}
- Redes destino: ${(orden.redes ?? []).join(', ') || '(no especificadas)'}
- Sonido: ${orden.permitir_voces ? 'diálogo/voces IA permitidos' : 'ambient sound only, no dialogue, no speech'}

Genera el JSON de video.`;
}

// Fase 1: lanza generación de video.
// - Multi-clip: body.clips[] (del Prompt Studio) → crea contenido con clips jsonb inicializado,
//   no lanza Veo (el frontend orquesta clip a clip).
// - Single-clip: Claude genera prompt + lanza Veo directo.
router.post('/ordenes/:id/generar-video', async (req, res) => {
  const ordenId = Number(req.params.id);
  try {
    const { clips } = req.body;

    // Presencia de la clave 'clips' → rama multi-clip explícita
    if ('clips' in req.body) {
      if (!Array.isArray(clips) || clips.length === 0)
        return res.status(400).json({ error: 'clips debe ser un array no vacío' });
    }

    const { data: orden, error: ordErr } = await supabase
      .from('ordenes_contenido').select('*').eq('id', ordenId).single();
    if (ordErr) throw ordErr;

    const aspectRatio = (orden.formatos ?? ['16:9'])[0];

    // ── Multi-clip: frontend provee los prompts del guión (1 clip o más)
    if (Array.isArray(clips) && clips.length >= 1) {
      const clipsInicial = clips.map((c, i) => ({
        numero:      c.numero ?? (i + 1),
        duracion_seg: Number(c.duracion_seg) || 8,
        prompt:       c.prompt ?? '',
        operation:   null,
        video_url:   null,
        estado:      'pendiente'
      }));
      const durTotal = clipsInicial.reduce((s, c) => s + c.duracion_seg, 0);

      const { data: fila, error: insErr } = await supabase
        .from('contenido_generado')
        .insert({
          orden_id:     ordenId,
          copy_texto:   '',
          hashtags:     '',
          prompt_usado: clipsInicial.map(c => `Clip ${c.numero}: ${c.prompt}`).join('\n'),
          formato:      aspectRatio,
          duracion_seg: durTotal,
          clips:        clipsInicial,
          video_url:    null,
          imagen_url:   null,
          estado:       'pendiente'
        })
        .select().single();
      if (insErr) throw insErr;

      await supabase.from('ordenes_contenido').update({ estado: 'generando' }).eq('id', ordenId);
      return res.json({ contenido: fila });
    }

    // ── Single-clip: Claude genera prompt + lanza Veo
    const { leerContextoMarca } = require('../services/contentEngine');
    const ctx = await leerContextoMarca(orden.instrucciones_ids ?? []);

    const msg = await claude.messages.create(
      {
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system:     SYSTEM_VIDEO,
        messages:   [{ role: 'user', content: construirPromptVideo(orden, ctx) }]
      },
      { timeout: 20000 }
    );

    const raw = msg.content.find(b => b.type === 'text')?.text ?? '';
    let plan;
    try {
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      plan = JSON.parse(clean);
    } catch { throw new Error('Claude no devolvió JSON válido para el video'); }

    const { prompt_video, copy_texto, hashtags } = plan;
    if (!prompt_video?.trim()) throw new Error('Claude omitió prompt_video');

    const duracionSeg = orden.duracion_seg ?? 8;
    const calidad     = orden.video_calidad ?? 'fast';
    const { iniciarVideo } = require('../services/videoProvider');
    const operationName = await iniciarVideo(prompt_video, { aspectRatio, duracionSeg, calidad });

    const { data: fila, error: insErr } = await supabase
      .from('contenido_generado')
      .insert({
        orden_id:        ordenId,
        copy_texto:      copy_texto  ?? '',
        hashtags:        hashtags    ?? '',
        prompt_usado:    prompt_video,
        formato:         aspectRatio,
        duracion_seg:    duracionSeg,
        video_operation: operationName,
        video_url:       null,
        imagen_url:      null,
        estado:          'pendiente'
      })
      .select().single();
    if (insErr) throw insErr;

    await supabase.from('ordenes_contenido').update({ estado: 'generando' }).eq('id', ordenId);
    res.json({ contenido: fila });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Multi-clip Paso 2a: inicia Veo para un clip específico.
// imagenInicial opcional: { data: base64, mimeType: 'image/png' } — extraído en frontend.
// calidad NO se acepta del frontend: se lee desde ordenes_contenido vía contenido.orden_id
// para evitar mezcla de modelos si el usuario reanuda tras un refresh.
router.post('/contenido/:id/clips/:idx/iniciar', async (req, res) => {
  try {
    const { prompt, duracionSeg, aspectRatio, imagenInicial } = req.body;
    const idx = Number(req.params.idx);
    if (!prompt?.trim()) return res.status(400).json({ error: 'prompt es requerido' });

    // Leer calidad desde la orden (fuente de verdad en DB)
    const { data: cont, error: contErr } = await supabase
      .from('contenido_generado').select('orden_id').eq('id', req.params.id).single();
    if (contErr) throw contErr;
    const { data: orden, error: ordErr } = await supabase
      .from('ordenes_contenido').select('video_calidad').eq('id', cont.orden_id).single();
    if (ordErr) throw ordErr;
    const calidad = orden.video_calidad ?? 'fast';

    const { iniciarVideo } = require('../services/videoProvider');
    const operationName = await iniciarVideo(prompt, {
      aspectRatio:   aspectRatio  ?? '16:9',
      duracionSeg:   duracionSeg  ?? 8,
      imagenInicial: imagenInicial ?? null,
      calidad
    });

    const { data: updated, error } = await supabase.rpc('mkt_set_clip', {
      p_contenido_id: Number(req.params.id),
      p_clip_idx:     idx,
      p_patch:        { operation: operationName, estado: 'generando' }
    });
    if (error) throw error;

    res.json({ ok: true, operation: operationName, contenido: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Multi-clip Paso 2b: polling del estado de un clip; si listo, sube mp4 a Storage.
router.get('/contenido/:id/clips/:idx/estado', async (req, res) => {
  try {
    const idx = Number(req.params.idx);
    const { data: cont, error: contErr } = await supabase
      .from('contenido_generado')
      .select('clips, orden_id, formato')
      .eq('id', req.params.id).single();
    if (contErr) throw contErr;

    const clip = cont.clips?.[idx];
    if (!clip)          throw new Error(`Clip ${idx} no existe`);
    if (clip.video_url) return res.json({ listo: true, video_url: clip.video_url });
    if (!clip.operation) throw new Error(`Clip ${idx} sin operation`);

    const { consultarVideo } = require('../services/videoProvider');
    const result = await consultarVideo(clip.operation);
    if (!result.listo) return res.json({ listo: false });

    const slug = (cont.formato ?? '16-9').replace(':', '-');
    const path = `ordenes/${cont.orden_id}/clip-${idx}-${slug}-${Date.now()}.mp4`;
    const { error: upErr } = await supabase.storage
      .from('marketing').upload(path, result.videoBuffer, { contentType: 'video/mp4', upsert: false });
    if (upErr) throw upErr;

    const { data: { publicUrl } } = supabase.storage.from('marketing').getPublicUrl(path);

    const { data: updated, error: updErr } = await supabase.rpc('mkt_set_clip', {
      p_contenido_id: Number(req.params.id),
      p_clip_idx:     idx,
      p_patch:        { video_url: publicUrl, estado: 'listo' }
    });
    if (updErr) throw updErr;

    // Si todos los clips están listos → orden a 'generada'
    const todosListos = updated?.clips?.every(c => c.estado === 'listo');
    if (todosListos)
      await supabase.from('ordenes_contenido').update({ estado: 'generada' }).eq('id', cont.orden_id);

    res.json({ listo: true, video_url: publicUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fase 2 (polling desde frontend): consulta si el video está listo; si sí, lo sube a Storage.
router.get('/contenido/:id/estado-video', async (req, res) => {
  try {
    const { data: cont, error: contErr } = await supabase
      .from('contenido_generado')
      .select('video_operation, video_url, orden_id, formato, duracion_seg')
      .eq('id', req.params.id).single();
    if (contErr) throw contErr;
    if (!cont.video_operation) throw new Error('Sin video_operation para consultar');
    if (cont.video_url) return res.json({ listo: true, video_url: cont.video_url });

    const { consultarVideo } = require('../services/videoProvider');
    const result = await consultarVideo(cont.video_operation);

    if (!result.listo) return res.json({ listo: false });

    const slug = (cont.formato ?? '16-9').replace(':', '-');
    const path = `ordenes/${cont.orden_id}/video-${slug}-${Date.now()}.mp4`;
    const { error: upErr } = await supabase.storage
      .from('marketing').upload(path, result.videoBuffer, { contentType: 'video/mp4', upsert: false });
    if (upErr) throw upErr;

    const { data: { publicUrl } } = supabase.storage.from('marketing').getPublicUrl(path);

    const { error: updErr } = await supabase
      .from('contenido_generado')
      .update({ video_url: publicUrl, estado: 'pendiente' })
      .eq('id', req.params.id);
    if (updErr) throw updErr;

    await supabase.from('ordenes_contenido').update({ estado: 'generada' }).eq('id', cont.orden_id);
    res.json({ listo: true, video_url: publicUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Regenerar video con ajuste opcional de prompt.
router.post('/contenido/:id/regenerar-video', async (req, res) => {
  try {
    const { ajuste } = req.body;
    const { data: cont, error: contErr } = await supabase
      .from('contenido_generado')
      .select('prompt_usado, formato, duracion_seg, orden_id')
      .eq('id', req.params.id).single();
    if (contErr) throw contErr;

    const { data: orden, error: ordErr } = await supabase
      .from('ordenes_contenido').select('video_calidad').eq('id', cont.orden_id).single();
    if (ordErr) throw ordErr;

    const promptFinal = ajuste?.trim()
      ? `${cont.prompt_usado}. Additional adjustment: ${ajuste.trim()}`
      : cont.prompt_usado;

    const { iniciarVideo } = require('../services/videoProvider');
    const operationName = await iniciarVideo(promptFinal, {
      aspectRatio: cont.formato      ?? '16:9',
      duracionSeg: cont.duracion_seg ?? 8,
      calidad:     orden.video_calidad ?? 'fast'
    });

    const { data: updated, error: updErr } = await supabase
      .from('contenido_generado')
      .update({ video_operation: operationName, video_url: null, prompt_usado: promptFinal })
      .eq('id', req.params.id).select().single();
    if (updErr) throw updErr;

    await supabase.from('ordenes_contenido').update({ estado: 'generando' }).eq('id', cont.orden_id);
    res.json({ ok: true, contenido: updated });
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

    const { ajuste } = req.body;
    const paneles = cont.paneles ?? [];
    if (!paneles[idx]) throw new Error(`Panel ${idx} no existe`);
    const promptBase = paneles[idx].prompt_imagen;
    if (!promptBase?.trim()) throw new Error(`Panel ${idx} sin prompt_imagen`);
    const prompt = ajuste?.trim()
      ? `${promptBase}. Additional adjustment: ${ajuste.trim()}`
      : promptBase;

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

    const [{ data: identidad }, { data: orden }] = await Promise.all([
      supabase.from('marca_identidad').select('*').limit(1).maybeSingle(),
      supabase.from('ordenes_contenido')
        .select('logo_posicion, logo_tamano, logo_tamano_pct').eq('id', cont.orden_id).single()
    ]);

    const { renderComparativa2Col } = require('../services/templateEngine');
    const composed = await renderComparativa2Col(cont.paneles, {
      formato:       cont.formato         ?? '1:1',
      identidad:     identidad            ?? {},
      logoPosicion:  orden?.logo_posicion  ?? 'inferior-derecha',
      logoTamano:    orden?.logo_tamano    ?? 'mediano',
      logoTamanoPct: orden?.logo_tamano_pct ?? null
    });

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

// ── Referencias de Publicidad ─────────────────────────────────────────────────

const refUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Solo JPG, PNG o WEBP permitidos'), ok);
  }
});

router.get('/referencias', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('referencias_publicidad')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/referencias', (req, res) => {
  refUpload.single('imagen')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Imagen requerida' });
    const { descripcion, notas } = req.body;
    try {
      const ext  = req.file.mimetype === 'image/png' ? 'png'
                 : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
      const path = `referencias/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('marketing')
        .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('marketing').getPublicUrl(path);
      const { data, error: insErr } = await supabase
        .from('referencias_publicidad')
        .insert({ descripcion: descripcion ?? null, notas: notas ?? null, archivo_url: publicUrl })
        .select().single();
      if (insErr) throw insErr;
      res.status(201).json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

router.delete('/referencias/:id', async (req, res) => {
  try {
    const { data: ref, error: fetchErr } = await supabase
      .from('referencias_publicidad').select('archivo_url').eq('id', req.params.id).single();
    if (fetchErr) throw fetchErr;
    if (ref.archivo_url) {
      // URL: .../storage/v1/object/public/marketing/referencias/...
      const bucketPath = ref.archivo_url.split('/marketing/')[1];
      if (bucketPath) await supabase.storage.from('marketing').remove([bucketPath]);
    }
    const { error: delErr } = await supabase
      .from('referencias_publicidad').delete().eq('id', req.params.id);
    if (delErr) throw delErr;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const SYSTEM_ANALISIS_REF = `Eres director de arte de una agencia premium de marketing inmobiliario. Analiza la imagen publicitaria de referencia y devuelve ÚNICAMENTE JSON válido con esta estructura exacta:
{
  "estilo": "...",
  "paleta_colores": "...",
  "composicion": "...",
  "iluminacion": "...",
  "elementos_clave": "...",
  "prompt_sugerido": "..."
}
Reglas:
- estilo: 1-2 frases describiendo el estilo visual general
- paleta_colores: lista los colores dominantes con su rol (fondo, acento, texto, etc.)
- composicion: tipo de plano, punto focal, distribución de elementos, regla de tercios
- iluminacion: tipo de luz, dirección, contraste, hora del día si aplica
- elementos_clave: objetos, texturas, materiales o recursos visuales que definen la pieza
- prompt_sugerido: inglés, 80-150 palabras, prompt fotorrealista que replica el ESTILO de la referencia adaptado a inmuebles residenciales/comerciales en Guatemala; NO copies el contenido literal; sin texto en imagen, sin logos, sin personas identificables`;

router.post('/referencias/:id/analizar', async (req, res) => {
  try {
    const { data: ref, error: fetchErr } = await supabase
      .from('referencias_publicidad').select('archivo_url').eq('id', req.params.id).single();
    if (fetchErr) throw fetchErr;
    if (!ref.archivo_url) return res.status(400).json({ error: 'Sin imagen adjunta' });

    const imgResp = await fetch(ref.archivo_url);
    if (!imgResp.ok) throw new Error(`No se pudo descargar la imagen: ${imgResp.status}`);
    const rawBuffer = Buffer.from(await imgResp.arrayBuffer());

    // Redimensiona a máx 1568px del lado largo — Claude no gana nada con más resolución
    const resizedBuffer = await sharp(rawBuffer)
      .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const base64 = resizedBuffer.toString('base64');

    const msg = await claude.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      system:     SYSTEM_ANALISIS_REF,
      messages: [{
        role:    'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          { type: 'text',  text: 'Analiza esta imagen de referencia publicitaria y devuelve el JSON solicitado.' }
        ]
      }]
    });

    const rawText = msg.content.find(b => b.type === 'text')?.text ?? '';
    let analisis;
    try {
      const clean = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      analisis = JSON.parse(clean);
    } catch {
      throw new Error(`Claude no devolvió JSON válido: ${rawText.slice(0, 300)}`);
    }

    const { data, error: updErr } = await supabase
      .from('referencias_publicidad')
      .update({ analisis })
      .eq('id', req.params.id)
      .select().single();
    if (updErr) throw updErr;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
