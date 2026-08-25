const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');
const { notifyAdmin, sendWhatsAppMessage } = require('../utils/whatsapp');
const { TASA_GTQ } = require('../config/constants');

// calcularMonto: resuelve precio desde precios_servicios (activo=true AND cotizable_auto=true).
// Devuelve null cuando el precio no puede calcularse — el caller debe escalar sin crear cotización.
// NOTA: la lógica de cálculo replica public/admin.html:calcularPrecioPaquete.
// Frontend y backend no pueden compartir un módulo (browser vs Node, sin bundler).
// Si cambias la lógica aquí, actualizá también admin.html:calcularPrecioPaquete.
async function calcularMonto(tipo_servicio, m2 = 0) {
  try {
    const m2Num = Number(m2) || 0;

    // Mapeo enum del tool → código de precios_servicios.
    // 'tour_virtual' es especial: se resuelve buscando por categoría + rango de m².
    const ENUM_A_CODIGO = {
      'paquete_basico':         '2.1',
      'paquete_intermedio':     '2.2',
      'paquete_premium':        '2.3',
      'asbuilt_remodelacion':   '5.1',
      'asbuilt_levantamiento':  '5.2',
      'asbuilt_avaluo':         '5.3',
      'fotografia_360':         '3.11',
      'video_recorrido':        '3.10',
      'gemelo_digital':         '3.6',
      'fotografia_profesional': '4.1',
      'video_drone':            '4.2',
      // 'construccion' no tiene fila en DB — devuelve null → _sinPrecio → notifyAdmin
    };

    if (tipo_servicio === 'tour_virtual') {
      if (m2Num <= 0) {
        console.log('[COT-PRECIO] tour_virtual: m2 requerido pero es 0');
        return null;
      }
      const { data: tiers, error: errT } = await supabase
        .from('precios_servicios')
        .select('*')
        .eq('categoria', 'Tours Virtuales')
        .eq('tipo_precio', 'por_m2')
        .eq('activo', true)
        .eq('cotizable_auto', true);
      if (errT || !tiers?.length) {
        console.log('[COT-PRECIO] tour_virtual: no se encontraron tramos activos');
        return null;
      }
      const tier = tiers.find(t => {
        const minR = Number(t.rango_m2_min) || 0;
        const maxR = t.rango_m2_max ? Number(t.rango_m2_max) : null;
        return maxR !== null ? (m2Num >= minR && m2Num <= maxR) : (m2Num >= minR);
      });
      if (!tier) {
        console.log(`[COT-PRECIO] tour_virtual: ningún tramo cubre m2=${m2Num}`);
        return null;
      }
      const raw = m2Num * (Number(tier.precio_por_m2) || 0);
      const sub = (Number(tier.precio_minimo) || 0) > 0 ? Math.max(Number(tier.precio_minimo), raw) : raw;
      const subR = Math.round(sub * 100) / 100;
      console.log(`[COT-PRECIO] tour_virtual | tramo=${tier.codigo} id=${tier.id} | ${m2Num}m² × $${tier.precio_por_m2} = $${raw.toFixed(2)} → subtotal=$${subR}`);
      return subR;
    }

    const codigoBuscar = ENUM_A_CODIGO[tipo_servicio] ?? tipo_servicio;
    const { data: precio, error } = await supabase
      .from('precios_servicios')
      .select('*')
      .eq('codigo', codigoBuscar)
      .eq('activo', true)
      .eq('cotizable_auto', true)
      .maybeSingle();

    if (error) {
      console.error('[COT-PRECIO] Error consultando precios_servicios:', error.message);
      return null;
    }
    if (!precio) {
      console.log(`[COT-PRECIO] Sin fila para codigo="${codigoBuscar}" (no existe, inactivo o no cotizable_auto)`);
      return null;
    }


    if (precio.tipo_precio === 'fijo') {
      const sub = Number(precio.precio_minimo) || 0;
      console.log(`[COT-PRECIO] fijo | id=${precio.id} codigo=${precio.codigo} | subtotal=$${sub}`);
      return sub;
    }

    if (precio.tipo_precio === 'por_m2') {
      if (m2Num <= 0) {
        console.log(`[COT-PRECIO] por_m2: m2 requerido pero es 0 | id=${precio.id} codigo=${precio.codigo}`);
        return null;
      }
      const minR = Number(precio.rango_m2_min) || 0;
      const maxR = precio.rango_m2_max ? Number(precio.rango_m2_max) : null;
      if (maxR !== null && (m2Num < minR || m2Num > maxR)) {
        console.log(`[COT-PRECIO] por_m2 m2=${m2Num} fuera de rango [${minR}–${maxR}] | id=${precio.id} codigo=${precio.codigo}`);
        return null;
      }
      if (maxR === null && m2Num < minR) {
        console.log(`[COT-PRECIO] por_m2 m2=${m2Num} < rango_min=${minR} | id=${precio.id} codigo=${precio.codigo}`);
        return null;
      }
      const raw = m2Num * (Number(precio.precio_por_m2) || 0);
      const sub = (Number(precio.precio_minimo) || 0) > 0
        ? Math.max(Number(precio.precio_minimo), raw)
        : raw;
      const subR = Math.round(sub * 100) / 100;
      console.log(`[COT-PRECIO] por_m2 | id=${precio.id} codigo=${precio.codigo} | ${m2Num}m² × $${precio.precio_por_m2} = $${raw.toFixed(2)} → subtotal=$${subR}`);
      return subR;
    }

    if (precio.tipo_precio === 'paquete') {
      const ids = Array.isArray(precio.componentes_ids) ? precio.componentes_ids : [];
      if (!ids.length) {
        console.log(`[COT-PRECIO] paquete sin componentes_ids | id=${precio.id} codigo=${precio.codigo}`);
        return null;
      }

      const { data: comps, error: errC } = await supabase
        .from('precios_servicios')
        .select('*')
        .in('id', ids)
        .eq('activo', true);
      if (errC) {
        console.error('[COT-PRECIO] Error cargando componentes de paquete:', errC.message);
        return null;
      }

      // Paquetes con componentes por_m2 requieren m2 (tours/paquetes inmobiliarios).
      // Paquetes todo-fijo (combos AS-BUILT Remodelación/Avalúo) no lo necesitan.
      const tieneM2 = (comps || []).some(c =>
        ids.some(cid => Number(c.id) === Number(cid)) && c.tipo_precio === 'por_m2'
      );
      if (tieneM2 && m2Num <= 0) {
        console.log(`[COT-PRECIO] paquete: componentes por_m2 requieren m2 | id=${precio.id} codigo=${precio.codigo}`);
        return null;
      }

      const desglose = [];
      let suma = 0;
      for (const cid of ids) {
        const comp = (comps || []).find(c => Number(c.id) === Number(cid));
        if (!comp) continue;
        if (comp.tipo_precio === 'por_m2') {
          const minR = Number(comp.rango_m2_min) || 0;
          const maxR = comp.rango_m2_max ? Number(comp.rango_m2_max) : null;
          const enRango = maxR !== null
            ? (m2Num >= minR && m2Num <= maxR)
            : (m2Num >= minR);
          if (enRango) {
            const raw = m2Num * (Number(comp.precio_por_m2) || 0);
            const sub = (Number(comp.precio_minimo) || 0) > 0
              ? Math.max(Number(comp.precio_minimo), raw)
              : raw;
            desglose.push({ codigo: comp.codigo, servicio: comp.servicio, sub: Math.round(sub * 100) / 100 });
            suma += sub;
          }
          // else: otro tramo del mismo servicio cubre este m² (tour virtual)
        } else if (comp.tipo_precio === 'fijo') {
          const sub = Number(comp.precio_minimo) || Number(comp.precio_fijo) || 0;
          desglose.push({ codigo: comp.codigo, servicio: comp.servicio, sub });
          suma += sub;
        }
        // cotizar / paquete / rango_m2 dentro de componentes: omitir
      }

      if (!desglose.length) {
        console.log(`[COT-PRECIO] paquete sin componentes válidos para m2=${m2Num} | id=${precio.id} codigo=${precio.codigo}`);
        return null;
      }

      const desc    = Number(precio.descuento_paquete_pct) || 0;
      const conDesc = suma * (1 - desc / 100);
      const piso    = Number(precio.precio_minimo) || 0;
      const total   = Math.round(Math.max(piso, conDesc) * 100) / 100;
      const desgloseTxt = desglose.map(d => `${d.codigo}=$${d.sub}`).join(' + ');
      console.log(
        `[COT-PRECIO] paquete | id=${precio.id} codigo=${precio.codigo} | ` +
        `${desgloseTxt} | suma=$${suma.toFixed(2)} −${desc}% → $${conDesc.toFixed(2)} ≥ piso $${piso} → total=$${total}`
      );
      return total;
    }

    // cotizar / rango_m2 — no aptos para auto-cotización
    console.log(`[COT-PRECIO] tipo_precio="${precio.tipo_precio}" no apto para auto-cotización | id=${precio.id}`);
    return null;

  } catch (e) {
    console.error('[COT-PRECIO] Error inesperado en calcularMonto:', e.message);
    return null;
  }
}

