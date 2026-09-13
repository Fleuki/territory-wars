// Процедурная генерация карты: вода, равнины, леса, холмы, горы
(function () {
  const TW = window.TW;

  // Типы местности
  const WATER = 0, PLAINS = 1, FOREST = 2, HILLS = 3, MOUNTAINS = 4;
  TW.TERRAIN_NAMES = ['Вода', 'Равнина', 'Лес', 'Холмы', 'Горы'];

  function valueNoise(rnd, W, H, cell) {
    const gw = Math.ceil(W / cell) + 2;
    const gh = Math.ceil(H / cell) + 2;
    const g = new Float32Array(gw * gh);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return function (x, y) {
      const fx = x / cell, fy = y / cell;
      const ix = fx | 0, iy = fy | 0;
      const tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const r0 = iy * gw, r1 = r0 + gw;
      const top = g[r0 + ix] + (g[r0 + ix + 1] - g[r0 + ix]) * sx;
      const bot = g[r1 + ix] + (g[r1 + ix + 1] - g[r1 + ix]) * sx;
      return top + (bot - top) * sy;
    };
  }

  function fbm(rnd, W, H, baseCell) {
    const layers = [];
    let amp = 1, total = 0;
    for (let cell = baseCell; cell >= 2; cell /= 2) {
      layers.push([valueNoise(rnd, W, H, cell), amp]);
      total += amp;
      amp *= 0.5;
    }
    return function (x, y) {
      let v = 0;
      for (let k = 0; k < layers.length; k++) v += layers[k][0](x, y) * layers[k][1];
      return v / total;
    };
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }

  TW.generateMap = function (W, H, seed) {
    const rnd = TW.rng(seed);
    const N = W * H;
    const heightN = fbm(rnd, W, H, Math.max(W, H) / 4);
    const moistN = fbm(rnd, W, H, Math.max(W, H) / 5);
    const detailN = valueNoise(rnd, W, H, 3);

    const h = new Float32Array(N);
    const m = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let v = heightN(x, y);
        // Опускаем края карты под воду
        const ex = Math.min(x, W - 1 - x) / (W * 0.12);
        const ey = Math.min(y, H - 1 - y) / (H * 0.12);
        const e = Math.min(1, ex, ey);
        v -= (1 - e) * (1 - e) * 0.3;
        h[i] = v;
        m[i] = moistN(x, y);
      }
    }

    // Уровень моря — так, чтобы суша занимала ~52% карты
    const sorted = Float32Array.from(h).sort();
    const sea = sorted[Math.floor(N * 0.48)];
    const landVals = sorted.subarray(Math.floor(N * 0.48));
    const q = (p) => landVals[Math.floor(landVals.length * p)];
    const tForest = q(0.5), tHills = q(0.78), tMount = q(0.93), tSnow = q(0.985);
    const hMax = sorted[N - 1];

    const terrain = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const v = h[i];
      terrain[i] = v < sea ? WATER : v < tForest ? PLAINS : v < tHills ? FOREST : v < tMount ? HILLS : MOUNTAINS;
    }

    connectLandmasses(terrain, W, H, rnd);

    // Расстояние от берега для воды (для оттенков глубины)
    const depth = new Uint8Array(N).fill(255);
    const queue = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) if (terrain[i] !== WATER) { depth[i] = 0; queue[qt++] = i; }
    while (qh < qt) {
      const i = queue[qh++];
      const d = depth[i];
      if (d >= 14) continue;
      const x = i % W;
      if (x > 0 && depth[i - 1] > d + 1) { depth[i - 1] = d + 1; queue[qt++] = i - 1; }
      if (x < W - 1 && depth[i + 1] > d + 1) { depth[i + 1] = d + 1; queue[qt++] = i + 1; }
      if (i >= W && depth[i - W] > d + 1) { depth[i - W] = d + 1; queue[qt++] = i - W; }
      if (i < N - W && depth[i + W] > d + 1) { depth[i + W] = d + 1; queue[qt++] = i + W; }
    }

    // Цвета местности
    const rgb = new Uint8Array(N * 3);
    const C = {
      shallow: [120, 168, 204], deep: [58, 98, 140],
      sand: [222, 210, 170],
      dry: [214, 201, 150], green: [164, 196, 128],
      forestDry: [184, 180, 128], forest: [128, 168, 104],
      hills: [178, 162, 128], mount: [160, 150, 140], snow: [238, 238, 240],
    };
    const landTiles = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const t = terrain[i];
        let c;
        if (t === WATER) {
          c = mix(C.shallow, C.deep, Math.min(1, (depth[i] - 1) / 12));
        } else {
          landTiles.push(i);
          const moist = TW.clamp((m[i] - 0.5) * 3 + 0.5, 0, 1);
          if (t === PLAINS) c = mix(C.dry, C.green, moist);
          else if (t === FOREST) c = mix(C.forestDry, C.forest, moist);
          else if (t === HILLS) c = C.hills;
          else c = h[i] < tSnow ? C.mount : mix(C.mount, C.snow, 0.5 + 0.5 * TW.clamp((h[i] - tSnow) / (hMax - tSnow + 1e-6), 0, 1));
          const coast = (x > 0 && terrain[i - 1] === WATER) || (x < W - 1 && terrain[i + 1] === WATER) ||
            (y > 0 && terrain[i - W] === WATER) || (y < H - 1 && terrain[i + W] === WATER);
          if (coast && t === PLAINS) c = mix(c, C.sand, 0.6);
        }
        const shade = 0.95 + detailN(x, y) * 0.1;
        rgb[i * 3] = Math.min(255, c[0] * shade);
        rgb[i * 3 + 1] = Math.min(255, c[1] * shade);
        rgb[i * 3 + 2] = Math.min(255, c[2] * shade);
      }
    }

    return { W, H, terrain, rgb, landTiles: Int32Array.from(landTiles), landCount: landTiles.length };
  };

  // Удаляет мелкие острова и соединяет крупные материки перешейками,
  // чтобы до любой страны можно было дойти по суше
  function connectLandmasses(terrain, W, H, rnd) {
    const N = W * H;
    const label = new Int32Array(N).fill(-1);
    const stack = new Int32Array(N);
    const masses = [];
    for (let s = 0; s < N; s++) {
      if (terrain[s] === WATER || label[s] >= 0) continue;
      const id = masses.length;
      const tiles = [];
      let sp = 0;
      stack[sp++] = s;
      label[s] = id;
      while (sp) {
        const i = stack[--sp];
        tiles.push(i);
        const x = i % W;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < N - W ? i + W : -1];
        for (const j of nb) {
          if (j >= 0 && terrain[j] !== WATER && label[j] < 0) { label[j] = id; stack[sp++] = j; }
        }
      }
      masses.push(tiles);
    }
    masses.sort((a, b) => b.length - a.length);
    if (!masses.length) return;

    const minSize = Math.max(60, N * 0.004);
    const coastOf = (tiles) => tiles.filter((i) => {
      const x = i % W;
      return (x > 0 && terrain[i - 1] === WATER) || (x < W - 1 && terrain[i + 1] === WATER) ||
        (i >= W && terrain[i - W] === WATER) || (i < N - W && terrain[i + W] === WATER);
    });
    const sample = (arr, n) => {
      if (arr.length <= n) return arr;
      const out = [];
      const step = arr.length / n;
      for (let k = 0; k < n; k++) out.push(arr[Math.floor(k * step + rnd() * step)]);
      return out;
    };

    let connected = sample(coastOf(masses[0]), 1500);
    for (let k = 1; k < masses.length; k++) {
      const tiles = masses[k];
      if (tiles.length < minSize) {
        for (const i of tiles) terrain[i] = WATER;
        continue;
      }
      const coast = coastOf(tiles);
      const mine = sample(coast, 300);
      let best = Infinity, bi = -1, bj = -1;
      for (const a of mine) {
        const ax = a % W, ay = (a / W) | 0;
        for (const b of connected) {
          const dx = ax - (b % W), dy = ay - ((b / W) | 0);
          const d = dx * dx + dy * dy;
          if (d < best) { best = d; bi = a; bj = b; }
        }
      }
      if (bi >= 0) carveBridge(terrain, W, H, bi, bj);
      connected = connected.concat(sample(coast, 400));
    }
  }

  function carveBridge(terrain, W, H, a, b) {
    let x0 = a % W, y0 = (a / W) | 0;
    const x1 = b % W, y1 = (b / W) | 0;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= steps; s++) {
      const cx = Math.round(x0 + ((x1 - x0) * s) / steps);
      const cy = Math.round(y0 + ((y1 - y0) * s) / steps);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
          const i = y * W + x;
          if (terrain[i] === WATER) terrain[i] = PLAINS;
        }
      }
    }
  }
})();
