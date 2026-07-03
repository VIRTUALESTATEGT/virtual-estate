// src/services/contentEngine.js
// Motor de generación de contenido de marketing.
// Orquesta: contexto de marca → Claude → Gemini → overlay → Storage → DB.

const Anthropic  = require('@anthropic-ai/sdk');
const supabase   = require('../config/supabase');
const { generarImagen }   = require('./imageProvider');
const { aplicarOverlay }  = require('./brandOverlay');

const BUCKET = 'marketing';
const claude  = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SYSTEM_PROMPT = `Eres director creativo de una agencia de marketing premium especializada en bienes raíces en Guatemala. Creas contenido visual y textual de alta calidad para redes sociales.

Recibirás el perfil de marca y una orden de contenido. Responde ÚNICAMENTE con JSON válido. Sin markdown, sin bloques de código, sin texto fuera del JSON.

Estructura exacta requerida:
{
  "prompt_imagen": "...",
  "copy_texto": "...",
  "hashtags": "..."
}

Reglas:
- prompt_imagen: inglés, 80-150 palabras, estilo fotorrealista editorial, sin texto visible, sin logos, sin marcas comerciales, sin personas identificables, composición y luz de alta calidad
- copy_texto: español, tono fiel a la marca, máximo 200 palabras, listo para publicar
- hashtags: mezcla español/inglés, relevantes a bienes raíces Guatemala y al tema, separados por espacio`;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function verificarBucket() {
  const { error } = await supabase.storage.getBucket(BUCKET);
  if (error) throw new Error(
    `Bucket '${BUCKET}' no existe — créalo en Supabase Dashboard › Storage › New bucket (nombre: marketing, público: ON)`
  );
}

