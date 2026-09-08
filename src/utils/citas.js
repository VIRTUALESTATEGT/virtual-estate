'use strict';

const supabase = require('../config/supabase');

const MARGEN = 45; // minutos entre citas (traslado)

// ── Helpers de tiempo ─────────────────────────────────────────────────────────

// Guatemala es UTC-6 sin horario de verano — offset fijo siempre.
// Vercel corre en UTC, por lo que new Date() devuelve hora UTC.
// Si usáramos UTC date como "hoy", entre las 18:00 y 23:59 GT (00:00-05:59 UTC)
// el "hoy" en UTC ya sería el día siguiente, desplazando la anticipación mínima.
function guatemalaHoy() {
  // 'sv' locale retorna YYYY-MM-DD (ISO 8601) para cualquier timezone
  return new Intl.DateTimeFormat('sv', { timeZone: 'America/Guatemala' }).format(new Date());
}

function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2, '0'),
    String(dt.getDate()).padStart(2, '0'),
  ].join('-');
}

// 'HH:MM' o 'HH:MM:SS' (formato que devuelve PostgreSQL) → minutos desde medianoche
const toMins  = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMins = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ── calcularDuracion ──────────────────────────────────────────────────────────

function calcularDuracion(tipo, m2) {
  if (tipo === 'visita_propiedades') return 90;
  if (tipo === 'visita_tecnica') {
    const metros = parseInt(m2, 10);
    if (!metros || metros <= 0) throw new Error('m2 debe ser mayor a 0 para visita_tecnica');
    if (metros <= 150) return 120;
    if (metros <= 400) return 180;
    return 300;
  }
  throw new Error(`tipo inválido: "${tipo}"`);
}

// ── getSlots ──────────────────────────────────────────────────────────────────

async function getSlots(fecha, tipo, m2) {
  const duracion = calcularDuracion(tipo, m2);

  // 1. Anticipación mínima: fecha >= hoy_guatemalteco + 2 días (un día de por medio)
  if (fecha < addDays(guatemalaHoy(), 2)) return [];

  // 2. Solo lunes–viernes (0=Dom, 1=Lun … 6=Sab en JS y PostgreSQL EXTRACT(DOW))
  const [y, mo, d] = fecha.split('-').map(Number);
  const dow = new Date(y, mo - 1, d).getDay();
  if (dow === 0 || dow === 6) return [];

  // 3. Configuración de disponibilidad (regla global: responsable_id IS NULL)
  const { data: cfg, error: cfgErr } = await supabase
    .from('citas_config')
    .select('hora_apertura, hora_cierre, activo')
    .is('responsable_id', null)
    .eq('dia_semana', dow)
    .maybeSingle();
  if (cfgErr) throw cfgErr;
  if (!cfg || !cfg.activo) return [];

  const apertura = toMins(cfg.hora_apertura);
  const cierre   = toMins(cfg.hora_cierre);

  // 4. Bloqueos para esa fecha
  const { data: bloqueos, error: blqErr } = await supabase
    .from('citas_bloqueos')
    .select('hora_inicio, hora_fin')
    .eq('fecha', fecha);
  if (blqErr) throw blqErr;

  // Día completo bloqueado si alguna fila tiene hora_inicio = null
  if ((bloqueos || []).some(b => b.hora_inicio === null)) return [];

  // 5. Citas que ocupan el día — sin filtrar por responsable (agente único)
  //    Lazy evaluation: las reservas provisionales vencidas (expira_en < now) se ignoran
  const ahora = new Date().toISOString();
  const { data: ocupadas, error: citErr } = await supabase
    .from('citas')
    .select('hora_inicio, hora_fin')
    .eq('fecha', fecha)
    .filter('estado', 'not.in', '(rechazada,cancelada)')
    .or(`reserva_expira_en.is.null,reserva_expira_en.gt.${ahora}`);
  if (citErr) throw citErr;

  // 6. Ventana máxima de inicio según tipo
  //    visita_propiedades: tope 15:00 (para terminar con luz natural)
  //    visita_tecnica: debe terminar antes del cierre (17:00)
  const maxInicio = tipo === 'visita_propiedades'
    ? Math.min(15 * 60, cierre - duracion)
    : cierre - duracion;

  if (maxInicio < apertura) return [];

  // 7. Rangos bloqueados
  //    Citas existentes: se expanden ±MARGEN (tiempo de traslado)
  //    Bloqueos parciales: se toman tal cual, sin margen adicional
  const bloqueados = [
    ...(ocupadas || []).map(c => ({
      start: toMins(c.hora_inicio) - MARGEN,
      end:   toMins(c.hora_fin)   + MARGEN,
    })),
    ...(bloqueos || [])
      .filter(b => b.hora_inicio !== null && b.hora_fin !== null)
      .map(b => ({ start: toMins(b.hora_inicio), end: toMins(b.hora_fin) })),
  ];

  // 8. Candidatos cada 30 min; libre si [s, s+dur] no solapa ningún rango bloqueado
  const slots = [];
  for (let s = apertura; s <= maxInicio; s += 30) {
    if (bloqueados.every(r => s + duracion <= r.start || s >= r.end)) {
      slots.push(fromMins(s));
    }
  }

  return slots;
}

module.exports = { calcularDuracion, getSlots };
