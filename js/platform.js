// Интеграция с Яндекс Играми: SDK, язык, Game Ready API, пауза, сохранения.
// Вне Яндекс Игр (например, на GitHub Pages) всё работает через localStorage.
(function () {
  const TW = window.TW;
  const SAVE_KEY = 'zd-save-v1';

  let ysdk = null;
  let player = null;
  let readySent = false;
  let gameplayWanted = false;
  let gameplayRunning = false;
  const pauseReasons = new Set();
  const listeners = [];

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  }

  function sync() {
    const run = gameplayWanted && pauseReasons.size === 0;
    if (run === gameplayRunning) return;
    gameplayRunning = run;
    try {
      const api = ysdk && ysdk.features && ysdk.features.GameplayAPI;
      if (api) run ? api.start() : api.stop();
    } catch (e) { console.warn('GameplayAPI', e); }
  }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; }
  }

  const Platform = {
    lang: 'ru',
    get isYandex() { return !!ysdk; },

    async init() {
      // SDK подключён тегом из официального источника; инициализируем только внутри iframe платформы
      const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
      if (typeof YaGames !== 'undefined' && inFrame) {
        try {
          ysdk = await withTimeout(YaGames.init(), 8000);
        } catch (e) {
          console.warn('Yandex SDK недоступен', e);
          ysdk = null;
        }
      }
      // Язык — сразу после инициализации, до показа интерфейса
      if (ysdk && ysdk.environment && ysdk.environment.i18n) this.lang = ysdk.environment.i18n.lang || 'ru';
      document.documentElement.lang = 'ru'; // игра переведена только на русский
      if (ysdk) {
        try { player = await withTimeout(ysdk.getPlayer({ scopes: false }), 5000); } catch (e) { player = null; }
      }
    },

    // Сообщаем платформе, что игра загружена (ровно один раз, до включения ввода)
    async ready() {
      if (readySent) return;
      readySent = true;
      try {
        const api = ysdk && ysdk.features && ysdk.features.LoadingAPI;
        if (api) await api.ready();
      } catch (e) { console.warn('LoadingAPI', e); }
    },

    // Идёт ли сейчас активный геймплей (без учёта пауз)
    setGameplay(active) {
      gameplayWanted = !!active;
      sync();
    },

    setPause(reason, on) {
      const had = pauseReasons.has(reason);
      if (on) pauseReasons.add(reason); else pauseReasons.delete(reason);
      if (had !== !!on) listeners.forEach((f) => f());
      sync();
    },
    isPaused(reason) { return reason ? pauseReasons.has(reason) : pauseReasons.size > 0; },
    onPauseChange(f) { listeners.push(f); },

    async load() {
      const local = readLocal();
      if (!player) return local;
      try {
        const cloud = await withTimeout(player.getData(['save']), 4000);
        const c = cloud && cloud.save;
        if (!c) return local;
        if (!local) return c;
        return (c.updated || 0) >= (local.updated || 0) ? c : local;
      } catch (e) {
        return local;
      }
    },

    save(data) {
      data.updated = Date.now();
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
      if (player) {
        try { player.setData({ save: data }).catch(() => {}); } catch (e) { /* ignore */ }
      }
    },
  };

  // Пауза при сворачивании вкладки и потере фокуса
  document.addEventListener('visibilitychange', () => Platform.setPause('hidden', document.hidden));
  window.addEventListener('blur', () => Platform.setPause('blur', true));
  window.addEventListener('focus', () => Platform.setPause('blur', false));

  // Без контекстного меню, выделения, перетаскивания и браузерной прокрутки
  const isFormEl = (t) => t && t.closest && t.closest('input, select, textarea, .scrollable');
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('selectstart', (e) => { if (!isFormEl(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (!isFormEl(e.target)) e.preventDefault(); }, { passive: false });
  window.addEventListener('wheel', (e) => { if (!isFormEl(e.target)) e.preventDefault(); }, { passive: false });
  document.addEventListener('keydown', (e) => {
    if (isFormEl(e.target)) return;
    if ([' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  });

  TW.Platform = Platform;
})();