async function leerContextoMarca(instruccionesIds) {
  const [identRes, genRes, indRes] = await Promise.all([
    supabase.from('marca_identidad').select('*').limit(1).maybeSingle(),
    supabase.from('marketing_instrucciones')
      .select('instruccion').eq('tipo', 'general').eq('activa', true),
    instruccionesIds?.length
      ? supabase.from('marketing_instrucciones')
          .select('instruccion').in('id', instruccionesIds).eq('activa', true)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (identRes.error) throw identRes.error;
  if (genRes.error)   throw genRes.error;
  if (indRes.error)   throw indRes.error;
  return {
    identidad:    identRes.data ?? {},
    generales:    (genRes.data  ?? []).map(i => i.instruccion),
    individuales: (indRes.data  ?? []).map(i => i.instruccion)
  };
}

function construirPrompt(orden, ctx) {
  const id  = ctx.identidad;
  const col = id?.colores     ?? {};
  const tip = id?.tipografias ?? {};
  return `IDENTIDAD DE MARCA:
- Nombre: ${id?.nombre_negocio    ?? 'Virtual Estate GT'}
- Enfoque: ${id?.enfoque_negocio  ?? ''}
- Tono: ${id?.tono_comunicacion   ?? ''}
- Público: ${id?.publico_objetivo ?? ''}
- Colores: primario ${col.primario ?? '#2D5016'}, secundario ${col.secundario ?? '#0F3026'}, acento ${col.acento ?? '#B8860B'}
- Tipografías: ${tip.principal ?? 'Montserrat'} / ${tip.secundaria ?? 'Raleway'}

INSTRUCCIONES GENERALES:
${ctx.generales.length    ? ctx.generales.map(i    => `• ${i}`).join('\n') : '(ninguna)'}

INSTRUCCIONES ESPECÍFICAS PARA ESTA ORDEN:
${ctx.individuales.length ? ctx.individuales.map(i => `• ${i}`).join('\n') : '(ninguna)'}

ORDEN DE CONTENIDO:
- Título: ${orden.titulo ?? ''}
- Descripción: ${orden.descripcion ?? ''}
- Tipo: ${orden.tipo_contenido ?? 'imagen'}
- Formatos: ${(orden.formatos ?? ['1:1']).join(', ')}
- Redes destino: ${(orden.redes ?? []).join(', ') || '(no especificadas)'}
- Instrucciones extra: ${orden.instrucciones_extra ?? '(ninguna)'}

Genera el JSON de contenido.`;
}

// Genera imagen + overlay + sube ambas versiones a Storage.
// Modo degradado: si algo falla devuelve { imagenUrl: null, error: msg }
async function generarYSubirImagen(prompt, formato, ordenId, identidad, logoPosicion = 'inferior-derecha', logoTamano = 'mediano') {
  try {
    const { buffer, mimeType }         = await generarImagen(prompt, { formato });
    const { overlayBuffer, originalBuffer } = await aplicarOverlay(buffer, { formato, identidad, logoPosicion, logoTamano });

    const slug = formato.replace(':', '-');
    const ts   = Date.now();
    const pathOrig    = `ordenes/${ordenId}/original-${slug}-${ts}.png`;
    const pathOverlay = `ordenes/${ordenId}/overlay-${slug}-${ts}.png`;

    const [upOrig, upOver] = await Promise.all([
      supabase.storage.from(BUCKET).upload(pathOrig,    originalBuffer, { contentType: 'image/png', upsert: false }),
      supabase.storage.from(BUCKET).upload(pathOverlay, overlayBuffer,  { contentType: 'image/png', upsert: false })
    ]);
    if (upOrig.error) throw upOrig.error;
    if (upOver.error) throw upOver.error;

    const { data: u1 } = supabase.storage.from(BUCKET).getPublicUrl(pathOrig);
    const { data: u2 } = supabase.storage.from(BUCKET).getPublicUrl(pathOverlay);
    return { imagenUrl: u2.publicUrl, imagenOriginalUrl: u1.publicUrl, imagenError: null };
  } catch (e) {
    console.error('[contentEngine] imagen fallida (modo degradado):', e.message);
    return { imagenUrl: null, imagenOriginalUrl: null, imagenError: e.message };
  }
}

// ── Motor principal — llama Claude + genera imagen para el primer formato ─────

async function ejecutar(ordenId, formato = '1:1') {
  await supabase.from('ordenes_contenido').update({ estado: 'generando' }).eq('id', ordenId);

  try {
    await verificarBucket();

    const { data: orden, error: ordenErr } = await supabase
      .from('ordenes_contenido').select('*').eq('id', ordenId).single();
    if (ordenErr) throw ordenErr;

    const ctx = await leerContextoMarca(orden.instrucciones_ids ?? []);

    // Claude → copy + prompt
    const msg = await claude.messages.create(
      {
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: construirPrompt(orden, ctx) }]
      },
      { timeout: 20000 }
    );

    const rawText = msg.content.find(b => b.type === 'text')?.text ?? '';
    let contenido;
    try {
      const clean = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      contenido = JSON.parse(clean);
    } catch {
      throw new Error(`Claude no devolvió JSON válido: ${rawText.slice(0, 300)}`);
    }

    const { prompt_imagen, copy_texto, hashtags } = contenido;
    if (!prompt_imagen?.trim()) throw new Error('Claude omitió prompt_imagen');

    // Imagen + overlay (modo degradado si falla)
    let imagenUrl = null, imagenOriginalUrl = null, imagenError = null;
    if (orden.tipo_contenido !== 'texto') {
      ({ imagenUrl, imagenOriginalUrl, imagenError } =
        await generarYSubirImagen(prompt_imagen, formato, ordenId, ctx.identidad,
          orden.logo_posicion ?? 'inferior-derecha', orden.logo_tamano ?? 'mediano'));
    }

    const { data: fila, error: insErr } = await supabase
      .from('contenido_generado')
      .insert({
        orden_id:           ordenId,
        copy_texto:         copy_texto  ?? '',
        hashtags:           hashtags    ?? '',
        imagen_url:         imagenUrl,
        imagen_original_url: imagenOriginalUrl,
        prompt_usado:       prompt_imagen,
        formato,
        estado:             'pendiente'
      })
      .select().single();
    if (insErr) throw insErr;

    await supabase.from('ordenes_contenido').update({ estado: 'generada' }).eq('id', ordenId);
    return { ...fila, _imagen_error: imagenError };

  } catch (e) {
    console.error('[contentEngine] orden', ordenId, '→ ERROR:', e.message);
    await supabase.from('ordenes_contenido').update({ estado: 'error' }).eq('id', ordenId);
    throw e;
  }
}

