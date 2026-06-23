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
    'conversación ni antes de tener la intención de cotizar claramente expresada.',
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

module.exports = { TOOL_CREAR_COTIZACION, ejecutarCrearCotizacion };
