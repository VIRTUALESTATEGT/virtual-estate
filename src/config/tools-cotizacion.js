'use strict';

// ── Tool definition — Anthropic tool use format ───────────────────────────────
// Passed to client.messages.create({ tools: [TOOL_CREAR_COTIZACION] }) when the
// WA agent is enabled for cotización collection (Fase 2+). Not wired yet.

const TOOL_CREAR_COTIZACION = {
  name: 'crear_cotizacion_borrador',
  description:
    'Crea un borrador de cotización en el CRM para que el owner lo revise y apruebe ' +
    'antes de enviarlo al cliente. Llama esta tool SOLO cuando tengas confirmados el ' +
    'nombre, tipo de servicio y teléfono del cliente. No la llames más de una vez por ' +
    'conversación ni antes de tener la intención de cotizar claramente expresada. ' +
    'Antes de llamarla, pregunta en qué moneda prefiere la cotización (quetzales Q o dólares $); ' +
    'si el cliente no responde o no especifica, usa GTQ por defecto.',
  input_schema: {
    type: 'object',
    properties: {
      nombre: {
        type: 'string',
        description: 'Nombre completo del cliente tal como lo proporcionó.',
      },
      tipo_servicio: {
        type: 'string',
        enum: ['escaneo_3d', 'as_built', 'real_estate', 'construccion'],
        description: 'Tipo de servicio solicitado.',
      },
      telefono: {
        type: 'string',
        description: 'Número de WhatsApp del cliente, confirmado en la conversación.',
      },
      moneda: {
        type: 'string',
        enum: ['GTQ', 'USD'],
        description:
          'Moneda preferida por el cliente para la cotización. ' +
          'Pregunta al cliente: "¿prefiere la cotización en quetzales (Q) o dólares ($)?" ' +
          'Si no responde o no especifica, usa GTQ.',
      },
      m2: {
        type: 'number',
        description: 'Metraje de la propiedad en m². Usado para calcular el precio estimado.',
      },
      zona: {
        type: 'string',
        description: 'Zona o ubicación de la propiedad (ej: "Zona 10", "Antigua", "Mixco").',
      },
      email: {
        type: 'string',
        description:
          'Correo electrónico del cliente. Si el cliente no quiere darlo, ' +
          'omite este campo y pasa email_declinado=true.',
      },
      email_declinado: {
        type: 'boolean',
        description: 'true si el cliente declinó explícitamente dar su correo.',
      },
      plazo: {
        type: 'string',
        description: 'Urgencia o plazo del proyecto (ej: "esta semana", "próximo mes").',
      },
      detalles_adicionales: {
        type: 'string',
        description: 'Información adicional del proyecto mencionada por el cliente.',
      },
    },
    required: ['nombre', 'tipo_servicio', 'telefono'],
  },
};

// ── Executor ──────────────────────────────────────────────────────────────────
// Called by the WA agent handler when Claude invokes the tool.
// Never throws — any failure returns { exito: false, error }.

const { crearCotizacionBorradorCore } = require('../routes/cotizacion-gen');

async function ejecutarCrearCotizacion(input, conversacion_id = null) {
  try {
    let { nombre, tipo_servicio, telefono, m2, zona, plazo } = input;
    let email               = input.email               || '';
    let email_declinado     = input.email_declinado     || false;
    let detalles_adicionales = input.detalles_adicionales || '';
    const moneda            = (input.moneda === 'USD') ? 'USD' : 'GTQ'; // default GTQ

    // Email placeholder: the endpoint requires email to be non-empty.
    // When the client didn't provide one, use a traceable placeholder and log a note.
    if (!email) {
      email = `${telefono}@sincorreo.whatsapp`;
      const nota = 'Cliente declinó correo — contacto solo por WhatsApp';
      detalles_adicionales = detalles_adicionales
        ? `${detalles_adicionales} | ${nota}`
        : nota;
    }

    const result = await crearCotizacionBorradorCore({
      tipo_servicio,
      m2,
      zona,
      nombre,
      email,
      telefono,
      plazo,
      moneda,
      canal: 'whatsapp',
      detalles_adicionales,
      conversacion_id,
    });

    if (result._zonaRoja) {
      return {
        exito: false,
        error: 'La zona requiere revisión manual. El equipo fue notificado y se pondrá en contacto.',
      };
    }

    return {
      exito: true,
      cotizacion_id: result.cotizacion_id,
      monto: result.monto,
      mensaje: result.mensaje,
    };
  } catch (e) {
    console.error('[tool crear_cotizacion_borrador]', e.message);
    return { exito: false, error: e.message };
  }
}

// ── Tool: escalar_a_humano ────────────────────────────────────────────────────

const TOOL_ESCALAR_HUMANO = {
  name: 'escalar_a_humano',
  description:
    'Notifica al equipo humano para que atienda al cliente personalmente. ' +
    'Llama esta tool cuando: (a) el cliente pide explícitamente hablar con un humano, ' +
    'encargado, asesor o persona real; o (b) la consulta requiere una decisión o ' +
    'información que el agente no puede proporcionar con certeza. ' +
    'IMPORTANTE: tras llamarla, el agente debe seguir respondiendo al cliente con ' +
    'normalidad — no interrumpe la conversación.',
  input_schema: {
    type: 'object',
    properties: {
      motivo: {
        type: 'string',
        enum: ['cliente_pide_humano', 'agente_no_puede_resolver'],
        description:
          '"cliente_pide_humano" si el cliente lo pidió explícitamente. ' +
          '"agente_no_puede_resolver" si la consulta requiere atención especializada.',
      },
      resumen: {
        type: 'string',
        description: 'Una frase que resume el tema que requiere atención humana.',
      },
    },
    required: ['motivo', 'resumen'],
  },
};

// Executor — never throws; any failure is logged and the conversation continues.
async function ejecutarEscalarHumano(input, phone) {
  try {
    const { notifyAdmin } = require('../utils/whatsapp');
    const supabase = require('./supabase');
    const { motivo, resumen } = input;

    await notifyAdmin(
      `🔵 *SOLICITUD DE ATENCIÓN HUMANA*\n` +
      `Cliente: ${phone}\n` +
      `Motivo: ${resumen || motivo}`
    );

    // Fire-and-forget — don't block the response if the DB insert is slow
    supabase.from('notificaciones_admin').insert([{
      tipo:     'handoff_humano',
      contenido: `Handoff ${phone} — ${resumen || motivo}`,
    }]).then(() => {}).catch(e =>
      console.error('[HANDOFF] notificaciones_admin insert error:', e.message)
    );

    return { exito: true };
  } catch (e) {
    console.error('[tool escalar_a_humano]', e.message);
    return { exito: false, error: e.message };
  }
}

module.exports = { TOOL_CREAR_COTIZACION, ejecutarCrearCotizacion, TOOL_ESCALAR_HUMANO, ejecutarEscalarHumano };
