// Запуск игры, игровой цикл и управление
(function () {
  const TW = window.TW;
  const $ = (id) => document.getElementById(id);
  const canvas = $('map');

  const SIZES = { s: [320, 200], m: [480, 300], l: [640, 400] };

  let game = null, renderer = null, ui = null;
  let paused = false, speed = 1, acc = 0, last = performance.now(), lastUi = 0;
  let endShown = false;

  // ---------- Меню ----------

  const optBots = $('optBots');
  optBots.oninput = () => { $('optBotsVal').textContent = optBots.value; };
  try {
    const saved = JSON.parse(localStorage.getItem('tw-options') || 'null');
    if (saved) {
      $('optName').value = saved.name || $('optName').value;
      optBots.value = saved.bots || optBots.value;
      $('optSize').value = saved.size || 'm';
      $('optDiff').value = saved.diff || 'normal';
      $('optBotsVal').textContent = optBots.value;
    }
  } catch (e) { /* нет доступа к localStorage */ }

  $('playBtn').onclick = startGame;
  $('againBtn').onclick = () => { $('endScreen').hidden = true; showMenu(); };
  $('watchBtn').onclick = () => { $('endScreen').hidden = true; };
  $('exitBtn').onclick = () => { if (confirm('Выйти в меню? Текущая игра будет потеряна.')) showMenu(); };
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

  function showMenu() {
    game = null;
    renderer = null;
    ui = null;
    $('hud').hidden = true;
    $('menu').hidden = false;
    $('endScreen').hidden = true;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function startGame() {
    const size = $('optSize').value;
    const opts = { name: $('optName').value.trim() || 'Моя Империя', bots: +optBots.value, size, diff: $('optDiff').value };
    try { localStorage.setItem('tw-options', JSON.stringify(opts)); } catch (e) { /* ignore */ }

    const [W, H] = SIZES[size] || SIZES.m;
    game = new TW.Game({
      W, H,
      seed: (Math.random() * 2 ** 31) | 0,
      bots: opts.bots,
      playerName: opts.name,
      difficulty: opts.diff,
      spawnSeconds: 12,
      winShare: 0.8,
    });
    renderer = new TW.Renderer(canvas, game);
    ui = new TW.UI(game, (id) => game && game.retreat(id));
    paused = false;
    speed = 1;
    acc = 0;
    endShown = false;
    $('speedBtn').textContent = 'x1';
    $('pauseBtn').textContent = '❚❚';
    $('pausedLabel').hidden = true;
    $('menu').hidden = true;
    $('hud').hidden = false;
    ui.update(performance.now());
  }

  function togglePause() {
    if (!game) return;
    paused = !paused;
    $('pauseBtn').textContent = paused ? '▶' : '❚❚';
    $('pausedLabel').hidden = !paused;
  }

  function centerOnHuman() {
    if (!game || !renderer) return;
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
    if (game) {
      if (!paused && $('endScreen').hidden) {
        acc += dt * speed;
        const step = 1000 / TW.TPS;
        let n = 0;
        while (acc >= step && n < 16) { game.update(); acc -= step; n++; }
        if (n >= 16) acc = 0;
      }
      renderer.flush();
      renderer.draw(now);

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
        const h = game.human;
        const secs = Math.floor(game.playTick / TW.TPS);
        $('endTitle').textContent = game.result.win ? '🏆 Победа!' : '💀 Поражение';
        $('endText').textContent = game.result.win
          ? `${h.name} захватила ${((h.tiles / game.map.landCount) * 100).toFixed(0)}% суши за ${Math.floor(secs / 60)} мин ${secs % 60} с. Уничтожено стран: ${h.kills}.`
          : `Ваша страна пала через ${Math.floor(secs / 60)} мин ${secs % 60} с. Максимум территории: ${((h.maxTiles / game.map.landCount) * 100).toFixed(1)}%. Уничтожено стран: ${h.kills}.`;
        $('endScreen').hidden = false;
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------- Управление мышью / касанием ----------

  const pointers = new Map();
  const drag = { active: false, startX: 0, startY: 0, lastX: 0, lastY: 0, pinchDist: 0 };
  const hover = { x: 0, y: 0, tile: -1 };

  canvas.addEventListener('pointerdown', (e) => {
    if (!game) return;
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
    if (!game) return;
    hover.x = e.clientX;
    hover.y = e.clientY;
    const tile = renderer.tileAt(e.clientX, e.clientY);
    hover.tile = tile;
    renderer.hoverTile = tile;

    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (drag.pinchDist > 0) renderer.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / drag.pinchDist);
        drag.pinchDist = d;
        return;
      }
      if (!drag.active && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) {
        drag.active = true;
        canvas.classList.add('dragging');
        ui.hideTooltip();
      }
      if (drag.active) {
        renderer.pan(e.clientX - drag.lastX, e.clientY - drag.lastY);
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
      }
    } else {
      ui.showTooltip(e.clientX, e.clientY, tile);
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (!drag.active && game && drag.button === 0 && e.type === 'pointerup') {
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
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('wheel', (e) => {
    if (!game) return;
    e.preventDefault();
    renderer.zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY));
  }, { passive: false });

  function handleClick(tile) {
    if (tile < 0 || !game) return;
    const g = game, W = g.W;
    if (g.phase === 'spawn') {
      if (!g.humanSpawn(tile % W, (tile / W) | 0)) {
        ui.toast(g.map.terrain[tile] === 0 ? 'Нельзя начать на воде' : 'Эта земля уже занята', 'bad');
      }
      return;
    }
    if (!g.human.alive) return;
    if (g.map.terrain[tile] === 0) return;
    const target = g.owner[tile];
    if (target === g.human.id) return;
    const res = g.launchAttack(g.human.id, target, g.human.troops * ui.ratio);
    if (res === 'nocontact') ui.toast(target < 0 ? 'Эта пустошь не граничит с вами' : `Нет общей границы: ${g.players[target].name}`, 'bad');
    else if (res === 'notroops') ui.toast('Недостаточно войск', 'bad');
  }

  window.addEventListener('keydown', (e) => {
    if (!game || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    else if (e.code === 'KeyC') centerOnHuman();
    else if (/^Digit[0-9]$/.test(e.code)) {
      const d = +e.code.slice(5);
      ui.setRatio(d === 0 ? 1 : d / 10);
    }
  });

  window.addEventListener('resize', () => { if (renderer) { renderer.resize(); renderer.clampCamera(); } });
})();
