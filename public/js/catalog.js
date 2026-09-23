/* catalog.js — shared property catalog module
 * Used by: real-estate.html (public), portal-cliente.html (with favorites)
 * Exposes: initCatalog(config) → { load, sort, getData }
 * Also sets: window.API_URL (shared by page-level fetch calls)
 */

window.API_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:3000' : '';

// Formatea un precio sin decimales si son cero, con 2 si los tiene.
// 6600 → "6,600"  |  6600.50 → "6,600.50"  |  835.443 → "835.44"
function fmtPrecio(n) {
  const num = Math.round((Number(n) || 0) * 100) / 100;
  const d = num % 1 !== 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: d ? 2 : 0, maximumFractionDigits: 2 });
}

const CATALOG_TIPO_ICON = {
  Apartamento: 'fa-building', Casa: 'fa-home', Terreno: 'fa-map',
  'Local comercial': 'fa-store', Oficina: 'fa-briefcase',
  Penthouse: 'fa-city', 'Bodega / Galera': 'fa-warehouse', Finca: 'fa-tractor',
};

const CATALOG_DISP_CLASS = {
  vacia: 'disp-vacia', habitada: 'disp-habitada',
  airbnb: 'disp-airbnb', en_construccion: 'disp-construccion',
};

const CATALOG_DISP_LABEL = {
  vacia: 'Disponible', habitada: 'Habitada',
  airbnb: 'Airbnb', en_construccion: 'En construcción',
};

function catalogModLabel(m) {
  return Array.isArray(m) ? m.map(v => v === 'venta' ? 'Venta' : 'Renta').join(' · ') : (m || 'Venta');
}

function catalogModIsRenta(m) {
  return Array.isArray(m) ? m.includes('renta') : String(m || '').toLowerCase().includes('renta');
}

// Returns the card price text, showing dual prices when both exist
function _catalogPriceText(p) {
  const sym = p.moneda === 'GTQ' ? 'Q' : '$';
  const v = p.precio_venta ? sym + fmtPrecio(p.precio_venta) : null;
  const r = p.precio_renta ? sym + fmtPrecio(p.precio_renta) + '/mes' : null;
  if (v && r) return `${v} · ${r}`;
  return v || r || (p.precio ? sym + fmtPrecio(p.precio) : 'Consultar');
}

// Returns m2 spec string, preferring m2_construccion/m2_terreno over legacy m2
function _catalogM2Text(p) {
  const parts = [];
  if (p.m2_construccion) parts.push(p.m2_construccion + ' m² const.');
  if (p.m2_terreno)      parts.push(p.m2_terreno + ' m² terreno');
  if (!parts.length && p.m2) parts.push(p.m2 + ' m²');
  return parts.join(' · ');
}