// GET /api/cotizacion/precios — public: list all active services + prices
router.get('/precios', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('precios_servicios')
      .select('*')
      .order('orden', { nullsFirst: false })
      .order('id');
    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error('[precios] Error cargando precios_servicios:', e.message);
    res.json([]);
  }
});

// PUT /api/cotizacion/precios/:id — admin: update a service
router.put('/precios/:id', async (req, res) => {
  try {
    const {
      codigo, categoria, servicio, descripcion, tipo_precio,
      precio_fijo, precio_por_m2, rango_m2_min, rango_m2_max,
      precio_en_rango, precio_minimo, notas, activo, orden, cotizable_auto
    } = req.body;
    const update = {
      updated_at: new Date().toISOString(),
    };
    if (codigo      !== undefined) update.codigo       = codigo;
    if (categoria   !== undefined) update.categoria    = categoria;
    if (servicio    !== undefined) update.servicio      = servicio;
    if (descripcion !== undefined) update.descripcion  = descripcion;
    if (tipo_precio !== undefined) update.tipo_precio  = tipo_precio;
    if (precio_fijo       !== undefined) update.precio_fijo       = precio_fijo ? Number(precio_fijo) : null;
    if (precio_por_m2     !== undefined) update.precio_por_m2     = precio_por_m2 ? Number(precio_por_m2) : null;
    if (rango_m2_min      !== undefined) update.rango_m2_min      = rango_m2_min ? Number(rango_m2_min) : null;
    if (rango_m2_max      !== undefined) update.rango_m2_max      = rango_m2_max ? Number(rango_m2_max) : null;
    if (precio_en_rango   !== undefined) update.precio_en_rango   = precio_en_rango ? Number(precio_en_rango) : null;
    if (precio_minimo     !== undefined) update.precio_minimo     = precio_minimo ? Number(precio_minimo) : null;
    if (notas       !== undefined) update.notas        = notas;
    if (activo      !== undefined) update.activo       = activo !== false && activo !== 'false';
    if (orden       !== undefined) update.orden        = orden ? Number(orden) : null;
    if (cotizable_auto !== undefined) update.cotizable_auto = cotizable_auto === true || cotizable_auto === 'true';

    const { data, error } = await supabase
      .from('precios_servicios')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/cotizacion/precios — admin: add new service
router.post('/precios', async (req, res) => {
  try {
    const {
      codigo, categoria, servicio, descripcion, tipo_precio,
      precio_fijo, precio_por_m2, rango_m2_min, rango_m2_max,
      precio_en_rango, precio_minimo, notas, orden, cotizable_auto
    } = req.body;
    if (!codigo || !servicio) return res.status(400).json({ error: 'codigo y servicio son requeridos.' });
    const { data, error } = await supabase
      .from('precios_servicios')
      .insert([{
        codigo: codigo.trim().toLowerCase().replace(/\s+/g, '_'),
        categoria: categoria || 'General',
        servicio,
        descripcion: descripcion || '',
        tipo_precio: tipo_precio || 'fijo',
        precio_fijo:     precio_fijo     ? Number(precio_fijo)     : null,
        precio_por_m2:   precio_por_m2   ? Number(precio_por_m2)   : null,
        rango_m2_min:    rango_m2_min    ? Number(rango_m2_min)    : null,
        rango_m2_max:    rango_m2_max    ? Number(rango_m2_max)    : null,
        precio_en_rango: precio_en_rango ? Number(precio_en_rango) : null,
        precio_minimo:   precio_minimo   ? Number(precio_minimo)   : null,
        notas: notas || null,
        activo: true,
        cotizable_auto: cotizable_auto === true || cotizable_auto === 'true',
        orden: orden ? Number(orden) : null,
      }])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/cotizacion/precios/:id — admin: soft-delete (activo=false)
router.delete('/precios/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('precios_servicios')
      .update({ activo: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Servicio desactivado.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Core business logic — shared by the HTTP endpoint and the WA agent tool.
// Returns { _zonaRoja: true } when the zone is blocked (caller maps to HTTP 202).
// Returns the result object on success, or throws on DB error.
async function crearCotizacionBorradorCore({
  tipo_servicio, m2, zona, nombre, email, telefono,
  plazo, canal, detalles_adicionales, conversacion_id,
  moneda = 'GTQ',
}) {
  const { data: zonaData } = await supabase
    .from('zonas_seguridad')
    .select('*')
    .ilike('zona', `%${zona || ''}%`)
    .maybeSingle();

  const nivelRiesgo = zonaData?.nivel_riesgo || 'verde';

  if (nivelRiesgo === 'rojo' && !zonaData?.aceptar_trabajos) {
    await notifyAdmin(
      `⚠️ *ZONA ROJA DETECTADA*\n` +
      `Cliente: ${nombre} (${email})\n` +
      `Zona: ${zona}\n` +
      `Servicio: ${tipo_servicio}\n` +
      `Responde: OK para proceder o ignora para rechazar`
    );
    await supabase.from('notificaciones_admin').insert([{
      tipo: 'zona_roja',
      contenido: `Zona roja detectada: ${nombre} en ${zona} solicita ${tipo_servicio}`,
    }]);
    return { _zonaRoja: true };
  }

  if (nivelRiesgo === 'rojo' || zonaData?.requiere_verificacion_extra) {
    await notifyAdmin(
      `🔶 *ZONA REQUIERE VERIFICACIÓN*\n` +
      `Cliente: ${nombre} (${email})\n` +
      `Zona: ${zona} [${nivelRiesgo.toUpperCase()}]\n` +
      `Servicio: ${tipo_servicio}`
    );
  }

  const m2Num = Number(m2) || 0;
  // calcularMonto devuelve null si el precio no puede resolverse automáticamente.
  // null (sin precio) es distinto de 0 (precio cero) — no usar || 0.
  const montoBase = await calcularMonto(tipo_servicio, m2Num);
  if (montoBase === null) {
    const motivo = `precio_no_resuelto | servicio=${tipo_servicio} m2=${m2Num || '?'}`;
    console.log(`[COT-PRECIO] ${motivo} — escalando a admin sin crear cotización`);
    await notifyAdmin(
      `⚪ *COTIZACIÓN SIN PRECIO AUTOMÁTICO*\n` +
      `Servicio: ${tipo_servicio}\n` +
      `Cliente: ${nombre} — ${telefono}\n` +
      `Email: ${email}\n` +
      `Metraje: ${m2Num || '?'} m²\n` +
      `Zona: ${zona || '—'} [${nivelRiesgo}]\n` +
      `Plazo: ${plazo || '—'}\n` +
      `Detalles: ${detalles_adicionales || '—'}\n` +
      `Canal: ${canal}`
    );
    await supabase.from('notificaciones_admin').insert([{
      tipo:      'precio_no_resuelto',
      contenido: `Sin precio: ${nombre} (${telefono}) — ${tipo_servicio}${m2Num ? ` — ${m2Num} m²` : ''}`,
    }]);
    return { _sinPrecio: true };
  }

  // montoBase es pre-IVA, igual que servicios[i].subtotal en el CRM manual.
  const ivaMonto = Math.round(montoBase * 0.12 * 100) / 100;
  const total    = Math.round((montoBase + ivaMonto) * 100) / 100;

  const NOMBRES_SERVICIO = {
    'tour_virtual':           'Tour Virtual',
    'paquete_basico':         'Paquete BÁSICO',
    'paquete_intermedio':     'Paquete INTERMEDIO',
    'paquete_premium':        'Paquete PREMIUM',
    'asbuilt_remodelacion':   'As-Built Remodelación',
    'asbuilt_levantamiento':  'As-Built Levantamiento',
    'asbuilt_avaluo':         'As-Built Avalúo/Trámite',
    'fotografia_360':         'Fotografías 360°',
    'video_recorrido':        'Video recorrido',
    'gemelo_digital':         'Gemelo digital 3D',
    'fotografia_profesional': 'Fotografía profesional',
    'video_drone':            'Video aéreo con drone',
    'construccion':           'Servicios de Construcción',
  };
  const descServicio = NOMBRES_SERVICIO[tipo_servicio] || tipo_servicio;
  const tipoPrecio   = m2Num > 0 ? 'por_m2' : 'fijo';
  const precioUnit   = m2Num > 0 ? Math.round(montoBase / m2Num * 100) / 100 : montoBase;

  let { data: cliente } = await supabase
    .from('clientes').select('id').eq('email', email).maybeSingle();
  if (!cliente) {
    const { data: newCliente } = await supabase
      .from('clientes')
      .insert([{ nombre, email, telefono: telefono || '', tipo: 'Lead' }])
      .select().single();
    cliente = newCliente;
  }

  // Formato rico — idéntico al que produce saveCotizacion() del CRM manual:
  // servicios[i].subtotal = pre-IVA; iva_monto y total calculados encima.
  // monto en cotizaciones = total con IVA (igual que en cotizaciones manuales).
  const detalles = {
    servicios: [{
      descripcion:     `${descServicio}${m2Num > 0 ? ` — ${m2Num} m²` : ''}`,
      tipo_precio:     tipoPrecio,
      cantidad:        m2Num > 0 ? m2Num : 1,
      precio_unitario: precioUnit,
      subtotal:        montoBase,
    }],
    subtotal:        montoBase,
    descuento_tipo:  'porcentaje',
    descuento_valor: 0,
    descuento_monto: 0,
    iva_porcentaje:  12,
    iva_monto:       ivaMonto,
    total,
    m2: m2Num, zona, plazo, detalles_adicionales,
    nivel_riesgo: nivelRiesgo,
    requiere_verificacion: zonaData?.requiere_verificacion_extra || false,
  };

  const { data: cot, error } = await supabase
    .from('cotizaciones')
    .insert([{
      cliente_id:      cliente.id,
      conversacion_id: conversacion_id || null,
      canal,
      tipo_servicio,
      monto:   total,                    // total con IVA — igual que cotizaciones manuales
      moneda,                            // GTQ por defecto desde el agente WA
      estado:  'borrador',
      detalles_json: detalles,
      anticipo: Math.round(total * 0.5), // 50% del total con IVA
    }])
    .select().single();
  if (error) throw error;

  // Formateo de moneda para notificaciones — los montos en DB son siempre USD;
  // si moneda='GTQ' se multiplica por TASA_GTQ para mostrar el valor que verá el cliente.
  const sym    = moneda === 'GTQ' ? 'Q' : '$';
  const factor = moneda === 'GTQ' ? TASA_GTQ : 1;
  const fmtN   = n => sym + Math.round(n * factor).toLocaleString('es-GT');

  const emoji = nivelRiesgo === 'rojo' ? '🔴' : nivelRiesgo === 'amarillo' ? '🟡' : '🟢';
  await notifyAdmin(
    `${emoji} *NUEVA COTIZACIÓN #${cot.id}*\n` +
    `Cliente: ${nombre}\n` +
    `Servicio: ${tipo_servicio.replace('_', ' ').toUpperCase()}\n` +
    `Metraje: ${m2Num || '?'} m²\n` +
    `Zona: ${zona || '—'} [${nivelRiesgo}]\n` +
    `Moneda: ${moneda}\n` +
    `Subtotal: ${fmtN(montoBase)} | IVA 12%: ${fmtN(ivaMonto)} | Total: ${fmtN(total)}\n` +
    `Canal: ${canal}\n\n` +
    `Responde: OK ${cot.id} para aprobar`
  );

  await supabase.from('notificaciones_admin').insert([{
    tipo: 'cotizacion_revision',
    referencia_id: cot.id,
    contenido: `Cotización #${cot.id} — ${nombre} — ${fmtN(total)} (total c/IVA) — ${tipo_servicio}`,
  }]);

  return {
    cotizacion_id: cot.id,
    monto: total,
    moneda,
    tipo_servicio,
    requiere_verificacion: zonaData?.requiere_verificacion_extra || false,
    mensaje: `Cotización generada. Monto estimado: ${fmtN(total)} ${moneda}. Te contactaremos para confirmar detalles.`,
  };
}

// POST /api/cotizacion/generar
router.post('/generar', async (req, res) => {
  try {
    const {
      tipo_servicio, m2, zona, nombre, email, telefono,
      plazo, canal = 'web', detalles_adicionales, conversacion_id,
      moneda,
    } = req.body;

    if (!tipo_servicio || !nombre || !email)
      return res.status(400).json({ error: 'tipo_servicio, nombre y email son requeridos' });

    const result = await crearCotizacionBorradorCore({
      tipo_servicio, m2, zona, nombre, email, telefono,
      plazo, canal, detalles_adicionales, conversacion_id,
      moneda,   // undefined → function default ('GTQ')
    });

    if (result._zonaRoja) {
      return res.status(202).json({
        message: 'Tu solicitud está siendo revisada. Te contactaremos en breve.',
        requiere_revision: true,
      });
    }

    res.status(201).json(result);
  } catch (e) {
    console.error('[CotizacionGen]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/cotizacion/zonas/:id — update zone (admin)
router.put('/zonas/:id', async (req, res) => {
  try {
    const { zona, nivel_riesgo, descripcion, aceptar_trabajos, requiere_verificacion_extra } = req.body;
    const { data, error } = await supabase
      .from('zonas_seguridad')
      .update({ zona, nivel_riesgo, descripcion, aceptar_trabajos, requiere_verificacion_extra })
      .eq('id', req.params.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/cotizacion/zonas — create new zone (admin)
router.post('/zonas', async (req, res) => {
  try {
    const { zona, nivel_riesgo, descripcion, aceptar_trabajos, requiere_verificacion_extra } = req.body;
    const { data, error } = await supabase
      .from('zonas_seguridad')
      .insert([{ zona, nivel_riesgo, descripcion: descripcion || '', aceptar_trabajos: aceptar_trabajos ?? true, requiere_verificacion_extra: requiere_verificacion_extra ?? false }])
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/cotizacion/zonas — public: zone risk list for frontend
router.get('/zonas', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('zonas_seguridad').select('id, zona, nivel_riesgo, requiere_verificacion_extra, aceptar_trabajos')
      .order('zona');
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.crearCotizacionBorradorCore = crearCotizacionBorradorCore;
