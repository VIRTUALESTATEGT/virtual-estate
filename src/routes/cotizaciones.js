const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { sendWhatsAppMessage } = require('../utils/whatsapp');

// GET /api/cotizaciones/codigo-siguiente — preview next COT code
router.get('/codigo-siguiente', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cotizaciones')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);
    if (error) throw error;
    const nextId = (data?.[0]?.id || 0) + 1;
    const year = new Date().getFullYear();
    const yr2 = String(year).slice(-2);
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
      .select('*, clientes(id, nombre)')
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

    const { data, error } = await supabase
      .from('cotizaciones')
      .insert([insert])
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
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
    const SEND_CANALES = ['whatsapp'];
    const APPROVED = ['aprobada', 'confirmada'];
    if (estado && APPROVED.includes(estado) && SEND_CANALES.includes(cot.canal)) {
      const tel = cot.clientes?.telefono;
      if (tel) {
        const yr2 = String(new Date().getFullYear()).slice(-2);
        const codigo = `COT-${yr2}-${String(cot.id).padStart(5, '0')}`;
        const link = `${process.env.APP_URL || 'https://www.virtualestategt.com'}/portal/cotizacion/${cot.id}`;
        const msg = `Hola 👋 Tu cotización *${codigo}* fue aprobada.\n\nRevisa y confirma aquí:\n${link}`;
        sendWhatsAppMessage(tel, msg).catch(() => {});
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

module.exports = router;
