// Запуск игры, главное меню, игровой цикл и управление
(function () {
  const TW = window.TW;
  const Platform = TW.Platform;
  const $ = (id) => document.getElementById(id);
  const canvas = $('map');

  const SIZES = { s: [320, 200], m: [480, 300], l: [640, 400] };
  const COLORS = [
    [150, 80, 220], [60, 120, 235], [40, 170, 150], [70, 170, 70],
    [230, 170, 40], [235, 110, 40], [215, 60, 70], [220, 80, 170],
  ];
  const DIFF_HINTS = {
    easy: 'Соперники растут медленнее и реже нападают.',
    normal: 'Честная борьба: соперники растут так же, как вы.',
    hard: 'Соперники агрессивнее, чаще нападают на вас и объединяются против лидера.',
  };
  const DEFAULT_SAVE = {
    options: { name: 'Моя держава', bots: 30, size: 'm', diff: 'normal', color: 0 },
    stats: { games: 0, wins: 0, best: 0, kills: 0 },
  };

  let save = JSON.parse(JSON.stringify(DEFAULT_SAVE));
  let mode = 'loading'; // loading | menu | game
  let game = null, renderer = null, ui = null;
  let speed = 1, acc = 0, last = performance.now(), lastUi = 0;
  let endShown = false;
  let inputEnabled = false;

  // ---------- Запуск ----------

  async function boot() {
    await Platform.init(); // SDK и язык — до показа любого интерфейса
    const loaded = await Platform.load();
    if (loaded) {
      save.options = Object.assign({}, DEFAULT_SAVE.options, loaded.options);
      save.stats = Object.assign({}, DEFAULT_SAVE.stats, loaded.stats);
    }
    buildMenu();
    startDemo();
    driveDemoCamera(performance.now());
    renderer.draw(performance.now());
    await new Promise((r) => setTimeout(r, 30));

    await Platform.ready(); // игра загружена — только после этого включаем ввод
    inputEnabled = true;
    $('splash').classList.add('fade');
    setTimeout(() => { $('splash').hidden = true; }, 500);
    showMenu();
  }

  // ---------- Главное меню ----------

  function buildMenu() {
    const o = save.options;
    $('optName').value = o.name;
    $('optBots').value = o.bots;
    $('optBotsVal').textContent = o.bots;

    const colors = $('colors');
    colors.innerHTML = COLORS.map((c, k) => `<button data-k="${k}" style="background:rgb(${c})" aria-label="Цвет ${k + 1}"></button>`).join('');
    const markColor = () => colors.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.k === o.color));
    colors.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      o.color = +b.dataset.k;
      markColor();
    };
    markColor();

    const seg = (id, key, after) => {
      const el = $(id);
      const mark = () => {
        el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === o[key]));
        if (after) after();
      };
      el.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        o[key] = b.dataset.v;
        mark();
      };
      mark();
    };
    seg('optDiff', 'diff', () => { $('diffHint').textContent = DIFF_HINTS[o.diff] || ''; });
    seg('optSize', 'size');

    $('optBots').oninput = () => { o.bots = +$('optBots').value; $('optBotsVal').textContent = o.bots; };
    $('playBtn').onclick = () => inputEnabled && startGame();
    $('helpBtn').onclick = () => { $('helpModal').hidden = false; };
    $('helpModal').onclick = (e) => { if (e.target.id === 'helpModal' || e.target.closest('[data-close]')) $('helpModal').hidden = true; };
  }

  function updateStats() {
    const s = save.stats;
    $('stGames').textContent = s.games;
    $('stWins').textContent = s.wins;
    $('stBest').textContent = Math.round(s.best * 100) + '%';
    $('stKills').textContent = s.kills;
  }

  function startDemo() {
    const [W, H] = SIZES.s;
    game = new TW.Game({
      W, H, demo: true,
      seed: (Math.random() * 2 ** 31) | 0,
      bots: 26, difficulty: 'normal', spawnSeconds: 0.1, winShare: 1,
    });
    renderer = new TW.Renderer(canvas, game);
    ui = null;
    speed = 2;
    acc = 0;
    // Пропускаем начало, чтобы на фоне меню уже были державы
    for (let t = 0; t < 250; t++) game.update();
    game.events.length = 0;
    renderer.flush();
    renderer.computeLabels();
  }

  function showMenu() {
    mode = 'menu';
    Platform.setGameplay(false);
    $('hud').hidden = true;
    $('endScreen').hidden = true;
    $('confirmModal').hidden = true;
    $('menu').hidden = false;
    $('pausedLabel').hidden = true;
    updateStats();
    if (!game || !game.cfg.demo) startDemo();
  }

  function startGame() {
    const o = save.options;
    o.name = $('optName').value.trim() || 'Моя держава';
    Platform.save(save);

    const [W, H] = SIZES[o.size] || SIZES.m;
    game = new TW.Game({
      W, H,
      seed: (Math.random() * 2 ** 31) | 0,
      bots: o.bots,
      playerName: o.name,
      playerColor: COLORS[o.color] || COLORS[0],
      difficulty: o.diff,
      spawnSeconds: 12,
      winShare: 0.8,
    });
    renderer = new TW.Renderer(canvas, game);
    ui = new TW.UI(game, (id) => game && game.retreat(id));
    if (window.innerWidth < 600) {
      $('leaderboard').classList.add('collapsed');
      $('lbToggle').textContent = '+';
    }
    mode = 'game';
    speed = 1;
    acc = 0;
    endShown = false;
    Platform.setPause('user', false);
    $('speedBtn').textContent = 'x1';
    $('menu').hidden = true;
    $('hud').hidden = false;
    ui.update(performance.now());
    updatePauseUi();
    syncGameplay();
  }

  function syncGameplay() {
    Platform.setGameplay(mode === 'game' && !!game && !game.result && $('confirmModal').hidden);
  }

  function finishGame() {
    const h = game.human, land = game.map.landCount;
    const s = save.stats;
    s.games++;
    if (game.result.win) s.wins++;
    s.best = Math.max(s.best, h.maxTiles / land);
    s.kills += h.kills;
    Platform.save(save);

    const secs = Math.floor(game.playTick / TW.TPS);
    const time = `${Math.floor(secs / 60)} мин ${secs % 60} с`;
    $('endTitle').textContent = game.result.win ? 'Победа!' : 'Поражение';
    $('endText').textContent = game.result.win
      ? `Держава «${h.name}» заняла ${Math.round((h.tiles / land) * 100)}% суши за ${time}. Покорено держав: ${h.kills}.`
      : `Держава «${h.name}» пала через ${time}. Наибольшая территория: ${((h.maxTiles / land) * 100).toFixed(1)}%. Покорено держав: ${h.kills}.`;
    $('endScreen').hidden = false;
    syncGameplay();
  }

  // ---------- Кнопки интерфейса ----------

  $('againBtn').onclick = showMenu;
  $('watchBtn').onclick = () => { $('endScreen').hidden = true; };
  $('exitBtn').onclick = () => {
    if (game && game.result) { showMenu(); return; }
    $('confirmModal').hidden = false;
    syncGameplay();
  };
  $('confirmNo').onclick = () => { $('confirmModal').hidden = true; syncGameplay(); };
  $('confirmYes').onclick = showMenu;
  $('pauseBtn').onclick = togglePause;
  $('speedBtn').onclick = () => {
    speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
    $('speedBtn').textContent = 'x' + speed;
  };
  $('centerBtn').onclick = centerOnHuman;
  $('lbToggle').onclick = () => {
    const lb = $('leaderboard');
    lb.classList.toggle('collapsed');
    $('lbToggle').textContent = lb.classList.contains('collapsed') ? '+' : '–';
  };

  function togglePause() {
    if (mode !== 'game') return;
    Platform.setPause('user', !Platform.isPaused('user'));
  }

  function updatePauseUi() {
    $('pauseBtn').textContent = Platform.isPaused('user') ? '▶' : '❚❚';
    $('pausedLabel').hidden = !(mode === 'game' && Platform.isPaused());
  }
  Platform.onPauseChange(updatePauseUi);

  function centerOnHuman() {
    if (mode !== 'game' || !renderer) return;
    const h = game.human;
    if (h.tiles > 0) {
      const L = renderer.labels.find((l) => l.p === h);
      const x = L ? L.x : h.sx / h.tiles, y = L ? L.y : h.sy / h.tiles;
      const scale = Math.max(renderer.cam.scale, Math.min(renderer.cw, renderer.ch) / (Math.sqrt(h.tiles) * 5 + 40));
      renderer.focus(x, y, scale);
    }
  }

  // ---------- Игровой цикл ----------

  function loop(now) {
    const dt = Math.min(250, now - last);
    last = now;
    if (game && renderer) {
      const running = mode === 'menu' || mode === 'loading'
        ? !Platform.isPaused('hidden')
        : !Platform.isPaused() && $('endScreen').hidden && $('confirmModal').hidden;
      if (running) {
        acc += dt * speed;
        const step = 1000 / TW.TPS;
        let n = 0;
        while (acc >= step && n < 16) { game.update(); acc -= step; n++; }
        if (n >= 16) acc = 0;
      }

      if (mode !== 'game') {
        driveDemoCamera(now);
        game.events.length = 0;
        const alive = game.players.reduce((k, p) => k + (p.alive ? 1 : 0), 0);
        if (alive <= 4 || game.playTick > 3000) startDemo();
      }

      renderer.flush();
      renderer.draw(now);

      if (mode === 'game') {
        while (game.events.length) {
          const e = game.events.shift();
          ui.toast(e.text, e.cls);
          if (e.focus) centerOnHuman();
        }
        if (now - lastUi > 100) {
          lastUi = now;
          ui.update(now);
          if (hover.tile >= 0 && !drag.active) ui.showTooltip(hover.x, hover.y, hover.tile);
        }
        if (game.result && !endShown) {
          endShown = true;
          finishGame();
        }
      }
    }
    requestAnimationFrame(loop);
  }

  // Медленный облёт карты за меню
  function driveDemoCamera(now) {
    const r = renderer, g = game, t = now / 1000;
    const cover = Math.min(Math.max(r.cw / g.W, r.ch / g.H) * 1.12, Math.min(r.cw / g.W, r.ch / g.H) * 2.2);
    r.cam.scale = cover;
    const spanX = Math.max(0, g.W / 2 - r.cw / 2 / cover);
    const spanY = Math.max(0, g.H / 2 - r.ch / 2 / cover);
    r.cam.x = g.W / 2 + Math.sin(t * 0.05) * spanX;
    r.cam.y = g.H / 2 + Math.sin(t * 0.037 + 1) * spanY;
    r.hoverTile = -1;
  }

  // ---------- Управление мышью / касанием ----------

  const pointers = new Map();
  const drag = { active: false, startX: 0, startY: 0, lastX: 0, lastY: 0, pinchDist: 0 };
  const hover = { x: 0, y: 0, tile: -1 };
  const playing = () => inputEnabled && mode === 'game' && game && renderer;

  canvas.addEventListener('pointerdown', (e) => {
    if (!playing()) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      drag.active = false;
      drag.startX = drag.lastX = e.clientX;
      drag.startY = drag.lastY = e.clientY;
      drag.button = e.button;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      drag.active = true;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!playing()) return;
    hover.x = e.clientX;
    hover.y = e.clientY;
    const tile = renderer.tileAt(e.clientX, e.clientY);
    hover.tile = e.pointerType === 'mouse' ? tile : -1;
    renderer.hoverTile = hover.tile;

    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (drag.pinchDist > 0) renderer.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / drag.pinchDist);
        drag.pinchDist = d;
        return;
      }
      if (!drag.active && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 8) {
        drag.active = true;
        canvas.classList.add('dragging');
        ui.hideTooltip();
      }
      if (drag.active) {
        renderer.pan(e.clientX - drag.lastX, e.clientY - drag.lastY);
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
      }
    } else if (e.pointerType === 'mouse') {
      ui.showTooltip(e.clientX, e.clientY, tile);
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (!drag.active && playing() && drag.button === 0 && e.type === 'pointerup') {
        handleClick(renderer.tileAt(e.clientX, e.clientY));
      }
      drag.active = false;
      drag.pinchDist = 0;
      canvas.classList.remove('dragging');
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { hover.tile = -1; if (renderer) renderer.hoverTile = -1; if (ui) ui.hideTooltip(); });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!playing()) return;
    renderer.zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY));
  }, { passive: false });

  function handleClick(tile) {
    if (tile < 0) return;
    const g = game, W = g.W;
    if (g.phase === 'spawn') {
      if (!g.humanSpawn(tile % W, (tile / W) | 0)) {
        ui.toast(g.map.terrain[tile] === 0 ? 'Нельзя начать на воде' : 'Эта земля уже занята', 'bad');
      }
      return;
    }
    if (!g.human.alive || Platform.isPaused()) return;
    if (g.map.terrain[tile] === 0) return;
    const target = g.owner[tile];
    if (target === g.human.id) return;
    const res = g.launchAttack(g.human.id, target, g.human.troops * ui.ratio);
    if (res === 'nocontact') ui.toast(target < 0 ? 'Эта земля не граничит с вами' : `Нет общей границы: ${g.players[target].name}`, 'bad');
    else if (res === 'notroops') ui.toast('Недостаточно войск', 'bad');
  }

  window.addEventListener('keydown', (e) => {
    if (!playing() || e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') togglePause();
    else if (e.code === 'KeyC') centerOnHuman();
    else if (e.code === 'Escape') $('exitBtn').click();
    else if (/^Digit[0-9]$/.test(e.code)) {
      const d = +e.code.slice(5);
      ui.setRatio(d === 0 ? 1 : d / 10);
    }
  });

  window.addEventListener('resize', () => { if (renderer) { renderer.resize(); if (mode === 'game') renderer.clampCamera(); } });

  // Доступ к текущей партии для отладки из консоли
  TW.app = { get game() { return game; }, get renderer() { return renderer; }, get ui() { return ui; } };

  requestAnimationFrame(loop);
  boot().catch(async (err) => {
    console.error(err);
    await Platform.ready();
    inputEnabled = true;
    $('splash').hidden = true;
    showMenu();
  });
})();