function initCatalog(cfg) {
  const {
    gridId,
    countId       = null,
    cardVariant   = 'public',
    filterIds     = {},
    favIds        = new Set(),
    getFavIds     = null,
    onToggleFav   = null,
    onCardClick   = null,
    onAfterRender = null,
    getAdics      = () => new Set(),
    getAdicsMode  = null, // () => 'some' | 'every'  — defaults to 'some' (OR)
  } = cfg;

  // getFavIds wins over static favIds so callers can pass a live getter
  const _getFavIds = getFavIds || (() => favIds);

  let _data = [];

  function _grid()  { return document.getElementById(gridId); }
  function _count() { return countId ? document.getElementById(countId) : null; }

  // ── Card builders ────────────────────────────────────────────────────────────

  function _publicCard(p) {
    const icon    = CATALOG_TIPO_ICON[p.tipo] || 'fa-home';
    const sym     = p.moneda === 'GTQ' ? 'Q' : '$';
    const precio  = _catalogPriceText(p);
    const isRenta = catalogModIsRenta(p.modalidad);
    const code    = 'PROP-' + String(p.id).padStart(5, '0');
    const adics   = (p.propiedades_adicionales || []).map(a => a.nombre);
    const m2Spec  = _catalogM2Text(p);
    const dispArr = p.disponibilidad || [];
    const dispBadges = dispArr.length
      ? `<div class="disp-badges">${dispArr.map(d =>
          `<span class="disp-badge ${CATALOG_DISP_CLASS[d] || ''}">${CATALOG_DISP_LABEL[d] || d}</span>`
        ).join('')}</div>`
      : '';
    const imgHtml = p.foto_principal_url
      ? `<img src="${p.foto_principal_url}" alt="${p.nombre}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
         <div class="prop-img-ph" style="display:none;position:absolute;inset:0;"><i class="fas ${icon}"></i><span>${p.linktour3d ? 'Tour virtual disponible' : 'Sin tour aún'}</span></div>`
      : `<div class="prop-img-ph"><i class="fas ${icon}"></i><span>${p.linktour3d ? 'Tour virtual disponible' : 'Sin tour aún'}</span></div>`;
    return `<div class="prop-card" data-id="${p.id}" data-adics='${JSON.stringify(adics)}'>
    <div class="prop-img">
      ${imgHtml}
      <span class="prop-badge ${isRenta ? 'badge-renta' : 'badge-venta'}">${catalogModLabel(p.modalidad)}</span>
      ${p.linktour3d ? `<span class="prop-tour-badge"><i class="fas fa-vr-cardboard"></i> 3D</span>` : ''}
    </div>
    <div class="prop-body">
      <div class="prop-code">${code}</div>
      <div class="prop-name"><i class="fas ${icon}" style="color:var(--gold);font-size:.8rem;margin-right:.4rem;opacity:.8;"></i>${p.nombre}</div>
      <div class="prop-loc"><i class="fas fa-map-marker-alt" style="color:var(--gold);font-size:.6rem;"></i> ${p.zona || 'Guatemala'}</div>
      <div class="prop-specs">
        ${p.habitaciones ? `<span class="prop-spec"><i class="fas fa-bed"></i> ${p.habitaciones}</span>` : ''}
        ${p.banos        ? `<span class="prop-spec"><i class="fas fa-bath"></i> ${p.banos}</span>` : ''}
        ${p.parqueos     ? `<span class="prop-spec"><i class="fas fa-car"></i> ${p.parqueos}</span>` : ''}
        ${m2Spec         ? `<span class="prop-spec"><i class="fas fa-ruler-combined"></i> ${m2Spec}</span>` : ''}
        ${!p.habitaciones && !p.banos && !p.parqueos && p.tipo ? `<span class="prop-spec"><i class="fas ${icon}"></i> ${p.tipo}</span>` : ''}
      </div>
      ${dispBadges}
      <div class="prop-price" data-price="${p.precio || 0}" data-moneda="${p.moneda || 'USD'}">${precio}</div>
    </div>
    <div class="prop-foot">
      ${p.linktour3d
        ? `<a href="${p.linktour3d}" target="_blank" class="prop-link">Ver tour 3D <i class="fas fa-arrow-right"></i></a>`
        : `<a href="index.html#cotizador" class="prop-link" onclick="if(window.onAgendarCard){event.preventDefault();window.onAgendarCard(${p.id});}">Agendar visita <i class="fas fa-arrow-right"></i></a>`}
      <i class="far fa-heart prop-heart" data-code="${code}" data-propid="${p.id}" title="Guardar en favoritos"></i>
    </div>
  </div>`;
  }

  // NOTE: pages using cardVariant:'portal' must include .disp-badges/.disp-badge/.disp-{vacia,habitada,airbnb,construccion} CSS
  function _portalCard(p) {
    const icon      = CATALOG_TIPO_ICON[p.tipo] || 'fa-home';
    const precio    = _catalogPriceText(p);
    const isRenta   = catalogModIsRenta(p.modalidad);
    const isSaved   = _getFavIds().has(p.id);
    const badgeCls  = isRenta ? 're-badge-renta' : 're-badge-venta';
    const favCls    = isSaved ? 're-prop-fav active' : 're-prop-fav';
    const favIcon   = isSaved ? 'fas' : 'far';
    const dispArr   = p.disponibilidad || [];
    const dispBadges = dispArr.length
      ? `<div class="disp-badges">${dispArr.map(d =>
          `<span class="disp-badge ${CATALOG_DISP_CLASS[d] || ''}">${CATALOG_DISP_LABEL[d] || d}</span>`
        ).join('')}</div>`
      : '';
    const imgHtmlP = p.foto_principal_url
      ? `<img src="${p.foto_principal_url}" alt="${p.nombre}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
         <div class="re-prop-img-ph" style="display:none;position:absolute;inset:0;"><i class="fas ${icon}"></i><span>Sin fotos</span></div>`
      : `<div class="re-prop-img-ph"><i class="fas ${icon}"></i><span>${p.linktour3d ? 'Tour virtual disponible' : 'Sin fotos aún'}</span></div>`;
    return `<div class="re-prop-card" data-id="${p.id}">
    <div class="re-prop-img">
      ${imgHtmlP}
      <span class="re-prop-badge ${badgeCls}">${catalogModLabel(p.modalidad)}</span>
      <div class="${favCls}" id="fav-btn-${p.id}" data-propid="${p.id}" title="${isSaved ? 'Quitar de favoritos' : 'Guardar en favoritos'}">
        <i class="${favIcon} fa-heart"></i>
      </div>
    </div>
    <div class="re-prop-body">
      <div class="re-prop-code">PROP-${String(p.id).padStart(5, '0')}</div>
      <div class="re-prop-name">${p.nombre}</div>
      <div class="re-prop-loc"><i class="fas fa-map-marker-alt" style="color:var(--gold);font-size:.6rem;"></i> ${p.zona || 'Guatemala'}</div>
      <div class="re-prop-specs">
        ${p.habitaciones ? `<span class="re-prop-spec"><i class="fas fa-bed"></i> ${p.habitaciones}</span>` : ''}
        ${p.banos        ? `<span class="re-prop-spec"><i class="fas fa-bath"></i> ${p.banos}</span>` : ''}
        ${p.parqueos     ? `<span class="re-prop-spec"><i class="fas fa-car"></i> ${p.parqueos}</span>` : ''}
        ${_catalogM2Text(p) ? `<span class="re-prop-spec"><i class="fas fa-ruler-combined"></i> ${_catalogM2Text(p)}</span>` : ''}
        ${!p.habitaciones && !p.banos && !p.parqueos && p.tipo ? `<span class="re-prop-spec"><i class="fas ${icon}"></i> ${p.tipo}</span>` : ''}
      </div>
      ${dispBadges}
      <div class="re-prop-price">${precio}</div>
    </div>
    <div class="re-prop-foot">
      ${p.linktour3d
        ? `<a href="${p.linktour3d}" target="_blank" class="re-prop-link"><i class="fas fa-vr-cardboard"></i> Ver Tour 3D <i class="fas fa-arrow-right"></i></a>`
        : `<button class="re-prop-link" style="color:var(--gray);cursor:default;"><i class="fas fa-lock" style="font-size:.55rem;color:var(--gold);"></i> Tour 3D — Agendar</button>`}
    </div>
  </div>`;
  }

  // ── Filter param builders ────────────────────────────────────────────────────

  function _buildParams() {
    const params = new URLSearchParams();
    const fids   = filterIds;

    if (fids.modalidad) {
      const mods  = [...document.querySelectorAll(fids.modalidad + ':checked')].map(c => c.value);
      const total = document.querySelectorAll(fids.modalidad).length;
      if (mods.length < total && mods.length > 0) params.set('modalidad', mods.join(','));
    }

    if (fids.tipo) {
      const tipos = [...document.querySelectorAll(fids.tipo + ':checked')].map(c => c.value);
      if (tipos.length === 1) params.set('tipo', tipos[0]);
    }

    if (fids.disponibilidad) {
      const total   = document.querySelectorAll(fids.disponibilidad).length;
      const checked = [...document.querySelectorAll(fids.disponibilidad + ':checked')].map(c => c.value);
      if (checked.length < total && checked.length > 0) params.set('disponibilidad', checked.join(','));
    }

    const numericMap = {
      precio_min:   fids.precioMin,  precio_max:   fids.precioMax,
      m2_min:       fids.m2Min,      m2_max:       fids.m2Max,
      m2_const_min: fids.m2ConstMin, m2_const_max: fids.m2ConstMax,
      m2_ter_min:   fids.m2TerMin,   m2_ter_max:   fids.m2TerMax,
      hab_min:      fids.habMin,     ban_min:      fids.banMin,    parq_min: fids.parqMin,
    };
    for (const [key, id] of Object.entries(numericMap)) {
      if (id) { const v = document.getElementById(id)?.value; if (v) params.set(key, v); }
    }

    if (fids.zona) {
      const v = document.getElementById(fids.zona)?.value?.trim();
      if (v) params.set('zona', v);
    }

    return params;
  }

  function _clientFilter(props) {
    // tipo: client-side subset filter (API only accepts single value)
    if (filterIds.tipo) {
      const tipos = [...document.querySelectorAll(filterIds.tipo + ':checked')].map(c => c.value);
      const total = document.querySelectorAll(filterIds.tipo).length;
      if (tipos.length && tipos.length < total) props = props.filter(p => tipos.includes(p.tipo));
    }
    // adicionales: mode 'every' = AND (all must be present), 'some' = OR (at least one)
    const adics = getAdics();
    if (adics && adics.size) {
      const mode = getAdicsMode ? getAdicsMode() : 'some';
      const matchFn = mode === 'every' ? 'every' : 'some';
      props = props.filter(p => {
        const pa = (p.propiedades_adicionales || []).map(a => a.nombre);
        return [...adics][matchFn](a => pa.includes(a));
      });
    }
    return props;
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  function _render(props) {
    const g = _grid();
    if (!g) return;
    const c = _count();
    if (c) c.textContent = props.length;

    if (!props.length) {
      g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--gray);"><i class="fas fa-search" style="font-size:2rem;opacity:.3;display:block;margin-bottom:1rem;"></i>Sin propiedades con esos filtros.</div>';
      return;
    }

    const buildFn = cardVariant === 'portal' ? _portalCard : _publicCard;
    g.innerHTML = props.map(buildFn).join('');

    // Event delegation replaces per-card inline onclick
    if (g._ch) g.removeEventListener('click', g._ch);
    g._ch = e => {
      // Public: heart icon
      const heart = e.target.closest('.prop-heart');
      if (heart) {
        e.stopPropagation();
        if (onToggleFav) onToggleFav(heart, heart.dataset.code, parseInt(heart.dataset.propid));
        return;
      }
      // Portal: fav button
      const favBtn = e.target.closest('.re-prop-fav');
      if (favBtn) {
        e.stopPropagation();
        if (onToggleFav) onToggleFav(parseInt(favBtn.dataset.propid), favBtn);
        return;
      }
      // Card click → detail modal
      if (onCardClick) {
        const card = e.target.closest('[data-id]');
        if (card && !e.target.closest('.carousel-btn') && !e.target.closest('.c-dot')) {
          const codeEl = card.querySelector('.prop-code,.re-prop-code');
          if (codeEl) onCardClick(codeEl.textContent.trim(), parseInt(card.dataset.id), card);
        }
      }
    };
    g.addEventListener('click', g._ch);

    if (onAfterRender) onAfterRender();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  async function load() {
    const g = _grid();
    if (g) g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--gray);"><i class="fas fa-spinner fa-spin" style="font-size:1.4rem;color:var(--gold);"></i><div style="margin-top:.8rem;font-size:.8rem;">Cargando propiedades...</div></div>';
    try {
      const qs    = _buildParams().toString();
      let props   = await fetch(window.API_URL + '/api/propiedades/public' + (qs ? '?' + qs : '')).then(r => r.json());
      props = _clientFilter(props);
      _data = props;
      _render(props);
    } catch(e) {
      if (g) g.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem;color:#E08080;">Error al cargar propiedades: ${e.message}</div>`;
    }
  }

  function sort(value) {
    if (!_data.length) return;
    let sorted = [..._data];
    if      (value === 'price-asc')  sorted.sort((a, b) => (a.precio||0) - (b.precio||0));
    else if (value === 'price-desc') sorted.sort((a, b) => (b.precio||0) - (a.precio||0));
    else if (value === 'm2-desc')    sorted.sort((a, b) => (b.m2||0)     - (a.m2||0));
    else if (value === 'newest')     sorted.sort((a, b) => b.id          - a.id);
    const g = _grid();
    if (!g) return;
    const buildFn = cardVariant === 'portal' ? _portalCard : _publicCard;
    g.innerHTML = sorted.map(buildFn).join('');
    if (onAfterRender) onAfterRender();
  }

  function getData() { return _data; }

  return { load, sort, getData };
}

// ── Quantity pill helpers (used by real-estate.html and portal-cliente.html) ──

function setPill(btn) {
  const group = btn.closest('.qty-pills');
  if (!group) return;
  group.querySelectorAll('.qty-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const el = document.getElementById(group.dataset.inputId || '');
  if (el) el.value = btn.dataset.val || '';
}

function resetPills(containerSel) {
  document.querySelectorAll((containerSel ? containerSel + ' ' : '') + '.qty-pills').forEach(group => {
    group.querySelectorAll('.qty-pill').forEach((b, i) => b.classList.toggle('active', i === 0));
    const el = document.getElementById(group.dataset.inputId || '');
    if (el) el.value = '';
  });
}
