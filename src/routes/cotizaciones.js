const express = require('express');
const router  = express.Router();
const supabase = require('../config/supabase');
const { sendWhatsAppMessage } = require('../utils/whatsapp');
const { cotCode, generarCotizacionPDF, generarCotizacionPDFFromHTML, subirPDFSupabase } = require('../utils/pdf');

// Generate PDF and persist documento_url — called after insert/update with content change
async function generarYGuardarPDF(cotId) {
  try {
    const { data: cot } = await supabase
      .from('cotizaciones')
      .select('*, clientes(nombre, empresa, email, telefono), leads(nombre, apellido, email, telefono)')
      .eq('id', cotId)
      .maybeSingle();
    if (!cot) return null;

    const pdfBuf  = await generarCotizacionPDF(cot);
    const filename = `${cotCode(cotId)}.pdf`;
    const url      = await subirPDFSupabase(pdfBuf, filename);

    await supabase.from('cotizaciones').update({ documento_url: url }).eq('id', cotId);
    return url;
  } catch (err) {
    console.error('[PDF] generarYGuardarPDF error:', err.message);
    return null;
  }
}

// GET /api/cotizaciones/codigo-siguiente
router.get('/codigo-siguiente', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cotizaciones')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);
    if (error) throw error;
    const nextId = (data?.[0]?.id || 0) + 1;
    const yr2 = String(new Date().getFullYear()).slice(-2);
    res.json({ next_id: nextId, codigo: `COT-${yr2}-${String(nextId).padStart(5, '0')}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/cotizaciones
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cotizaciones')
      .select('*, clientes(id, nombre, apellido, telefono, email), leads(id, nombre, apellido, telefono, email)')
      .order('id', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/cotizaciones
router.post('/', async (req, res) => {
  try {
    const {
      cliente_id, proyecto_id, lead_id,
      monto, anticipo, estado,
      tipo_servicio, canal, moneda,
      detalles_json,
      ubicacion_calle, ubicacion_zona, ubicacion_ciudad, ubicacion_completa,
    } = req.body;

    const insert = {
      cliente_id:         cliente_id || null,
      proyecto_id:        proyecto_id || null,
      lead_id:            lead_id || null,
      monto:              monto || 0,
      anticipo:           anticipo || null,
      estado:             estado || 'borrador',
      tipo_servicio:      tipo_servicio || null,
      canal:              canal || 'crm',
      moneda:             moneda || 'USD',
      detalles_json:      detalles_json || null,
      ubicacion_calle:    ubicacion_calle || null,
      ubicacion_zona:     ubicacion_zona || null,
      ubicacion_ciudad:   ubicacion_ciudad || null,
      ubicacion_completa: ubicacion_completa || null,
    };

    const { data: inserted, error } = await supabase
      .from('cotizaciones')
      .insert([insert])
      .select('id')
      .single();
    if (error) throw error;

    // Generate PDF and store URL (detalles_json present = has content)
    const documento_url = detalles_json ? await generarYGuardarPDF(inserted.id) : null;

    // Return full row
    const { data: full } = await supabase
      .from('cotizaciones')
      .select('*, clientes(id, nombre)')
      .eq('id', inserted.id)
      .single();

    res.status(201).json({ ...full, documento_url: documento_url || full?.documento_url || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/cotizaciones/:id
router.put('/:id', async (req, res) => {
  try {
    const {
      cliente_id, proyecto_id, lead_id,
      monto, anticipo, estado,
      tipo_servicio, canal, moneda,
      detalles_json,
      ubicacion_calle, ubicacion_zona, ubicacion_ciudad, ubicacion_completa,
    } = req.body;

    const update = { cliente_id, proyecto_id, monto, anticipo, estado };
    if (lead_id            !== undefined) update.lead_id            = lead_id;
    if (tipo_servicio      !== undefined) update.tipo_servicio      = tipo_servicio;
    if (canal              !== undefined) update.canal              = canal;
    if (moneda             !== undefined) update.moneda             = moneda;
    if (detalles_json      !== undefined) update.detalles_json      = detalles_json;
    if (ubicacion_calle    !== undefined) update.ubicacion_calle    = ubicacion_calle;
    if (ubicacion_zona     !== undefined) update.ubicacion_zona     = ubicacion_zona;
    if (ubicacion_ciudad   !== undefined) update.ubicacion_ciudad   = ubicacion_ciudad;
    if (ubicacion_completa !== undefined) update.ubicacion_completa = ubicacion_completa;

    const { data, error } = await supabase
      .from('cotizaciones')
      .update(update)
      .eq('id', req.params.id)
      .select('*, clientes(telefono)');
    if (error) throw error;
    const cot = data[0];

    res.json(cot);

    // Auto-send via originating channel when approved from CRM
    const APPROVED = ['aprobada', 'confirmada'];
    if (estado && APPROVED.includes(estado) && cot.canal === 'whatsapp') {
      const tel = cot.clientes?.telefono;
      if (tel) {
        const codigo = cotCode(cot.id);
        const link   = `${process.env.APP_URL || 'https://www.virtualestategt.com'}/portal/cotizacion/${cot.id}`;
        sendWhatsAppMessage(tel, `Hola 👋 Tu cotización *${codigo}* fue aprobada.\n\nRevisa y confirma aquí:\n${link}`).catch(() => {});
        supabase.from('cotizaciones').update({ estado_envio: 'enviado', metodo_envio_manual: cot.canal, fecha_envio_manual: new Date().toISOString() }).eq('id', cot.id).then(() => {}).catch(() => {});
      }
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/cotizaciones/:id
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('cotizaciones').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Cotización eliminada' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/cotizaciones/:id/generar-pdf
// Receives the browser-rendered machote HTML and generates a PDF from it.
// This guarantees the PDF is pixel-identical to the admin preview.
router.post('/:id/generar-pdf', async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ error: 'html is required' });
  const cotId = Number(req.params.id);
  // ── DEBUG PASO 3 ────────────────────────────────────────────────────────────
  console.log('[DEBUG PASO 3] HTML recibido del frontend');
  console.log('  Tamaño total:', html.length, 'chars');
  console.log('  ¿Incluye <style>?', html.includes('<style>'));
  console.log('  ¿Incluye .pagina?', html.includes('.pagina'));
  console.log('  ¿Incluye @media print?', html.includes('@media print'));
  console.log('  Primeras 2000 chars:\n', html.substring(0, 2000));
  // ────────────────────────────────────────────────────────────────────────────
  try {
    const pdfBuf       = await generarCotizacionPDFFromHTML(html);
    const filename     = `${cotCode(cotId)}.pdf`;
    const documento_url = await subirPDFSupabase(pdfBuf, filename);
    await supabase.from('cotizaciones').update({ documento_url }).eq('id', cotId);
    res.json({ ok: true, documento_url });
  } catch (e) {
    console.error('[generar-pdf] endpoint error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
