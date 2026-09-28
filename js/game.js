// Логика игры: территории, население, атаки
(function () {
  const TW = window.TW;
  const TPS = TW.TPS;

  // Во сколько раз дороже захватывать клетку данного типа местности
  const TERRAIN_COST = [0, 1.0, 1.3, 1.7, 2.4];
  const START_TROOPS = 2500;
  const SPAWN_RADIUS = 3;

  // Сложность меняет в первую очередь поведение ботов, а не скорость их роста:
  // иначе на сложном уровне у ботов просто быстрее «накручиваются» числа.
  // truce — сколько секунд боты не нападают на игрока первыми,
  // maxOnHuman — сколько ботов могут одновременно воевать с игроком
  const DIFFICULTY = {
    easy: { botGrowth: 0.8, botGold: 0.7, aggression: -0.2, humanFocus: 0.6, leaderFocus: 1.0, reserveShift: 0.1, truce: 120, maxOnHuman: 1 },
    normal: { botGrowth: 1.0, botGold: 1.0, aggression: 0, humanFocus: 1.0, leaderFocus: 1.0, reserveShift: 0, truce: 60, maxOnHuman: 2 },
    hard: { botGrowth: 1.0, botGold: 1.0, aggression: 0.15, humanFocus: 1.15, leaderFocus: 1.3, reserveShift: -0.05, truce: 30, maxOnHuman: 3 },
  };

  // Постройки покупаются за золото и достаются тому, кто захватит их клетку
  const BUILDINGS = {
    factory: { name: 'Завод', icon: '🏭', cost: 400, key: 'KeyQ', hint: '+12% к приросту населения' },
    city: { name: 'Город', icon: '🏛️', cost: 300, key: 'KeyW', hint: '+2000 к максимуму населения, +2 золота/с' },
    fort: { name: 'Крепость', icon: '🏰', cost: 250, key: 'KeyE', hint: 'Земли в радиусе 10 захватывать в 4 раза дороже, саму крепость — в 12' },
  };
  const BUILD_TYPES = Object.keys(BUILDINGS);
  const COST_GROWTH = 1.6; // каждая следующая постройка того же типа дороже
  const BUILD_SPACING = 4;
  const FORT_RADIUS = 10;
  const FORT_MULT = 4; // во столько раз дороже захват в зоне крепости
  const FORT_KEEP = 3; // саму крепость — ещё во столько раз дороже
  const FORT_LOSS = 0.5; // защитник теряет меньше войск на клетку в зоне крепости
  const FACTORY_BONUS = 0.12;
  const CITY_POP = 2000;
  const CITY_GOLD = 2;
  const START_GOLD = 100;
  TW.BUILDINGS = BUILDINGS;
  TW.BUILD_TYPES = BUILD_TYPES;
  TW.FORT_RADIUS = FORT_RADIUS;

  class Game {
    constructor(cfg) {
      this.cfg = Object.assign({}, cfg, DIFFICULTY[cfg.difficulty] || DIFFICULTY.normal);
      this.map = TW.generateMap(cfg.W, cfg.H, cfg.seed);
      this.W = this.map.W;
      this.H = this.map.H;
      this.N = this.W * this.H;
      this.owner = new Int16Array(this.N).fill(-1);
      this.mark = new Uint32Array(this.N);
      this.stamp = 0;
      this.rnd = TW.rng(cfg.seed ^ 0x9e3779b9);
      this.players = [];
      this.attacks = [];
      this.attackSeq = 0;
      this.tick = 0;
      this.playTick = 0;
      this.phase = 'spawn';
      this.spawnTicks = cfg.spawnSeconds * TPS;
      this.events = [];
      this.dirty = [];
      this.result = null; // {win: bool}
      this.buildings = new Map(); // клетка -> тип постройки
      this.truceTicks = cfg.demo ? 0 : this.cfg.truce * TPS;
      this.createPlayers();
    }

    // ---------- Игроки ----------

    createPlayers() {
      const human = this.addPlayer(this.cfg.playerName || 'Моя держава', this.cfg.playerColor || [150, 80, 220], true);
      this.human = human;
      if (this.cfg.demo) human.alive = false;

      const names = TW.BOT_NAMES.slice();
      for (let k = names.length - 1; k > 0; k--) {
        const j = Math.floor(this.rnd() * (k + 1));
        [names[k], names[j]] = [names[j], names[k]];
      }
      const [hr, hg, hb] = human.color;
      const mx = Math.max(hr, hg, hb), mn = Math.min(hr, hg, hb), dl = mx - mn || 1;
      const humanHue = (mx === hr ? ((hg - hb) / dl) % 6 : mx === hg ? (hb - hr) / dl + 2 : (hr - hg) / dl + 4) * 60;
      for (let k = 0; k < this.cfg.bots; k++) {
        let hue = (k * 137.508 + this.rnd() * 20) % 360;
        // Не даём ботам цвет, похожий на цвет игрока
        const diff = Math.abs(((hue - humanHue + 540) % 360) - 180);
        if (!this.cfg.demo && diff < 28) hue = (hue + 60) % 360;
        const sat = 0.45 + this.rnd() * 0.25;
        const lig = 0.45 + this.rnd() * 0.15;
        const name = k < names.length ? names[k] : names[k % names.length] + ' ' + (Math.floor(k / names.length) + 1);
        const p = this.addPlayer(name, TW.hslToRgb(hue, sat, lig), false);
        TW.Bots.init(this, p);
      }
      this.spawnBots();
    }

    addPlayer(name, color, isHuman) {
      const p = {
        id: this.players.length, name, color, isHuman,
        troops: START_TROOPS, tiles: 0, sx: 0, sy: 0,
        border: new Set(), alive: true, spawned: false,
        maxTiles: 0, kills: 0,
        gold: START_GOLD, built: { factory: 0, city: 0, fort: 0 }, forts: new Set(),
      };
      this.players.push(p);
      return p;
    }

    maxTroops(p) {
      return 5000 + 80 * Math.pow(p.tiles, 0.85) + CITY_POP * p.built.city;
    }

    growthPerSecond(p) {
      const max = this.maxTroops(p);
      if (p.troops >= max) return 0;
      const g = (20 + Math.pow(p.troops, 0.73) * 1.2) * (1 - p.troops / max) * (1 + FACTORY_BONUS * p.built.factory);
      return p.isHuman ? g : g * this.cfg.botGrowth;
    }

    goldPerSecond(p) {
      const g = 1 + 0.25 * Math.sqrt(p.tiles) + CITY_GOLD * p.built.city;
      return p.isHuman ? g : g * this.cfg.botGold;
    }

    // ---------- Постройки ----------

    buildCost(p, type) {
      return Math.round(BUILDINGS[type].cost * Math.pow(COST_GROWTH, p.built[type]));
    }

    // Почему нельзя строить здесь (или null, если можно)
    buildProblem(pid, type, i) {
      const p = this.players[pid];
      if (!BUILDINGS[type] || !p.alive || this.phase !== 'play') return 'invalid';
      if (i < 0 || this.owner[i] !== pid || this.map.terrain[i] === 0) return 'notmine';
      if (p.gold < this.buildCost(p, type)) return 'gold';
      const W = this.W, x = i % W, y = (i / W) | 0, R = BUILD_SPACING;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= this.H) continue;
          if (this.buildings.has(yy * W + xx)) return 'near';
        }
      }
      return null;
    }

    build(pid, type, i) {
      const problem = this.buildProblem(pid, type, i);
      if (problem) return problem;
      const p = this.players[pid];
      p.gold -= this.buildCost(p, type);
      this.buildings.set(i, type);
      p.built[type]++;
      if (type === 'fort') p.forts.add(i);
      return 'ok';
    }

    // Во сколько раз дороже захватить клетку из-за крепостей её владельца
    fortFactor(tgt, j) {
      if (!tgt || tgt.forts.size === 0) return 1;
      if (tgt.forts.has(j)) return FORT_MULT * FORT_KEEP;
      const W = this.W, x = j % W, y = (j / W) | 0, R2 = FORT_RADIUS * FORT_RADIUS;
      for (const f of tgt.forts) {
        const dx = (f % W) - x, dy = ((f / W) | 0) - y;
        if (dx * dx + dy * dy <= R2) return FORT_MULT;
      }
      return 1;
    }

    // ---------- Появление на карте ----------

    spawnBots() {
      const land = this.map.landTiles;
      const spots = [];
      for (const p of this.players) {
        if (p.isHuman) continue;
        let minDist = Math.sqrt(this.map.landCount / (this.cfg.bots + 1)) * 0.9;
        let placed = false;
        for (let attempt = 0; attempt < 400 && !placed; attempt++) {
          if (attempt % 80 === 79) minDist *= 0.7;
          const i = land[Math.floor(this.rnd() * land.length)];
          const x = i % this.W, y = (i / this.W) | 0;
          if (this.owner[i] !== -1) continue;
          if (spots.some((s) => (s[0] - x) ** 2 + (s[1] - y) ** 2 < minDist * minDist)) continue;
          spots.push([x, y]);
          placed = this.spawnAt(p, x, y);
        }
        if (!placed) p.alive = false;
      }
    }

    spawnAt(p, cx, cy) {
      const R = SPAWN_RADIUS;
      let n = 0;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R + 1) continue;
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= this.W || y >= this.H) continue;
          const i = y * this.W + x;
          if (this.map.terrain[i] === 0 || this.owner[i] !== -1) continue;
          this.setOwner(i, p.id);
          n++;
        }
      }
      p.spawned = n > 0;
      p.spawnX = cx;
      p.spawnY = cy;
      return p.spawned;
    }

    // Выбор места игроком (можно менять, пока идёт фаза выбора)
    humanSpawn(x, y) {
      if (this.phase !== 'spawn') return false;
      const i = y * this.W + x;
      if (this.map.terrain[i] === 0) return false;
      const o = this.owner[i];
      if (o >= 0 && o !== this.human.id) return false;
      if (this.human.spawned) {
        for (let j = 0; j < this.N; j++) if (this.owner[j] === this.human.id) this.setOwner(j, -1);
      }
      return this.spawnAt(this.human, x, y);
    }

    startPlay() {
      if (this.cfg.demo) { this.phase = 'play'; return; }
      if (!this.human.spawned) {
        const land = this.map.landTiles;
        for (let attempt = 0; attempt < 2000 && !this.human.spawned; attempt++) {
          const i = land[Math.floor(this.rnd() * land.length)];
          if (this.owner[i] === -1) this.spawnAt(this.human, i % this.W, (i / this.W) | 0);
        }
        this.events.push({ text: 'Место выбрано случайно', cls: 'info', focus: true });
      }
      this.phase = 'play';
      this.events.push({ text: `Игра началась! Перемирие с соседями: ${this.cfg.truce} с`, cls: 'good' });
    }

    // ---------- Клетки ----------

    isBorder(i, p) {
      const W = this.W, o = this.owner, x = i % W;
      if (x === 0 || x === W - 1 || i < W || i >= this.N - W) return true;
      return o[i - 1] !== p || o[i + 1] !== p || o[i - W] !== p || o[i + W] !== p;
    }

    refreshBorder(i) {
      const p = this.owner[i];
      if (p < 0) return;
      const pl = this.players[p];
      if (this.isBorder(i, p)) pl.border.add(i);
      else pl.border.delete(i);
    }

    setOwner(i, pid) {
      const old = this.owner[i];
      if (old === pid) return;
      const W = this.W, x = i % W, y = (i / W) | 0;
      if (old >= 0) {
        const o = this.players[old];
        o.tiles--; o.sx -= x; o.sy -= y;
        o.border.delete(i);
      }
      const b = this.buildings.get(i);
      if (b) this.transferBuilding(i, b, old, pid);
      this.owner[i] = pid;
      if (pid >= 0) {
        const p = this.players[pid];
        p.tiles++; p.sx += x; p.sy += y;
        if (p.tiles > p.maxTiles) p.maxTiles = p.tiles;
      }
      this.refreshBorder(i);
      if (x > 0) this.refreshBorder(i - 1);
      if (x < W - 1) this.refreshBorder(i + 1);
      if (y > 0) this.refreshBorder(i - W);
      if (y < this.H - 1) this.refreshBorder(i + W);
      this.dirty.push(i);
    }

    transferBuilding(i, type, from, to) {
      if (from >= 0) {
        const o = this.players[from];
        o.built[type]--;
        o.forts.delete(i);
      }
      if (to < 0) { this.buildings.delete(i); return; }
      const p = this.players[to];
      p.built[type]++;
      if (type === 'fort') p.forts.add(i);
      const name = BUILDINGS[type].name.toLowerCase();
      if (p.isHuman && from >= 0) this.events.push({ text: `Захвачен ${name}: ${this.players[from].name}`, cls: 'good' });
      else if (from >= 0 && this.players[from].isHuman) this.events.push({ text: `${p.name} захватила ваш ${name}`, cls: 'bad' });
    }

    // Есть ли у игрока общая граница с целью (-1 = ничейная земля)
    hasContact(pid, target) {
      const o = this.owner, ter = this.map.terrain, W = this.W, N = this.N;
      for (const i of this.players[pid].border) {
        const x = i % W;
        if (x > 0 && o[i - 1] === target && ter[i - 1]) return true;
        if (x < W - 1 && o[i + 1] === target && ter[i + 1]) return true;
        if (i >= W && o[i - W] === target && ter[i - W]) return true;
        if (i < N - W && o[i + W] === target && ter[i + W]) return true;
      }
      return false;
    }

    // ---------- Атаки ----------

    launchAttack(pid, target, troops) {
      const p = this.players[pid];
      if (!p.alive || target === pid || this.phase !== 'play') return 'invalid';
      if (target >= 0 && !this.players[target].alive) return 'invalid';
      troops = Math.floor(Math.min(troops, p.troops));
      if (troops < 1) return 'notroops';
      if (!this.hasContact(pid, target)) return 'nocontact';
      p.troops -= troops;

      // Встречная атака: войска взаимно уничтожаются
      if (target >= 0) {
        const opp = this.attacks.find((a) => a.attacker === target && a.target === pid);
        if (opp) {
          const m = Math.min(opp.troops, troops);
          opp.troops -= m;
          troops -= m;
          if (opp.troops < 1) this.removeAttack(opp);
          if (troops < 1) return 'ok';
        }
      }

      const ex = this.attacks.find((a) => a.attacker === pid && a.target === target);
      if (ex) {
        ex.troops += troops;
      } else {
        this.attacks.push({ id: ++this.attackSeq, attacker: pid, target, troops, lastTile: -1 });
        if (target >= 0 && this.players[target].isHuman) {
          this.events.push({ text: `${p.name} атакует вас!`, cls: 'bad' });
        }
      }
      return 'ok';
    }

    removeAttack(a) {
      a.dead = true;
      const k = this.attacks.indexOf(a);
      if (k >= 0) this.attacks.splice(k, 1);
    }

    endAttack(a, refund) {
      if (a.dead) return;
      this.players[a.attacker].troops += a.troops * refund;
      this.removeAttack(a);
    }

    // Отступление по команде игрока
    retreat(attackId) {
      const a = this.attacks.find((x) => x.id === attackId);
      if (a) this.endAttack(a, 0.9);
    }

    stepAttack(a) {
      const p = this.players[a.attacker];
      const tgt = a.target >= 0 ? this.players[a.target] : null;
      const o = this.owner, ter = this.map.terrain, W = this.W, N = this.N;
      const target = a.target, me = a.attacker;
      const stamp = ++this.stamp;
      const mark = this.mark;
      const cands = [], keys = [];
      const cx = p.sx / Math.max(1, p.tiles), cy = p.sy / Math.max(1, p.tiles);
      const rnd = this.rnd;

      // Приоритет клетки: ближе к центру страны, больше соседей-своих, легче местность.
      // Так территория растёт округлыми волнами и обходит горы.
      const fortified = tgt && tgt.forts.size > 0;
      const consider = (j) => {
        if (o[j] !== target || ter[j] === 0 || mark[j] === stamp) return;
        mark[j] = stamp;
        const x = j % W, y = (j / W) | 0;
        let c = 0;
        if (x > 0 && o[j - 1] === me) c++;
        if (x < W - 1 && o[j + 1] === me) c++;
        if (j >= W && o[j - W] === me) c++;
        if (j < N - W && o[j + W] === me) c++;
        const dx = x - cx, dy = y - cy;
        cands.push(j);
        let key = Math.sqrt(dx * dx + dy * dy) - c * 0.9 + (TERRAIN_COST[ter[j]] - 1) * 2.5 + rnd() * 2.2;
        // Укреплённые земли обходим, а саму крепость берём последней
        if (fortified) { const f = this.fortFactor(tgt, j); if (f > 1) key += f > FORT_MULT ? 30 : 8; }
        keys.push(key);
      };

      for (const i of p.border) {
        const x = i % W;
        if (x > 0) consider(i - 1);
        if (x < W - 1) consider(i + 1);
        if (i >= W) consider(i - W);
        if (i < N - W) consider(i + W);
      }

      const total = cands.length;
      if (total === 0) { this.endAttack(a, 1); return; }

      const density = tgt ? tgt.troops / Math.max(1, tgt.tiles) : 0;
      const baseCost = tgt ? 3 + density * 1.2 : 3;
      let n = Math.ceil(a.troops / (baseCost * 60));
      n = Math.max(2, Math.min(n, 30, Math.ceil(total * 0.3) + 1));

      let order;
      if (total <= n) order = cands.map((_, k) => k);
      else {
        order = cands.map((_, k) => k);
        order.sort((u, v) => keys[u] - keys[v]);
        order.length = n;
      }

      for (const k of order) {
        const j = cands[k];
        const fort = fortified ? this.fortFactor(tgt, j) : 1;
        const cost = baseCost * TERRAIN_COST[ter[j]] * fort;
        if (a.troops < cost) { this.endAttack(a, 1); return; }
        a.troops -= cost;
        if (tgt) tgt.troops = Math.max(0, tgt.troops - density * (fort > 1 ? FORT_LOSS : 1));
        this.setOwner(j, me);
        a.lastTile = j;
        if (tgt && tgt.tiles === 0) { this.eliminate(tgt, p); return; }
      }
      if (a.troops < 1) this.removeAttack(a);
    }

    eliminate(victim, by) {
      victim.alive = false;
      victim.troops = 0;
      if (by) by.kills++;
      for (const a of this.attacks.slice()) {
        if (a.attacker === victim.id) this.removeAttack(a);
        else if (a.target === victim.id) this.endAttack(a, 1);
      }
      if (victim.isHuman) {
        this.events.push({ text: `Ваша страна захвачена${by ? ' (' + by.name + ')' : ''}`, cls: 'bad' });
      } else {
        this.events.push({
          text: by && by.isHuman ? `Вы уничтожили: ${victim.name}` : `${victim.name} уничтожена`,
          cls: by && by.isHuman ? 'good' : 'info',
        });
      }
    }

    // ---------- Тик ----------

    update() {
      this.tick++;
      if (this.phase === 'spawn') {
        if (--this.spawnTicks <= 0) this.startPlay();
        return;
      }
      this.playTick++;

      for (const p of this.players) {
        if (!p.alive) continue;
        p.troops += this.growthPerSecond(p) / TPS;
        p.gold += this.goldPerSecond(p) / TPS;
      }
      if (this.truceTicks > 0 && --this.truceTicks === 0 && this.human.alive) {
        this.events.push({ text: 'Перемирие окончено — соседи могут напасть', cls: 'bad' });
      }

      TW.Bots.think(this);

      const list = this.attacks.slice();
      for (const a of list) if (!a.dead) this.stepAttack(a);

      this.checkEnd();
    }

    checkEnd() {
      if (this.result || this.cfg.demo) return;
      const h = this.human;
      if (!h.alive || h.tiles === 0) {
        if (h.alive) this.eliminate(h, null);
        this.result = { win: false };
        return;
      }
      const share = h.tiles / this.map.landCount;
      const botsAlive = this.players.some((p) => !p.isHuman && p.alive);
      if (share >= this.cfg.winShare || !botsAlive) this.result = { win: true };
    }

    ranking() {
      return this.players.filter((p) => p.alive && p.tiles > 0).sort((a, b) => b.tiles - a.tiles || b.troops - a.troops);
    }
  }

  TW.Game = Game;
})();
