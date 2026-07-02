// src/services/contentEngine.js
// Motor de generación de contenido de marketing.
// Orquesta: contexto de marca → Claude (copy + prompt) → Gemini (imagen) → Storage → DB.

const Anthropic = require('@anthropic-ai/sdk');
const supabase  = require('../config/supabase');
const { generarImagen } = require('./imageProvider');

const BUCKET = 'marketing';

const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

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
  if (error) {
    throw new Error(
      `Bucket '${BUCKET}' no existe — créalo en Supabase Dashboard › Storage › New bucket (nombre: marketing, público: ON)`
    );
  }
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
    generales:    (genRes.data ?? []).map(i => i.instruccion),
    individuales: (indRes.data ?? []).map(i => i.instruccion)
  };
}

function construirPrompt(orden, ctx) {
  const id  = ctx.identidad;
  const col = id?.colores     ?? {};
  const tip = id?.tipografias ?? {};

  return `IDENTIDAD DE MARCA:
- Nombre: ${id?.nombre_negocio     ?? 'Virtual Estate GT'}
- Enfoque: ${id?.enfoque_negocio   ?? ''}
- Tono: ${id?.tono_comunicacion    ?? ''}
- Público: ${id?.publico_objetivo  ?? ''}
- Colores: primario ${col.primario ?? '#2D5016'}, secundario ${col.secundario ?? '#0F3026'}, acento ${col.acento ?? '#B8860B'}
- Tipografías: ${tip.principal ?? 'Montserrat'} / ${tip.secundaria ?? 'Raleway'}

INSTRUCCIONES GENERALES:
${ctx.generales.length ? ctx.generales.map(i => `• ${i}`).join('\n') : '(ninguna)'}

INSTRUCCIONES ESPECÍFICAS PARA ESTA ORDEN:
${ctx.individuales.length ? ctx.individuales.map(i => `• ${i}`).join('\n') : '(ninguna)'}

ORDEN DE CONTENIDO:
- Título: ${orden.titulo ?? ''}
- Descripción: ${orden.descripcion ?? ''}
- Tipo: ${orden.tipo_contenido ?? 'imagen'}
- Redes destino: ${(orden.redes ?? []).join(', ') || '(no especificadas)'}
- Instrucciones extra: ${orden.instrucciones_extra ?? '(ninguna)'}

Genera el JSON de contenido.`;
}

// ── Motor principal ───────────────────────────────────────────────────────────

async function ejecutar(ordenId) {
  // Marcar como 'generando' antes de cualquier operación lenta
  await supabase.from('ordenes_contenido').update({ estado: 'generando' }).eq('id', ordenId);

  try {
    // 1. Verificar bucket (falla rápido si no existe)
    await verificarBucket();

    // 2. Leer orden
    const { data: orden, error: ordenErr } = await supabase
      .from('ordenes_contenido').select('*').eq('id', ordenId).single();
    if (ordenErr) throw ordenErr;

    // 3. Contexto de marca e instrucciones
    const ctx = await leerContextoMarca(orden.instrucciones_ids ?? []);

    // 4. Claude → copy + prompt de imagen
    const msg = await claude.messages.create(
      {
        model:     'claude-sonnet-4-6',
        max_tokens: 1024,
        system:    SYSTEM_PROMPT,
        messages:  [{ role: 'user', content: construirPrompt(orden, ctx) }]
      },
      { timeout: 20000 }
    );

    const rawText = msg.content.find(b => b.type === 'text')?.text ?? '';
    let contenido;
    try {
      // Tolerar JSON envuelto en ```json ... ```
      const clean = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      contenido = JSON.parse(clean);
    } catch {
      throw new Error(`Claude no devolvió JSON válido: ${rawText.slice(0, 300)}`);
    }

    const { prompt_imagen, copy_texto, hashtags } = contenido;
    if (!prompt_imagen?.trim()) throw new Error('Claude omitió prompt_imagen');

    // 5. Generar imagen (solo si tipo != 'texto')
    let imagenUrl = null;
    if (orden.tipo_contenido !== 'texto') {
      const { buffer, mimeType } = await generarImagen(prompt_imagen);

      const ext      = mimeType === 'image/jpeg' ? 'jpg' : 'png';
      const filePath = `ordenes/${ordenId}/${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, buffer, { contentType: mimeType, upsert: false });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
      imagenUrl = urlData.publicUrl;
    }

    // 6. Guardar contenido_generado
    const { data: fila, error: insErr } = await supabase
      .from('contenido_generado')
      .insert({
        orden_id:     ordenId,
        copy_texto:   copy_texto   ?? '',
        hashtags:     hashtags     ?? '',
        imagen_url:   imagenUrl,
        prompt_usado: prompt_imagen,
        estado:       'pendiente'
      })
      .select()
      .single();
    if (insErr) throw insErr;

    // 7. Marcar orden como 'generada'
    await supabase.from('ordenes_contenido').update({ estado: 'generada' }).eq('id', ordenId);

    return fila;

  } catch (e) {
    console.error('[contentEngine] orden', ordenId, '→ ERROR:', e.message);
    await supabase.from('ordenes_contenido').update({ estado: 'error' }).eq('id', ordenId);
    throw e;
  }
}

module.exports = { ejecutar };
