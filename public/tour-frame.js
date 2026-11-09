/* ── Virtual Estate – tour brand frame runtime ──────────────────────────── */
(function () {
  'use strict';

  var LOGO_WHITE = '/media/logo-ve-blanco.png';
  var LOGO_GRAY  = '/media/logo-ve-gris.png';
  var COPY       = '© Virtual Estate Guatemala';

  /* ── watermark overlay ────────────────────────────────────────────────── */
  function _makeWm() {
    var wm   = document.createElement('div');
    wm.className = 've-tour-wm';
    wm.setAttribute('data-ve-wm', '1');
    wm.setAttribute('aria-hidden', 'true');

    var tile = document.createElement('div');
    tile.className = 've-tour-wm-tile';
    tile.style.backgroundImage = 'url(' + LOGO_GRAY + ')';

    var corner = document.createElement('img');
    corner.className = 've-tour-wm-corner';
    corner.src = LOGO_WHITE;
    corner.alt = '';
    corner.setAttribute('aria-hidden', 'true');

    wm.appendChild(tile);
    wm.appendChild(corner);
    return wm;
  }

  /* ── brand bar ────────────────────────────────────────────────────────── */
  function _makeBar() {
    var bar  = document.createElement('div');
    bar.className = 've-tour-bar';

    var logo = document.createElement('img');
    logo.src = LOGO_WHITE;
    logo.alt = 'Virtual Estate';

    var copy = document.createElement('span');
    copy.className = 've-tour-bar-copy';
    copy.textContent = COPY;

    bar.appendChild(logo);
    bar.appendChild(copy);
    return bar;
  }

  /* ── iOS / no-API fullscreen ─────────────────────────────────────────── */
  var _iosCloseBtn = null;

  function _iosEnter(frame, stage) {
    frame.classList.add('ve-tour-ios-full');
    document.body.style.overflow = 'hidden';

    if (!_iosCloseBtn) {
      _iosCloseBtn = document.createElement('button');
      _iosCloseBtn.className = 've-tour-ios-close';
      _iosCloseBtn.type = 'button';
      _iosCloseBtn.setAttribute('aria-label', 'Cerrar pantalla completa');
      _iosCloseBtn.innerHTML = '&times;';
    }
    document.body.appendChild(_iosCloseBtn);

    _iosCloseBtn.onclick = function () {
      _iosExit(frame, stage);
    };
  }

  function _iosExit(frame, stage) {
    frame.classList.remove('ve-tour-ios-full');
    document.body.style.overflow = '';
    if (_iosCloseBtn && _iosCloseBtn.parentNode) _iosCloseBtn.parentNode.removeChild(_iosCloseBtn);
  }

  /* ── fullscreen button ────────────────────────────────────────────────── */
  function _makeFsBtn(frame, stage) {
    var btn = document.createElement('button');
    btn.className = 've-tour-fs-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Pantalla completa');
    btn.innerHTML = '<i class="fas fa-expand"></i>';

    function _tryNative() {
      var el = frame;
      var req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
      if (req) {
        req.call(el).catch(function () { _iosEnter(frame, stage); });
        return true;
      }
      return false;
    }

    btn.addEventListener('click', function () {
      var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      if (isIOS) {
        _iosEnter(frame, stage);
      } else if (!_tryNative()) {
        _iosEnter(frame, stage);
      }
    });

    /* update icon on native fullscreen change */
    document.addEventListener('fullscreenchange', function () {
      var inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      btn.innerHTML = inFs ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
    });
    document.addEventListener('webkitfullscreenchange', function () {
      var inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      btn.innerHTML = inFs ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
    });

    return btn;
  }

  /* ── anti-tamper: MutationObserver ───────────────────────────────────── */
  function _watchWm(stage) {
    if (!window.MutationObserver) return;

    function _restore() {
      /* check if watermark is missing */
      if (!stage.querySelector('[data-ve-wm]')) {
        stage.appendChild(_makeWm());
        _watch(); /* re-attach observer */
      }
    }

    var obs;
    function _watch() {
      if (obs) obs.disconnect();
      obs = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].removedNodes.length) { _restore(); return; }
        }
        /* attribute change on the wm itself */
        var wm = stage.querySelector('[data-ve-wm]');
        if (wm) {
          obs.observe(wm, { attributes: true, attributeFilter: ['style', 'class'] });
        }
      });
      obs.observe(stage, { childList: true });
      var wm = stage.querySelector('[data-ve-wm]');
      if (wm) obs.observe(wm, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    _watch();
  }

  /* ── main export ──────────────────────────────────────────────────────── */
  window.veWrapTour = function (iframe) {
    if (!iframe || iframe.dataset.veWrapped) return;
    iframe.dataset.veWrapped = '1';

    /* strip native fullscreen capability from the iframe */
    var allow = (iframe.getAttribute('allow') || '')
      .replace(/\bfullscreen\b\s*;?\s*/gi, '')
      .trim().replace(/;$/, '').trim();
    if (allow) iframe.setAttribute('allow', allow);
    else        iframe.removeAttribute('allow');
    iframe.removeAttribute('allowfullscreen');

    var stage = iframe.parentElement;
    stage.setAttribute('data-ve-stage', '1');

    /* create outer frame and rewire DOM */
    var frame = document.createElement('div');
    frame.className = 've-tour-frame';
    stage.parentNode.insertBefore(frame, stage);
    frame.appendChild(stage);

    /* add watermark, fullscreen button, brand bar */
    stage.appendChild(_makeWm());
    stage.appendChild(_makeFsBtn(frame, stage));
    frame.appendChild(_makeBar());

    /* guard against watermark removal */
    _watchWm(stage);
  };
}());
