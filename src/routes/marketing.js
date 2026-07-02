// src/routes/marketing.js — Módulo Marketing
const express  = require('express');
const router   = express.Router();
const supabase = require('../config/supabase');

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

// ── Status ────────────────────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  res.json({ ok: true, modulo: 'marketing', fase: 2 });
});

// ── Identidad de Marca ────────────────────────────────────────────────────────
router.get('/identidad', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('marca_identidad')
      .select('*')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    res.json(data); // null si no existe fila
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
      const { primario, secundario, acento } = colores;
      for (const [key, val] of [['primario', primario], ['secundario', secundario], ['acento', acento]]) {
        if (val !== undefined && !HEX_RE.test(val))
          return res.status(400).json({ error: `colores.${key} debe tener formato #RRGGBB` });
      }
      payload.colores = { primario, secundario, acento };
    }

    if (tipografias !== undefined) {
      payload.tipografias = {
        principal:  tipografias.principal  ?? null,
        secundaria: tipografias.secundaria ?? null,
      };
    }

    // singleton: update si existe, insert si no
    const { data: existing, error: chkErr } = await supabase
      .from('marca_identidad').select('id').limit(1).maybeSingle();
    if (chkErr) throw chkErr;

    const { data, error } = existing
      ? await supabase.from('marca_identidad').update(payload).eq('id', existing.id).select().single()
      : await supabase.from('marca_identidad').insert(payload).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Instrucciones ─────────────────────────────────────────────────────────────
router.get('/instrucciones', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('marketing_instrucciones')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
      .insert({ tipo, instruccion: instruccion.trim() })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
      .from('marketing_instrucciones')
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/instrucciones/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('marketing_instrucciones')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Órdenes de Contenido ──────────────────────────────────────────────────────

router.get('/ordenes', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('ordenes_contenido')
      .select(`*, contenido_generado(id, estado, imagen_url, copy_texto, hashtags, prompt_usado, created_at)`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/ordenes', async (req, res) => {
  try {
    const { titulo, descripcion, tipo_contenido, redes,
            instrucciones_extra, instrucciones_ids } = req.body;
    if (!titulo?.trim()) return res.status(400).json({ error: 'titulo es requerido' });
    const { data, error } = await supabase
      .from('ordenes_contenido')
      .insert({
        titulo:            titulo.trim(),
        descripcion:       descripcion       ?? null,
        tipo_contenido:    tipo_contenido    ?? 'imagen',
        redes:             redes             ?? [],
        instrucciones_extra: instrucciones_extra ?? null,
        instrucciones_ids: instrucciones_ids ?? []
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/ordenes/:id/generar', async (req, res) => {
  try {
    const { ejecutar } = require('../services/contentEngine');
    const contenido = await ejecutar(Number(req.params.id));
    res.json({ ok: true, contenido });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/contenido/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('contenido_generado')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
