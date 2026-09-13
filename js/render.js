// Отрисовка карты, территорий и подписей стран
(function () {
  const TW = window.TW;

  class Renderer {
    constructor(canvas, game) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.g = game;
      const W = game.W, H = game.H;
      this.off = document.createElement('canvas');
      this.off.width = W;
      this.off.height = H;
      this.octx = this.off.getContext('2d');
      this.img = this.octx.createImageData(W, H);
      this.data = this.img.data;
      this.dist = new Uint16Array(W * H);
      this.labels = [];
      this.labelTick = -1;
      this.cam = { x: W / 2, y: H / 2, scale: 1 };
      this.hoverTile = -1;
      this.resize();
      this.fitCamera();
      for (let i = 0; i < W * H; i++) this.colorTile(i);
      this.octx.putImageData(this.img, 0, 0);
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      this.dpr = dpr;
      this.cw = window.innerWidth;
      this.ch = window.innerHeight;
      this.canvas.width = Math.round(this.cw * dpr);
      this.canvas.height = Math.round(this.ch * dpr);
    }

    fitScale() {
      return Math.min(this.cw / this.g.W, this.ch / this.g.H);
    }

    fitCamera() {
      this.cam.x = this.g.W / 2;
      this.cam.y = this.g.H / 2;
      this.cam.scale = this.fitScale() * 0.98;
    }

    focus(x, y, scale) {
      this.cam.x = x;
      this.cam.y = y;
      if (scale) this.cam.scale = TW.clamp(scale, this.fitScale() * 0.7, 48);
      this.clampCamera();
    }

    screenToTile(sx, sy) {
      const c = this.cam;
      return { x: (sx - this.cw / 2) / c.scale + c.x, y: (sy - this.ch / 2) / c.scale + c.y };
    }

    tileAt(sx, sy) {
      const t = this.screenToTile(sx, sy);
      const x = Math.floor(t.x), y = Math.floor(t.y);
      if (x < 0 || y < 0 || x >= this.g.W || y >= this.g.H) return -1;
      return y * this.g.W + x;
    }

    zoomAt(sx, sy, factor) {
      const before = this.screenToTile(sx, sy);
      this.cam.scale = TW.clamp(this.cam.scale * factor, this.fitScale() * 0.7, 48);
      const after = this.screenToTile(sx, sy);
      this.cam.x += before.x - after.x;
      this.cam.y += before.y - after.y;
      this.clampCamera();
    }

    pan(dx, dy) {
      this.cam.x -= dx / this.cam.scale;
      this.cam.y -= dy / this.cam.scale;
      this.clampCamera();
    }

    clampCamera() {
      const c = this.cam;
      // Если карта целиком помещается по оси — держим её по центру
      c.x = this.g.W * c.scale <= this.cw ? this.g.W / 2 : TW.clamp(c.x, this.cw / 2 / c.scale, this.g.W - this.cw / 2 / c.scale);
      c.y = this.g.H * c.scale <= this.ch ? this.g.H / 2 : TW.clamp(c.y, this.ch / 2 / c.scale, this.g.H - this.ch / 2 / c.scale);
    }

    colorTile(i) {
      const g = this.g, o = g.owner[i], d = this.data, k = i * 4, k3 = i * 3, rgb = g.map.rgb;
      d[k + 3] = 255;
      if (o < 0) {
        d[k] = rgb[k3]; d[k + 1] = rgb[k3 + 1]; d[k + 2] = rgb[k3 + 2];
        return;
      }
      const c = g.players[o].color;
      if (g.isBorder(i, o)) {
        d[k] = c[0] * 0.7; d[k + 1] = c[1] * 0.7; d[k + 2] = c[2] * 0.7;
      } else {
        const a = 0.55;
        d[k] = rgb[k3] * (1 - a) + c[0] * a;
        d[k + 1] = rgb[k3 + 1] * (1 - a) + c[1] * a;
        d[k + 2] = rgb[k3 + 2] * (1 - a) + c[2] * a;
      }
    }

    // Применяет изменения клеток, накопленные игрой
    flush() {
      const g = this.g, W = g.W, N = g.N, dirty = g.dirty;
      if (!dirty.length) return;
      for (let n = 0; n < dirty.length; n++) {
        const i = dirty[n], x = i % W;
        this.colorTile(i);
        if (x > 0) this.colorTile(i - 1);
        if (x < W - 1) this.colorTile(i + 1);
        if (i >= W) this.colorTile(i - W);
        if (i < N - W) this.colorTile(i + W);
      }
      dirty.length = 0;
      this.octx.putImageData(this.img, 0, 0);
    }

    // Для каждой страны ищем точку, максимально удалённую от её границ —
    // там и пишем название, размер шрифта зависит от «толщины» территории
    computeLabels() {
      const g = this.g, W = g.W, H = g.H, o = g.owner, dist = this.dist;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x, p = o[i];
          if (p < 0) { dist[i] = 0; continue; }
          let d = x === 0 || y === 0 ? 1 : Math.min(o[i - 1] === p ? dist[i - 1] + 1 : 1, o[i - W] === p ? dist[i - W] + 1 : 1);
          dist[i] = d;
        }
      }
      const best = new Int32Array(g.players.length).fill(-1);
      const bestD = new Uint16Array(g.players.length);
      for (let y = H - 1; y >= 0; y--) {
        for (let x = W - 1; x >= 0; x--) {
          const i = y * W + x, p = o[i];
          if (p < 0) continue;
          let d = dist[i];
          if (x === W - 1 || y === H - 1) d = 1;
          else d = Math.min(d, o[i + 1] === p ? dist[i + 1] + 1 : 1, o[i + W] === p ? dist[i + W] + 1 : 1);
          dist[i] = d;
          if (d > bestD[p]) { bestD[p] = d; best[p] = i; }
        }
      }
      this.labels = [];
      let leader = null;
      for (const p of g.players) {
        if (!p.alive || p.tiles === 0 || best[p.id] < 0) continue;
        if (!leader || p.tiles > leader.tiles) leader = p;
        const i = best[p.id];
        this.labels.push({ p, x: (i % W) + 0.5, y: ((i / W) | 0) + 0.5, r: bestD[p.id] });
      }
      this.leader = leader;
    }

    draw(now) {
      const g = this.g, ctx = this.ctx, c = this.cam, s = c.scale;
      if (this.labelTick < 0 || g.tick - this.labelTick >= 5 || (g.phase === 'spawn' && g.tick !== this.labelTick)) {
        this.computeLabels();
        this.labelTick = g.tick;
      }

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#34587d';
      ctx.fillRect(0, 0, this.cw, this.ch);

      const x0 = (0 - c.x) * s + this.cw / 2;
      const y0 = (0 - c.y) * s + this.ch / 2;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.off, x0, y0, g.W * s, g.H * s);

      // Подсветка клетки под курсором
      if (this.hoverTile >= 0 && s >= 6) {
        const hx = this.hoverTile % g.W, hy = (this.hoverTile / g.W) | 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + hx * s + 0.5, y0 + hy * s + 0.5, s - 1, s - 1);
      }

      this.drawLabels(x0, y0, s);
      this.drawAttackCounters(x0, y0, s);

      // Пульсирующий круг вокруг места старта во время выбора
      if (g.phase === 'spawn' && g.human.spawned) {
        const px = x0 + (g.human.spawnX + 0.5) * s, py = y0 + (g.human.spawnY + 0.5) * s;
        const pulse = (now / 900) % 1;
        ctx.strokeStyle = `rgba(255,255,255,${1 - pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, (4 + pulse * 10) * Math.max(s, 2), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    drawLabels(x0, y0, s) {
      const ctx = this.ctx;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const L of this.labels) {
        const sx = x0 + L.x * s, sy = y0 + L.y * s;
        const radiusPx = L.r * s;
        if (sx < -200 || sy < -100 || sx > this.cw + 200 || sy > this.ch + 100) continue;
        const name = L.p.name;
        let fs = Math.min(radiusPx * 0.62, (radiusPx * 1.9) / (name.length * 0.56), 44);
        if (fs < 7) continue;
        const dark = 'rgba(20,18,40,0.92)';
        ctx.fillStyle = dark;
        ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillText(name, sx, sy - fs * 0.25);
        ctx.font = `700 ${Math.max(6, fs * 0.62)}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillText(TW.fmt(L.p.troops), sx, sy + fs * 0.62);
        if (this.leader === L.p && this.g.phase === 'play') {
          ctx.font = `${fs * 0.8}px "Segoe UI Emoji", sans-serif`;
          ctx.fillText('👑', sx, sy - fs * 1.1);
        }
      }
    }

    drawAttackCounters(x0, y0, s) {
      const g = this.g, ctx = this.ctx;
      const hid = g.human.id;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const a of g.attacks) {
        if (a.lastTile < 0) continue;
        const mine = a.attacker === hid || a.target === hid;
        if (!mine && s < 4) continue;
        const sx = x0 + ((a.lastTile % g.W) + 0.5) * s;
        const sy = y0 + (((a.lastTile / g.W) | 0) + 0.5) * s;
        const text = TW.fmt(a.troops);
        const fs = mine ? 12 : 10;
        ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`;
        const w = ctx.measureText(text).width + 8;
        ctx.fillStyle = a.attacker === hid ? 'rgba(40,90,200,0.85)' : a.target === hid ? 'rgba(200,40,40,0.85)' : 'rgba(30,30,40,0.7)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(sx - w / 2, sy - fs * 0.8, w, fs * 1.6, 4);
        else ctx.rect(sx - w / 2, sy - fs * 0.8, w, fs * 1.6);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(text, sx, sy + 0.5);
      }
    }
  }

  TW.Renderer = Renderer;
})();
