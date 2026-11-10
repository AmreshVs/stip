// window.stip for the Tauri app: the same calls the Electron preload gave the
// pages, on top of Tauri's invoke and events. Injected before page scripts.
(() => {
  const T = window.__TAURI__;
  if (!T || window.stip) return;
  const { invoke } = T.core;
  const me = T.webviewWindow.getCurrentWebviewWindow();

  window.stip = {
    getState: () => invoke('state'),
    getReport: () => invoke('report'),
    act: (name, payload) => {
      invoke('act', { name, payload: payload ?? null }).catch((err) => console.error('stip act', name, err));
    },
    onState: (cb) => {
      me.listen('state', (event) => cb(event.payload));
    },
    // A window's first "show" may be sent before the page is listening, so
    // it waits in the app until the page asks for it.
    onShow: (cb) => {
      me.listen('show', (event) => cb(event.payload));
      invoke('pending_show').then((data) => {
        if (data !== null && data !== undefined) cb(data);
      });
    },
  };

  const ready = (fn) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  };

  // WebKit and WebView2 ignore -webkit-app-region, so drag the window from
  // the same places the stylesheets mark.
  const DRAG = '.drag, .head';
  const NO_DRAG = '.actions, button, a, input, select, textarea, label, [role="button"]';
  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || !event.target.closest) return;
    if (!event.target.closest(DRAG) || event.target.closest(NO_DRAG)) return;
    me.startDragging().catch(() => {});
  });

  // The water window lets clicks through everywhere but its buttons. Tauri
  // can't forward mouse moves to an ignoring window, so the page tells the app
  // where the clickable parts are, and the app watches the pointer.
  if (location.pathname.includes('/water/')) {
    ready(() => {
      let last = '';
      const entered = new Set();
      const report = () => {
        const rects = [...document.querySelectorAll('.interactive')]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
        const key = JSON.stringify(rects);
        if (key !== last) {
          last = key;
          invoke('water_hit', { rects }).catch(() => {});
        }
      };
      document.addEventListener('mouseenter', (e) => e.target.classList?.contains('interactive') && entered.add(e.target), true);
      document.addEventListener('mouseleave', (e) => entered.delete(e.target), true);
      // Once clicks pass through again the page never hears the pointer
      // leave, so the app says so and the page gets its mouseleave.
      me.listen('pointer', ({ payload }) => {
        if (payload.over) return;
        for (const el of [...entered]) {
          entered.delete(el);
          el.dispatchEvent(new MouseEvent('mouseleave'));
        }
      });
      report();
      setInterval(report, 150);
    });
  }
})();
