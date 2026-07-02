-- 037_marketing_fase1.sql
-- Módulo Marketing — Fase 1: tablas base
-- Ejecutar manualmente en Supabase SQL Editor

-- ── 1. Identidad de marca ─────────────────────────────────────────────────────
create table if not exists marca_identidad (
  id                  bigint generated always as identity primary key,
  nombre_negocio      text,
  colores             jsonb,
  logo_url            text,
  tipografias         jsonb,
  enfoque_negocio     text,
  tono_comunicacion   text,
  publico_objetivo    text,
  updated_at          timestamptz default now()
);

-- ── 2. Instrucciones del agente ───────────────────────────────────────────────
create table if not exists marketing_instrucciones (
  id          bigint generated always as identity primary key,
  tipo        text not null check (tipo in ('general', 'individual')),
  instruccion text not null,
  activa      boolean default true,
  created_at  timestamptz default now()
);

-- ── 3. Órdenes de contenido ───────────────────────────────────────────────────
create table if not exists ordenes_contenido (
  id                  bigint generated always as identity primary key,
  titulo              text,
  descripcion         text,
  tipo_contenido      text check (tipo_contenido in ('imagen', 'carrusel', 'video_slideshow', 'texto')),
  redes               jsonb,
  instrucciones_extra text,
  estado              text default 'nueva' check (estado in ('nueva', 'generando', 'generada', 'error')),
  created_at          timestamptz default now()
);

-- ── 4. Contenido generado ─────────────────────────────────────────────────────
create table if not exists contenido_generado (
  id                   bigint generated always as identity primary key,
  orden_id             bigint references ordenes_contenido (id) on delete set null,
  copy_texto           text,
  hashtags             text,
  imagen_url           text,
  prompt_usado         text,
  estado               text default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado', 'publicado')),
  comentario_rechazo   text,
  programado_para      timestamptz,
  publicado_en         jsonb,
  created_at           timestamptz default now()
);

-- ── 5. Referencias de publicidad ──────────────────────────────────────────────
create table if not exists referencias_publicidad (
  id          bigint generated always as identity primary key,
  descripcion text,
  archivo_url text,
  notas       text,
  created_at  timestamptz default now()
);
