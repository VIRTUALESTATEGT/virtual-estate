const express = require('express');
const router  = express.Router();
const supabase = require('../config/supabase');

const TIPOS_VALIDOS = new Set(['servicios_basicos', 'espacios_ambientes', 'adicionales', 'amenidades']);

// GET / — todos (activos e inactivos) para la UI de gestión del CRM, con conteo de uso
router.get('/', async (req, res) => {
  try {
    const [{ data, error }, { data: usos, error: usoErr }] = await Promise.all([
      supabase.from('adicionales_catalogo').select('*').order('tipo').order('orden'),
      supabase.from('propiedades_adicionales').select('nombre'),
    ]);
    if (error) throw error;
    if (usoErr) throw usoErr;
    const usoCounts = {};
    (usos || []).forEach(u => { usoCounts[u.nombre] = (usoCounts[u.nombre] || 0) + 1; });
    res.json(data.map(a => ({ ...a, propiedades_en_uso: usoCounts[a.nombre] || 0 })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST / — crear adicional
router.post('/', async (req, res) => {
  try {
    const { tipo, nombre, orden = 0 } = req.body;
    if (!nombre?.trim())
      return res.status(400).json({ error: 'nombre es requerido.' });
    if (!TIPOS_VALIDOS.has(tipo))
      return res.status(400).json({ error: `tipo inválido. Valores permitidos: ${[...TIPOS_VALIDOS].join(', ')}.` });

    const { data, error } = await supabase
      .from('adicionales_catalogo')
      .insert([{ tipo, nombre: nombre.trim(), orden: Number(orden) }])
      .select()
      .single();
    if (error) {
      if (error.code === '23505')
        return res.status(409).json({ error: `Ya existe un adicional con el nombre "${nombre.trim()}".` });
      throw error;
    }
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /:id — editar; si cambia nombre, cascade a propiedades_adicionales
router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { tipo, nombre, activo, orden } = req.body;

    const { data: current, error: fetchErr } = await supabase
      .from('adicionales_catalogo')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !current) return res.status(404).json({ error: 'Adicional no encontrado.' });

    if (tipo !== undefined && !TIPOS_VALIDOS.has(tipo))
      return res.status(400).json({ error: `tipo inválido. Valores permitidos: ${[...TIPOS_VALIDOS].join(', ')}.` });

    const nuevoNombre  = nombre !== undefined ? nombre.trim() : current.nombre;
    const nombreCambia = nuevoNombre !== current.nombre;

    // Validar unicidad del nuevo nombre antes de tocar cualquier tabla
    if (nombreCambia) {
      const { data: dup } = await supabase
        .from('adicionales_catalogo')
        .select('id')
        .eq('nombre', nuevoNombre)
        .neq('id', id)
        .maybeSingle();
      if (dup) return res.status(409).json({ error: `Ya existe un adicional con el nombre "${nuevoNombre}".` });
    }

    // ① Cascade propiedades_adicionales PRIMERO
    // Si falla, el catálogo queda intacto → estado completamente recuperable
    let propiedades_actualizadas = 0;
    if (nombreCambia) {
      const { count } = await supabase
        .from('propiedades_adicionales')
        .select('*', { count: 'exact', head: true })
        .eq('nombre', current.nombre);

      if (count > 0) {
        const { error: cascErr } = await supabase
          .from('propiedades_adicionales')
          .update({ nombre: nuevoNombre })
          .eq('nombre', current.nombre);
        if (cascErr) throw cascErr;
      }
      propiedades_actualizadas = count ?? 0;
    }

    // ② Actualizar catálogo DESPUÉS
    // Si falla: catálogo stale (nombre viejo), propiedades ya migradas.
    // Retry natural: cascade encuentra 0 filas, solo este UPDATE corre.
    const patch = {};
    if (tipo   !== undefined) patch.tipo   = tipo;
    if (nombre !== undefined) patch.nombre = nuevoNombre;
    if (activo !== undefined) patch.activo = activo;
    if (orden  !== undefined) patch.orden  = Number(orden);

    const { data: updated, error: updErr } = await supabase
      .from('adicionales_catalogo')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (updErr) throw updErr;

    res.json({ ...updated, propiedades_actualizadas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /:id — solo si 0 propiedades lo usan; si hay, 409 con el conteo
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    const { data: current, error: fetchErr } = await supabase
      .from('adicionales_catalogo')
      .select('nombre')
      .eq('id', id)
      .single();
    if (fetchErr || !current) return res.status(404).json({ error: 'Adicional no encontrado.' });

    const { count, error: countErr } = await supabase
      .from('propiedades_adicionales')
      .select('*', { count: 'exact', head: true })
      .eq('nombre', current.nombre);
    if (countErr) throw countErr;

    if (count > 0)
      return res.status(409).json({
        error: `No se puede eliminar: ${count} propiedad(es) usan "${current.nombre}". Podés desactivarlo en su lugar.`,
        propiedades_en_uso: count,
      });

    const { error: delErr } = await supabase
      .from('adicionales_catalogo')
      .delete()
      .eq('id', id);
    if (delErr) throw delErr;

    res.json({ message: `Adicional "${current.nombre}" eliminado.` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
