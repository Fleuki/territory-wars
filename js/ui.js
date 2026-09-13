// HUD: лидеры, население, атаки, подсказки, уведомления
(function () {
  const TW = window.TW;
  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  const rgbCss = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

  class UI {
    constructor(game, onRetreat) {
      this.g = game;
      this.ratio = 0.2;
      this.lastLb = 0;
      this.attackKey = '';
      this.el = {
        lbBody: $('lbBody'), rate: $('rate'), popfill: $('popfill'), poptext: $('poptext'),
        terr: $('terr'), ratioText: $('ratioText'), ratio: $('ratio'), banner: $('banner'),
        attacks: $('attacks'), timer: $('timer'), tooltip: $('tooltip'), toasts: $('toasts'),
      };
      this.el.ratio.value = Math.round(this.ratio * 100);
      this.el.ratio.oninput = () => this.setRatio(this.el.ratio.value / 100);
      this.el.attacks.onclick = (e) => {
        const b = e.target.closest('button[data-id]');
        if (b) onRetreat(+b.dataset.id);
      };
      this.el.toasts.innerHTML = '';
      this.el.tooltip.hidden = true;
    }

    setRatio(r) {
      this.ratio = TW.clamp(r, 0.01, 1);
      this.el.ratio.value = Math.round(this.ratio * 100);
      this.updateRatioText();
    }

    updateRatioText() {
      const h = this.g.human;
      this.el.ratioText.textContent = `⚔ ${Math.round(this.ratio * 100)}% (${TW.fmt(h.troops * this.ratio)})`;
    }

    update(now) {
      const g = this.g, h = g.human, el = this.el;
      const max = g.maxTroops(h);
      el.rate.textContent = `+${TW.fmt(g.phase === 'play' ? g.growthPerSecond(h) : 0)}/с`;
      el.popfill.style.width = `${Math.min(100, (h.troops / max) * 100)}%`;
      el.poptext.textContent = `${TW.fmt(h.troops)} / ${TW.fmt(max)}`;
      el.terr.textContent = `${((h.tiles / g.map.landCount) * 100).toFixed(1)}%`;
      this.updateRatioText();

      const secs = Math.floor(g.playTick / TW.TPS);
      el.timer.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

      if (g.phase === 'spawn') {
        el.banner.hidden = false;
        const left = Math.ceil(g.spawnTicks / TW.TPS);
        el.banner.innerHTML = `${h.spawned ? 'Место выбрано — можно изменить' : 'Выберите стартовое местоположение'}<small>Начало через ${left} с</small>`;
      } else {
        el.banner.hidden = true;
      }

      this.updateAttacks();
      if (now - this.lastLb > 400) {
        this.lastLb = now;
        this.updateLeaderboard();
      }
    }

    updateAttacks() {
      const g = this.g, hid = g.human.id;
      const list = g.attacks.filter((a) => a.attacker === hid || a.target === hid);
      const key = list.map((a) => a.id).join(',');
      if (key !== this.attackKey) {
        this.attackKey = key;
        this.el.attacks.innerHTML = list.map((a) => {
          const out = a.attacker === hid;
          const other = out ? (a.target >= 0 ? g.players[a.target].name : 'Пустошь') : g.players[a.attacker].name;
          return `<div class="attack ${out ? '' : 'incoming'}">${out ? '⚔' : '🛡'} <b data-t="${a.id}">0</b> <span>${esc(out ? other : other + ' → вы')}</span>` +
            (out ? `<button class="x" data-id="${a.id}" title="Отступить">✕</button>` : '') + '</div>';
        }).join('');
      }
      for (const a of list) {
        const b = this.el.attacks.querySelector(`b[data-t="${a.id}"]`);
        if (b) b.textContent = TW.fmt(a.troops);
      }
    }

    updateLeaderboard() {
      const g = this.g, rank = g.ranking(), land = g.map.landCount;
      const row = (p, k) => `<tr class="${p.isHuman ? 'me' : ''}"><td>${k + 1}</td>` +
        `<td class="name"><span class="dot" style="background:${rgbCss(p.color)}"></span><span class="name">${esc(p.name)}</span></td>` +
        `<td>${((p.tiles / land) * 100).toFixed(1)}%</td><td>${TW.fmt(p.troops)}</td></tr>`;
      const top = rank.slice(0, 8);
      let html = top.map(row).join('');
      const me = rank.indexOf(g.human);
      if (me >= 8) html += `<tr class="sep"><td colspan="4"></td></tr>` + row(g.human, me);
      this.el.lbBody.innerHTML = html;
    }

    showTooltip(sx, sy, tile) {
      const g = this.g, tt = this.el.tooltip;
      if (tile < 0) { tt.hidden = true; return; }
      const t = g.map.terrain[tile];
      const o = g.owner[tile];
      let html;
      if (t === 0) html = `<div class="muted">Вода</div>`;
      else if (o < 0) html = `<div class="t-name">Пустошь</div><div class="muted">${TW.TERRAIN_NAMES[t]}</div>`;
      else {
        const p = g.players[o];
        html = `<div class="t-name" style="color:${rgbCss(p.color.map((v) => Math.min(255, v + 60)))}">${esc(p.name)}${p.isHuman ? ' (вы)' : ''}</div>` +
          `<div>👥 ${TW.fmt(p.troops)} &nbsp; 🗺 ${((p.tiles / g.map.landCount) * 100).toFixed(1)}%</div>` +
          `<div class="muted">${TW.TERRAIN_NAMES[t]}</div>`;
      }
      tt.innerHTML = html;
      tt.hidden = false;
      const w = tt.offsetWidth, hgt = tt.offsetHeight;
      let x = sx + 16, y = sy + 16;
      if (x + w > window.innerWidth - 6) x = sx - w - 12;
      if (y + hgt > window.innerHeight - 6) y = sy - hgt - 12;
      tt.style.left = x + 'px';
      tt.style.top = y + 'px';
    }

    hideTooltip() { this.el.tooltip.hidden = true; }

    toast(text, cls = 'info') {
      const box = this.el.toasts;
      const d = document.createElement('div');
      d.className = `toast ${cls}`;
      d.textContent = text;
      box.appendChild(d);
      while (box.children.length > 4) box.firstChild.remove();
      setTimeout(() => { d.style.opacity = '0'; }, 2600);
      setTimeout(() => d.remove(), 3100);
    }
  }

  TW.UI = UI;
})();
