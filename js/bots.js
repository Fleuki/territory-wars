// Искусственный интеллект соперников
(function () {
  const TW = window.TW;

  TW.Bots = {
    init(game, p) {
      const r = game.rnd;
      p.bot = {
        next: 10 + Math.floor(r() * 30),
        aggression: TW.clamp(0.25 + r() * 0.75 + game.cfg.aggression, 0.05, 1),
        reserve: TW.clamp(0.25 + r() * 0.25 + game.cfg.reserveShift, 0.1, 0.8), // ниже этой доли от максимума бот копит войска
        grudge: -1, // игрок, который напал на бота
        grudgeTicks: 0, // обида со временем проходит
        builder: 0.6 + r() * 0.4, // насколько охотно бот тратит золото
      };
    },

    think(game) {
      if (game.tick % 10 === 0) {
        let leader = null;
        for (const p of game.players) if (p.alive && (!leader || p.tiles > leader.tiles)) leader = p;
        game.leaderCache = leader;
      }
      for (const p of game.players) {
        if (p.isHuman || !p.alive) continue;
        if (--p.bot.next > 0) continue;
        p.bot.next = 12 + Math.floor(game.rnd() * 25);
        this.act(game, p);
      }
    },

    act(game, p) {
      const bot = p.bot;
      const max = game.maxTroops(p);

      // Кто сейчас атакует этого бота — запоминаем обидчика
      for (const a of game.attacks) {
        if (a.target === p.id) { bot.grudge = a.attacker; bot.grudgeTicks = 600; }
      }
      if (bot.grudgeTicks > 0 && (bot.grudgeTicks -= 30) <= 0) bot.grudge = -1;

      this.tryBuild(game, p);

      if (p.troops < max * bot.reserve) return;

      const o = game.owner, ter = game.map.terrain, W = game.W, N = game.N;
      const contacts = new Map();
      let waste = 0;
      const look = (j) => {
        const q = o[j];
        if (q === p.id) return;
        if (q < 0) { if (ter[j]) waste++; return; }
        contacts.set(q, (contacts.get(q) || 0) + 1);
      };
      for (const i of p.border) {
        const x = i % W;
        if (x > 0) look(i - 1);
        if (x < W - 1) look(i + 1);
        if (i >= W) look(i - W);
        if (i < N - W) look(i + W);
      }

      // Пока есть свободная земля — в основном расширяемся
      if (waste > 0 && (contacts.size === 0 || game.rnd() > bot.aggression * 0.35)) {
        game.launchAttack(p.id, -1, p.troops * (0.25 + 0.25 * bot.aggression));
        return;
      }
      if (contacts.size === 0) return;

      const myDensity = p.troops / Math.max(1, p.tiles);
      const leader = game.leaderCache;
      const human = game.human;
      // Против игрока одновременно воюет ограниченное число ботов (даже обиженных),
      // а в начале действует перемирие — его нарушает только нападение игрока
      let humanOk = true;
      if (!p.isHuman && human) {
        if (game.truceTicks > 0 && bot.grudge !== human.id) humanOk = false;
        else if (!game.attacks.some((a) => a.attacker === p.id && a.target === human.id)) {
          let n = 0;
          for (const a of game.attacks) if (a.target === human.id && a.attacker !== p.id) n++;
          if (n >= game.cfg.maxOnHuman) humanOk = false;
        }
      }
      let best = null, bestScore = -1;
      for (const [id, border] of contacts) {
        const e = game.players[id];
        if (!e.alive || (e.isHuman && !humanOk)) continue;
        const d = e.troops / Math.max(1, e.tiles);
        let s = Math.sqrt(border) * (myDensity + 1) / (d + 1);
        if (e.isHuman) s *= game.cfg.humanFocus;
        if (e === leader) s *= game.cfg.leaderFocus;
        if (id === bot.grudge) s *= 1.5;
        s *= 0.6 + game.rnd() * 0.8;
        if (s > bestScore) { bestScore = s; best = e; }
      }
      if (!best) return;

      const enemyDensity = best.troops / Math.max(1, best.tiles);
      // Слишком сильный враг — нападаем только самые агрессивные
      if (enemyDensity > myDensity * 1.4 && game.rnd() > bot.aggression * 0.4) return;
      if (p.troops < max * (bot.reserve + 0.1)) return;

      game.launchAttack(p.id, best.id, p.troops * (0.3 + 0.35 * bot.aggression));
    },

    // Строительство: в основном заводы и города, крепости — у границы с врагами
    tryBuild(game, p) {
      const bot = p.bot, r = game.rnd;
      if (r() > bot.builder) return;
      const want = { factory: 2, city: 2, fort: p.forts.size < 3 && game.playTick > 900 ? 1 : 0 };
      let type = null, best = Infinity;
      for (const t of TW.BUILD_TYPES) {
        if (!want[t]) continue;
        const k = p.built[t] / want[t];
        if (k < best) { best = k; type = t; }
      }
      if (!type || p.gold < game.buildCost(p, type)) return;

      const W = game.W;
      if (type === 'fort') {
        // Клетка на границе с другой державой, чуть вглубь своей территории
        const o = game.owner, cx = p.sx / p.tiles, cy = p.sy / p.tiles;
        let k = 0;
        for (const i of p.border) {
          if (++k > 400) break;
          if (r() > 0.1) continue;
          const x = i % W, y = (i / W) | 0;
          const nb = [x > 0 ? o[i - 1] : -1, x < W - 1 ? o[i + 1] : -1, o[i - W], o[i + W]];
          if (!nb.some((q) => q >= 0 && q !== p.id)) continue;
          const len = Math.hypot(cx - x, cy - y) || 1;
          const j = Math.round(y + ((cy - y) / len) * 2) * W + Math.round(x + ((cx - x) / len) * 2);
          if (game.build(p.id, type, j) === 'ok') return;
        }
        return;
      }
      // Заводы и города — внутри страны, подальше от границ
      const cx = p.sx / p.tiles, cy = p.sy / p.tiles, rad = Math.sqrt(p.tiles) * 0.45;
      for (let attempt = 0; attempt < 12; attempt++) {
        const a = r() * Math.PI * 2, d = r() * rad;
        const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d);
        if (x < 0 || y < 0 || x >= W || y >= game.H) continue;
        if (game.build(p.id, type, y * W + x) === 'ok') return;
      }
    },
  };
})();
