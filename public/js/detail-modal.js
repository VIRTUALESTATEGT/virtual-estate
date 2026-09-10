'use strict';
/* ── detail-modal.js ─────────────────────────────────────────────────────────
   PropDetail — shared property detail render helpers.
   Used by real-estate.html and portal-cliente.html.
   Requires: disp-badge + detail-spec CSS classes in the host page.
   Expects: window.API_URL defined by the host page before this script loads.
────────────────────────────────────────────────────────────────────────────── */
window.PropDetail = (() => {

  const ADIC_CATS = window.ADIC_CATS;
  const DISP_CLASS = {
    vacia: 'disp-vacia', habitada: 'disp-habitada',
    airbnb: 'disp-airbnb', en_construccion: 'disp-construccion',
  };
  const DISP_LABEL = {
    vacia: 'Disponible', habitada: 'Habitada',
    airbnb: 'Airbnb', en_construccion: 'En construcción',
  };

  // ── Shared lightbox (singleton) ───────────────────────────────────────────
  const _lb = (() => {
    let _el = null, _fotos = [], _idx = 0;

    function _ensure() {
      if (_el) return;
      const s = document.createElement('style');
      s.textContent =
        '#lb-ov{position:fixed;inset:0;background:rgba(0,0,0,.93);z-index:10000;' +
        'display:none;align-items:center;justify-content:center;}' +
        '#lb-ov.open{display:flex;}' +
        '#lb-img{max-width:96vw;max-height:88vh;object-fit:contain;user-select:none;' +
        'border-radius:2px;display:block;}' +
        '.lb-b{position:absolute;background:rgba(13,26,20,.78);' +
        'border:1.5px solid rgba(245,240,232,.22);color:#F5F0E8;border-radius:50%;' +
        'width:48px;height:48px;min-width:48px;min-height:48px;' +
        'display:flex;align-items:center;justify-content:center;' +
        'cursor:pointer;font-size:.9rem;border:none;transition:background .2s;' +
        'z-index:1;-webkit-tap-highlight-color:transparent;}' +
        '.lb-b:hover,.lb-b:active{background:rgba(193,146,89,.85);}' +
        '#lb-close{top:.9rem;right:.9rem;}' +
        '#lb-prev{left:.9rem;top:50%;transform:translateY(-50%);}' +
        '#lb-next{right:.9rem;top:50%;transform:translateY(-50%);}' +
        '@media(max-width:480px){#lb-prev{left:.4rem;}#lb-next{right:.4rem;}.lb-b{width:40px;height:40px;min-width:40px;min-height:40px;font-size:.8rem;}}' +
        '#lb-ctr{position:absolute;bottom:.9rem;left:50%;transform:translateX(-50%);' +
        'font-size:.65rem;color:rgba(245,240,232,.7);background:rgba(13,26,20,.72);' +
        'padding:.22rem .8rem;border-radius:2px;white-space:nowrap;pointer-events:none;}';
      document.head.appendChild(s);

      _el = document.createElement('div');
      _el.id = 'lb-ov';
      _el.innerHTML =
        '<button class="lb-b" id="lb-close" aria-label="Cerrar"><i class="fas fa-times"></i></button>' +
        '<button class="lb-b" id="lb-prev"  aria-label="Anterior"><i class="fas fa-chevron-left"></i></button>' +
        '<img id="lb-img" src="" alt="">' +
        '<button class="lb-b" id="lb-next"  aria-label="Siguiente"><i class="fas fa-chevron-right"></i></button>' +
        '<div id="lb-ctr"></div>';
      document.body.appendChild(_el);

      _el.addEventListener('click', e => { if (e.target === _el) _close(); });
      _el.querySelector('#lb-close').addEventListener('click', _close);
      _el.querySelector('#lb-prev').addEventListener('click',  e => { e.stopPropagation(); _nav(-1); });
      _el.querySelector('#lb-next').addEventListener('click',  e => { e.stopPropagation(); _nav(1); });

      document.addEventListener('keydown', e => {
        if (!_el?.classList.contains('open')) return;
        if (e.key === 'Escape')     _close();
        if (e.key === 'ArrowLeft')  _nav(-1);
        if (e.key === 'ArrowRight') _nav(1);
      });
    }

    function _render() {
      const img  = document.getElementById('lb-img');
      const ctr  = document.getElementById('lb-ctr');
      const prev = document.getElementById('lb-prev');
      const next = document.getElementById('lb-next');
      if (!img) return;
      img.src = _fotos[_idx] || '';
      const multi = _fotos.length > 1;
      if (ctr)  { ctr.textContent = multi ? `${_idx + 1} / ${_fotos.length}` : ''; ctr.style.display = multi ? '' : 'none'; }
      if (prev) prev.style.display = multi ? '' : 'none';
      if (next) next.style.display = multi ? '' : 'none';
    }

    function _nav(dir) {
      if (!_fotos.length) return;
      _idx = (_idx + dir + _fotos.length) % _fotos.length;
      _render();
    }

    function _close() { if (_el) _el.classList.remove('open'); }

    function open(fotos, idx) {
      _ensure();
      _fotos = fotos || [];
      _idx   = _fotos.length ? Math.max(0, Math.min(idx || 0, _fotos.length - 1)) : 0;
      _render();
      _el.classList.add('open');
    }

    return { open };
  })();

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderSpecs(el, p, iconClass) {
    if (!el) return;
    const icon = iconClass || 'fa-home';
    const rows = [];
    if (p.tipo)              rows.push({ i: icon,                t: p.tipo });
    if (p.m2)                rows.push({ i: 'fa-ruler-combined', t: p.m2 + ' m²' });
    if (p.habitaciones)      rows.push({ i: 'fa-bed',            t: p.habitaciones + ' hab.' });
    if (p.banos)             rows.push({ i: 'fa-bath',           t: p.banos + ' baños' });
    if (p.anio_construccion) rows.push({ i: 'fa-calendar-alt',   t: String(p.anio_construccion) });
    el.innerHTML = rows.map(r =>
      `<div class="detail-spec"><i class="fas ${r.i}"></i> ${r.t}</div>`
    ).join('');
  }

  function renderDisp(el, p) {
    if (!el) return;
    const arr = Array.isArray(p.disponibilidad) ? p.disponibilidad : [];
    if (!arr.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML = arr.map(d =>
      `<span class="disp-badge ${DISP_CLASS[d] || ''}">${DISP_LABEL[d] || d}</span>`
    ).join('');
  }

  function renderDesc(descEl, sectionEl, p) {
    if (!sectionEl) return;
    const txt = (p.descripcion || '').trim();
    if (txt) {
      if (descEl) descEl.textContent = txt;
      sectionEl.style.display = '';
    } else {
      sectionEl.style.display = 'none';
    }
  }

  function renderAdics(listEl, sectionEl, p) {
    if (!sectionEl) return;
    const items = p.propiedades_adicionales || [];
    if (!items.length) { sectionEl.style.display = 'none'; return; }
    sectionEl.style.display = '';
    let html = '';
    for (const cat of ADIC_CATS) {
      const catItems = items.filter(a => a.tipo === cat.tipo);
      if (!catItems.length) continue;
      html +=
        `<div style="margin-bottom:.85rem;">` +
        `<div class="detail-section-title" style="margin-top:.6rem;">` +
        `<i class="fas ${cat.icon}" style="margin-right:.35rem;opacity:.8;"></i>${cat.label}</div>` +
        `<div class="detail-checklist">${catItems.map(a =>
          `<div class="detail-check-item"><i class="fas fa-check-circle"></i> ${a.nombre}</div>`
        ).join('')}</div>` +
        `</div>`;
    }
    if (listEl) listEl.innerHTML = html;
  }

  // ── Gallery factory ───────────────────────────────────────────────────────

  function makeGallery({ imgId, phId, navId, counterId }) {
    let _fotos = [], _idx = 0;

    const _imgEl = document.getElementById(imgId);
    if (_imgEl) {
      _imgEl.style.cursor = 'zoom-in';
      _imgEl.addEventListener('click', () => { if (_fotos.length) _lb.open(_fotos, _idx); });
    }

    function _setDisplay() {
      const img = document.getElementById(imgId);
      const ph  = phId      ? document.getElementById(phId)      : null;
      const nav = navId     ? document.getElementById(navId)     : null;
      const ctr = counterId ? document.getElementById(counterId) : null;
      if (!img) return;
      if (_fotos.length) {
        img.src           = _fotos[_idx];
        img.style.display = 'block';
        if (ph)  ph.style.display  = 'none';
        if (nav) nav.style.display = _fotos.length > 1 ? '' : 'none';
        if (ctr) { ctr.textContent = `${_idx + 1} / ${_fotos.length}`; ctr.style.display = _fotos.length > 1 ? '' : 'none'; }
      } else {
        img.style.display = 'none';
        if (ph)  ph.style.display  = 'flex';
        if (nav) nav.style.display = 'none';
        if (ctr) ctr.style.display = 'none';
      }
    }

    function reset() { _fotos = []; _idx = 0; _setDisplay(); }

    function nav(dir) {
      if (!_fotos.length) return;
      _idx = (_idx + dir + _fotos.length) % _fotos.length;
      _setDisplay();
    }

    function load(propId) {
      return fetch(window.API_URL + '/api/propiedades/public/' + propId + '/fotos')
        .then(r => r.ok ? r.json() : [])
        .then(list => { _fotos = list.map(f => f.url); _idx = 0; _setDisplay(); })
        .catch(() => {});
    }

    return { reset, nav, load };
  }

  return { renderSpecs, renderDisp, renderDesc, renderAdics, makeGallery };
})();
