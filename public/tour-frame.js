/* ── Virtual Estate – tour brand frame runtime ──────────────────────────── */
(function () {
  'use strict';

  var LOGO_WHITE = '/media/logo-ve-blanco.png';
  var LOGO_TILE  = '/media/logo-ve-tile.png';
  var COPY       = '© Virtual Estate GT · Prohibida su reproducción';

  /* ── watermark overlay ────────────────────────────────────────────────── */
  function _makeWm() {
    var wm = document.createElement('div');
    wm.className = 've-tour-wm';
    wm.setAttribute('data-ve-wm', '1');
    wm.setAttribute('aria-hidden', 'true');

    var tile = document.createElement('div');
    tile.className = 've-tour-wm-tile';
    tile.style.backgroundImage = 'url(' + LOGO_TILE + ')';

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
    /* Move frame to document.body to escape any transform-containing ancestor.
       CSS position:fixed is relative to the nearest transformed ancestor, not the
       viewport, so a parent with transform:translateY(0) would confine the frame. */
    if (!frame._vePlaceholder) {
      var ph = document.createComment('ve-tour-ph');
      frame.parentNode.insertBefore(ph, frame);
      frame._vePlaceholder = ph;
      document.body.appendChild(frame);
    }

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

    _iosCloseBtn.onclick = function () { _iosExit(frame, stage); };

    /* Esc key exits iOS fullscreen */
    function _escHandler(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        _iosExit(frame, stage);
        document.removeEventListener('keydown', _escHandler);
        frame._iosEscHandler = null;
      }
    }
    if (frame._iosEscHandler) {
      document.removeEventListener('keydown', frame._iosEscHandler);
    }
    frame._iosEscHandler = _escHandler;
    document.addEventListener('keydown', _escHandler);
  }

  function _iosExit(frame, stage) {
    frame.classList.remove('ve-tour-ios-full');
    /* restore frame to its original DOM position using the saved placeholder */
    if (frame._vePlaceholder) {
      var ph = frame._vePlaceholder;
      ph.parentNode.insertBefore(frame, ph);
      ph.parentNode.removeChild(ph);
      frame._vePlaceholder = null;
    }
    document.body.style.overflow = '';
    if (_iosCloseBtn && _iosCloseBtn.parentNode) _iosCloseBtn.parentNode.removeChild(_iosCloseBtn);
    if (frame._iosEscHandler) {
      document.removeEventListener('keydown', frame._iosEscHandler);
      frame._iosEscHandler = null;
    }
    /* fire caller-supplied callback (e.g. destroy iframe and restore poster) */
    if (typeof frame._veOnMobileExit === 'function') {
      var cb = frame._veOnMobileExit;
      frame._veOnMobileExit = null;
      cb();
    }
  }

  /* ── fullscreen button ────────────────────────────────────────────────── */
  function _makeFsBtn(frame, stage) {
    var btn = document.createElement('button');
    btn.className = 've-tour-fs-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Pantalla completa');
    btn.innerHTML = '<i class="fas fa-expand"></i>';

    function _tryNative() {
      var el  = frame;
      var req = el.requestFullscreen || el.webkitRequestFullscreen
              || el.mozRequestFullScreen || el.msRequestFullscreen;
      if (req) {
        var r = req.call(el);
        if (r && r.catch) r.catch(function () { _iosEnter(frame, stage); });
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
    function _fsHandler() {
      var inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      btn.innerHTML = inFs ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
    }
    document.addEventListener('fullscreenchange',        _fsHandler);
    document.addEventListener('webkitfullscreenchange',  _fsHandler);

    /* stored so veUnwrapTour can remove them */
    btn._cleanupFsListeners = function () {
      document.removeEventListener('fullscreenchange',       _fsHandler);
      document.removeEventListener('webkitfullscreenchange', _fsHandler);
    };

    return btn;
  }

  /* ── anti-tamper: MutationObserver ───────────────────────────────────── */
  function _watchWm(stage) {
    if (!window.MutationObserver) return { disconnect: function () {} };

    var obs;

    function _doRestore() {
      obs.disconnect();                                    /* pause before touching DOM */
      var old = stage.querySelector('[data-ve-wm]');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      stage.appendChild(_makeWm());
      _attach();                                           /* resume observation */
    }

    function _attach() {
      obs = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          /* wm removed from stage */
          if (m.type === 'childList' && m.target === stage) {
            if (!stage.querySelector('[data-ve-wm]')) { _doRestore(); return; }
          }
          /* corner (or other child) removed from wm */
          if (m.type === 'childList' && m.target && m.target.getAttribute
              && m.target.getAttribute('data-ve-wm') === '1') {
            _doRestore(); return;
          }
          /* attribute tampered on wm or corner (style / class / hidden) */
          if (m.type === 'attributes') { _doRestore(); return; }
        }
      });
      obs.observe(stage, { childList: true });
      var wm = stage.querySelector('[data-ve-wm]');
      if (wm) {
        obs.observe(wm, {
          attributes: true,
          attributeFilter: ['style', 'class', 'hidden'],
          childList: true,
        });
        var corner = wm.querySelector('.ve-tour-wm-corner');
        if (corner) {
          obs.observe(corner, {
            attributes: true,
            attributeFilter: ['style', 'class', 'hidden'],
          });
        }
      }
    }

    _attach();
    return { disconnect: function () { if (obs) obs.disconnect(); } };
  }

  /* ── veUnwrapTour ─────────────────────────────────────────────────────── */
  window.veUnwrapTour = function (frame) {
    if (!frame || !frame.classList.contains('ve-tour-frame')) return;

    /* run all stored cleanup (fs listeners + wm observer) */
    if (typeof frame._veCleanup === 'function') frame._veCleanup();

    /* disarm mobile-exit callback to prevent re-entry if called from outside _iosExit */
    frame._veOnMobileExit = null;

    /* exit iOS fullscreen if still active */
    if (frame.classList.contains('ve-tour-ios-full')) {
      frame.classList.remove('ve-tour-ios-full');
      document.body.style.overflow = '';
      if (_iosCloseBtn && _iosCloseBtn.parentNode) _iosCloseBtn.parentNode.removeChild(_iosCloseBtn);
      if (frame._iosEscHandler) {
        document.removeEventListener('keydown', frame._iosEscHandler);
        frame._iosEscHandler = null;
      }
    }

    /* if frame was moved to body to escape a transform ancestor, restore it first
       so the subsequent stageEl re-insertion goes back to the correct parent */
    if (frame._vePlaceholder) {
      var ph = frame._vePlaceholder;
      ph.parentNode.insertBefore(frame, ph);
      ph.parentNode.removeChild(ph);
      frame._vePlaceholder = null;
    }

    var stageEl = frame.querySelector('[data-ve-stage]');
    if (stageEl && frame.parentNode) {
      /* remove ve-injected overlays */
      var wm    = stageEl.querySelector('[data-ve-wm]');
      var fsBtn = stageEl.querySelector('.ve-tour-fs-btn');
      if (wm)    stageEl.removeChild(wm);
      if (fsBtn) stageEl.removeChild(fsBtn);
      /* clear wrapped flag on iframe so it can be re-wrapped later */
      var fr = stageEl.querySelector('iframe[data-ve-wrapped]');
      if (fr) delete fr.dataset.veWrapped;
      stageEl.removeAttribute('data-ve-stage');
      /* move stageEl back to its original parent (before frame) */
      frame.parentNode.insertBefore(stageEl, frame);
    }

    /* remove the frame div (bar goes with it) */
    if (frame.parentNode) frame.parentNode.removeChild(frame);
  };

  /* ── veWrapTour ───────────────────────────────────────────────────────── */
  window.veWrapTour = function (iframe, opts) {
    if (!iframe || iframe.dataset.veWrapped) return;
    opts = opts || {};
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
    var fsBtn = _makeFsBtn(frame, stage);
    stage.appendChild(fsBtn);
    frame.appendChild(_makeBar());

    /* guard against watermark removal / attribute tampering */
    var wmWatch = _watchWm(stage);

    /* store cleanup so veUnwrapTour can release everything */
    frame._veCleanup = function () {
      if (fsBtn._cleanupFsListeners) fsBtn._cleanupFsListeners();
      wmWatch.disconnect();
    };

    /* mobile: enter full-screen NOW so iframe has its final size when src loads */
    if (opts.onMobileExit) frame._veOnMobileExit = opts.onMobileExit;
    if (opts.startFullOnMobile) {
      var isMobile = window.matchMedia('(max-width:767px),(pointer:coarse)').matches;
      if (isMobile) _iosEnter(frame, stage);
    }
  };
}());
