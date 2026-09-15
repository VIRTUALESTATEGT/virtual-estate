'use strict';
/* ── adic-modal.js ─────────────────────────────────────────────────────────
   AdicModal — shared adicionales filter modal renderer.
   Requires: catalog.css, window.ADIC_CATS loaded before this script.
   Exposes: window.AdicModal.{ render, toggleAcc, onSearch, syncCounts }

   Both pages call AdicModal.render() from their own _renderAdicModal() and
   keep their own apply / close / chips logic (they trigger different searches).

   Checkbox onchange always calls: actualizarAdic(this.value, this.checked, this.closest('label'))
   Both pages must expose actualizarAdic with that signature.
────────────────────────────────────────────────────────────────────────────── */
window.AdicModal = (() => {

  function _checkHtml(a, selectedSet) {
    const safe = a.nombre.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    const sel  = selectedSet.has(a.nombre);
    return `<label class="adic-check${sel?' selected':''}" data-nombre="${safe}">` +
      `<input type="checkbox"${sel?' checked':''} value="${safe}" ` +
      `onchange="actualizarAdic(this.value,this.checked,this.closest('label'))"> ${a.nombre}` +
      `</label>`;
  }

  // ── Main render ───────────────────────────────────────────────────────────
  function render(containerId, catalog, cats, selectedSet, mode) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Mode toggle (initial state baked in to avoid flicker)
    const isSome = mode !== 'every';
    const modeHtml =
      `<div style="display:flex;border:1px solid var(--border);border-radius:var(--r);overflow:hidden;margin-bottom:1.2rem;">` +
        `<button id="adic-mode-some" onclick="setAdicionalesMode('some')" ` +
          `style="flex:1;padding:.42rem .5rem;font-size:.67rem;letter-spacing:.06em;` +
          `border:none;border-right:1px solid var(--border);cursor:pointer;` +
          `transition:.15s;font-family:inherit;` +
          `background:${isSome?'var(--gold)':'transparent'};` +
          `color:${isSome?'var(--bg)':'var(--gray)'};">Alguna de estas</button>` +
        `<button id="adic-mode-every" onclick="setAdicionalesMode('every')" ` +
          `style="flex:1;padding:.42rem .5rem;font-size:.67rem;letter-spacing:.06em;` +
          `border:none;cursor:pointer;transition:.15s;font-family:inherit;` +
          `background:${isSome?'transparent':'var(--gold)'};` +
          `color:${isSome?'var(--gray)':'var(--bg)'};">Todas estas</button>` +
      `</div>`;

    // Search
    const searchHtml =
      `<div class="adic-search">` +
        `<i class="fas fa-search"></i>` +
        `<input type="text" placeholder="Buscar característica..." ` +
          `oninput="AdicModal.onSearch('${containerId}',this.value)">` +
      `</div>`;

    // Destacadas section (items with destacado=true from the catalog)
    const destacadas = (catalog || []).filter(a => a.destacado);
    const destHtml = destacadas.length
      ? `<div class="adic-dest-sect">` +
          `<div class="adic-dest-sect-title"><i class="fas fa-star"></i> Más buscadas</div>` +
          `<div class="adic-grid">${destacadas.map(a => _checkHtml(a, selectedSet)).join('')}</div>` +
        `</div>`
      : '';

    // Accordion categories
    const byTipo = {};
    (catalog || []).forEach(a => { (byTipo[a.tipo] = byTipo[a.tipo] || []).push(a); });

    const catsHtml = cats.map(cat => {
      const items = byTipo[cat.tipo] || [];
      if (!items.length) return '';
      const selCount = items.filter(a => selectedSet.has(a.nombre)).length;
      return `<div class="adic-acc-item" data-tipo="${cat.tipo}">` +
        `<div class="adic-acc-head${selCount?' has-sel':''}" onclick="AdicModal.toggleAcc(this)">` +
          `<i class="fas ${cat.icon} adic-acc-icon"></i>` +
          `<span class="adic-acc-label">${cat.label}</span>` +
          `<span class="adic-acc-count${selCount?' sel':''}" id="${containerId}-cnt-${cat.tipo}">` +
            `${selCount ? selCount+' sel.' : items.length+' opciones'}` +
          `</span>` +
          `<i class="fas fa-chevron-down adic-acc-chevron"></i>` +
        `</div>` +
        `<div class="adic-acc-body">` +
          `<div class="adic-grid">${items.map(a => _checkHtml(a, selectedSet)).join('')}</div>` +
        `</div>` +
      `</div>`;
    }).filter(Boolean).join('');

    container.innerHTML = modeHtml + searchHtml + destHtml + catsHtml;
  }

  // ── Accordion toggle ──────────────────────────────────────────────────────
  function toggleAcc(headEl) {
    headEl.closest('.adic-acc-item').classList.toggle('open');
  }

  // ── Real-time search ──────────────────────────────────────────────────────
  function onSearch(containerId, query) {
    const q = query.trim().toLowerCase();
    const container = document.getElementById(containerId);
    if (!container) return;

    // Destacadas section
    const destSect = container.querySelector('.adic-dest-sect');
    if (destSect) {
      let destVis = 0;
      destSect.querySelectorAll('.adic-check').forEach(l => {
        const match = !q || (l.dataset.nombre || '').toLowerCase().includes(q);
        l.style.display = match ? '' : 'none';
        if (match) destVis++;
      });
      destSect.style.display = (destVis || !q) ? '' : 'none';
    }

    // Accordion categories
    container.querySelectorAll('.adic-acc-item').forEach(item => {
      let vis = 0;
      item.querySelectorAll('.adic-check').forEach(l => {
        const match = !q || (l.dataset.nombre || '').toLowerCase().includes(q);
        l.style.display = match ? '' : 'none';
        if (match) vis++;
      });
      item.style.display = vis ? '' : 'none';
      if (q && vis)  item.classList.add('open');
      else if (!q)   item.classList.remove('open');
    });
  }

  // ── Sync category count badges ────────────────────────────────────────────
  function syncCounts(containerId, selectedSet, catalog, cats) {
    const byTipo = {};
    (catalog || []).forEach(a => { (byTipo[a.tipo] = byTipo[a.tipo] || []).push(a); });
    cats.forEach(cat => {
      const items     = byTipo[cat.tipo] || [];
      const selCount  = items.filter(a => selectedSet.has(a.nombre)).length;
      const countEl   = document.getElementById(`${containerId}-cnt-${cat.tipo}`);
      if (countEl) {
        countEl.textContent = selCount ? selCount + ' sel.' : items.length + ' opciones';
        countEl.className   = 'adic-acc-count' + (selCount ? ' sel' : '');
      }
      const head = document.querySelector(
        `#${containerId} .adic-acc-item[data-tipo="${cat.tipo}"] .adic-acc-head`
      );
      if (head) head.classList.toggle('has-sel', selCount > 0);
    });
  }

  return { render, toggleAcc, onSearch, syncCounts };
})();