// ── Formato adicional — lee prompt_usado del contenido base, solo genera imagen ─

async function ejecutarFormato(contenidoBaseId, formato) {
  const { data: base, error: baseErr } = await supabase
    .from('contenido_generado').select('*').eq('id', contenidoBaseId).single();
  if (baseErr) throw baseErr;
  if (!base?.prompt_usado?.trim())
    throw new Error('Sin prompt_usado para generar formato adicional');

  const [{ data: identidad }, { data: orden }] = await Promise.all([
    supabase.from('marca_identidad').select('*').limit(1).maybeSingle(),
    supabase.from('ordenes_contenido').select('logo_posicion, logo_tamano').eq('id', base.orden_id).single()
  ]);

  const logoPosicion = orden?.logo_posicion ?? 'inferior-derecha';
  const logoTamano   = orden?.logo_tamano   ?? 'mediano';

  const { imagenUrl, imagenOriginalUrl, imagenError } =
    await generarYSubirImagen(base.prompt_usado, formato, base.orden_id, identidad, logoPosicion, logoTamano);

  const { data: fila, error: insErr } = await supabase
    .from('contenido_generado')
    .insert({
      orden_id:            base.orden_id,
      copy_texto:          base.copy_texto,
      hashtags:            base.hashtags,
      imagen_url:          imagenUrl,
      imagen_original_url: imagenOriginalUrl,
      prompt_usado:        base.prompt_usado,
      formato,
      estado:              'pendiente'
    })
    .select().single();
  if (insErr) throw insErr;

  return { ...fila, _imagen_error: imagenError };
}

// ── Regenerar — nueva imagen con prompt ajustado ──────────────────────────────

async function regenerar(contenidoId, { ajuste = '', logoPosicion, logoTamano, formato } = {}) {
  const { data: cont, error } = await supabase
    .from('contenido_generado').select('*').eq('id', contenidoId).single();
  if (error) throw error;

  const promptBase     = cont.prompt_usado ?? '';
  const promptAjustado = ajuste?.trim()
    ? `${promptBase}. Additional adjustment: ${ajuste.trim()}`
    : promptBase;

  const [{ data: identidad }, { data: orden }] = await Promise.all([
    supabase.from('marca_identidad').select('*').limit(1).maybeSingle(),
    supabase.from('ordenes_contenido').select('logo_posicion, logo_tamano').eq('id', cont.orden_id).single()
  ]);

  // Overrides del body tienen prioridad; si no vienen, se usan los de la orden
  const formatoFinal     = formato      ?? cont.formato             ?? '1:1';
  const logoPosicionFinal = logoPosicion ?? orden?.logo_posicion    ?? 'inferior-derecha';
  const logoTamanoFinal   = logoTamano   ?? orden?.logo_tamano      ?? 'mediano';

  const { imagenUrl, imagenOriginalUrl, imagenError } =
    await generarYSubirImagen(promptAjustado, formatoFinal, cont.orden_id, identidad, logoPosicionFinal, logoTamanoFinal);

  const { data: updated, error: updErr } = await supabase
    .from('contenido_generado')
    .update({
      imagen_url:          imagenUrl,
      imagen_original_url: imagenOriginalUrl,
      prompt_usado:        promptAjustado,
      formato:             formatoFinal
    })
    .eq('id', contenidoId)
    .select().single();
  if (updErr) throw updErr;

  return { ...updated, _imagen_error: imagenError };
}

module.exports = { ejecutar, ejecutarFormato, regenerar };
