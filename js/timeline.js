class ChineseHistoryTimeline {
  constructor() {
    this.canvas  = document.getElementById('timeline-canvas');
    this.ctx     = this.canvas.getContext('2d');
    this.container = document.getElementById('timeline-container');

    this.START_YEAR = -2200;
    this.END_YEAR   = 2030;

    this.panX = 0;
    this.zoom = 3; // pixels per year

    // Layout constants
    this.LANE_H     = 34;
    this.NUM_LANES  = 3;
    this.DYN_H      = this.LANE_H * this.NUM_LANES; // 102px
    this.RULER_H    = 48;
    this.EVT_Y      = this.DYN_H + this.RULER_H;
    this.EVT_AREA_H = 340;

    this.isDragging  = false;
    this.dragStartX  = 0;
    this.dragStartPan = 0;
    this.hoveredEvent = null;

    // Pre-compute event tracks for vertical stagger
    this._computeEventTracks();
    this.init();
  }

  _computeEventTracks() {
    // Assign each event a vertical track so nearby events don't overlap
    const sorted = [...EVENTS].sort((a, b) => a.year - b.year);
    const trackEnds = []; // last year used per track

    for (const ev of sorted) {
      let t = 0;
      while (trackEnds[t] !== undefined && ev.year - trackEnds[t] < 60) t++;
      ev._track = t;
      trackEnds[t] = ev.year;
    }
    this._maxTrack = Math.max(...EVENTS.map(e => e._track));
  }

  get totalWidth() {
    return (this.END_YEAR - this.START_YEAR) * this.zoom;
  }

  get canvasH() {
    return this.EVT_Y + this.EVT_AREA_H;
  }

  yearToX(year) {
    return (year - this.START_YEAR) * this.zoom - this.panX;
  }

  xToYear(x) {
    return (x + this.panX) / this.zoom + this.START_YEAR;
  }

  clampPan() {
    const maxPan = Math.max(0, this.totalWidth - this.canvas.width);
    this.panX = Math.max(0, Math.min(this.panX, maxPan));
  }

  init() {
    this.resize();
    this._bindEvents();
    this._buildLegend();
    this.render();
  }

  resize() {
    this.canvas.width  = this.container.clientWidth;
    this.canvas.height = this.canvasH;
  }

  _buildLegend() {
    const legend = document.getElementById('legend');
    legend.innerHTML = '';
    for (const [key, val] of Object.entries(EVENT_CATEGORIES)) {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `<span class="legend-dot" style="background:${val.color}"></span>${val.label}`;
      legend.appendChild(item);
    }
    // Dynasty lane labels
    const sep = document.createElement('span');
    sep.className = 'legend-sep';
    sep.textContent = '|';
    legend.appendChild(sep);
    ['Main Dynasties', 'N. Parallel', 'S. / Other Parallel'].forEach((l, i) => {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `<span class="legend-lane" style="background:rgba(255,255,255,${0.15 + i*0.07})"></span>${l}`;
      legend.appendChild(item);
    });
  }

  _bindEvents() {
    window.addEventListener('resize', () => { this.resize(); this.render(); });

    this.canvas.addEventListener('mousedown', e => {
      this.isDragging   = true;
      this.dragStartX   = e.clientX;
      this.dragStartPan = this.panX;
      this.canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', e => {
      if (this.isDragging) {
        this.panX = this.dragStartPan - (e.clientX - this.dragStartX);
        this.clampPan();
        this.render();
      } else {
        const rect = this.canvas.getBoundingClientRect();
        this._onHover(e.clientX - rect.left, e.clientY - rect.top, e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.canvas.style.cursor = 'grab';
    });

    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const yearAtMouse = this.xToYear(mx);

      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      this.zoom = Math.max(0.4, Math.min(25, this.zoom * factor));

      this.panX = (yearAtMouse - this.START_YEAR) * this.zoom - mx;
      this.clampPan();
      this.render();
      document.getElementById('zoom-level').textContent =
        Math.round(this.zoom / 3 * 100) + '%';
    }, { passive: false });

    this.canvas.addEventListener('click', e => {
      const rect = this.canvas.getBoundingClientRect();
      const ev = this._eventAt(e.clientX - rect.left, e.clientY - rect.top);
      if (ev) this._showDetail(ev);
    });

    document.getElementById('zoom-in').addEventListener('click', () => {
      this.zoom = Math.min(25, this.zoom * 1.5);
      this.clampPan(); this.render();
      document.getElementById('zoom-level').textContent = Math.round(this.zoom / 3 * 100) + '%';
    });
    document.getElementById('zoom-out').addEventListener('click', () => {
      this.zoom = Math.max(0.4, this.zoom / 1.5);
      this.clampPan(); this.render();
      document.getElementById('zoom-level').textContent = Math.round(this.zoom / 3 * 100) + '%';
    });
    document.getElementById('reset-view').addEventListener('click', () => {
      this.zoom = 3; this.panX = 0; this.render();
      document.getElementById('zoom-level').textContent = '100%';
    });
    document.getElementById('close-detail').addEventListener('click', () => {
      document.getElementById('event-detail').classList.remove('visible');
    });
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this._drawDynasties();
    this._drawRuler();
    this._drawEvents();
    this._drawYearLine(); // dashed "year 0" marker
  }

  _drawDynasties() {
    const { ctx } = this;
    const W = this.canvas.width;

    // Lane tint backgrounds
    for (let i = 0; i < this.NUM_LANES; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.02 + i * 0.01})`;
      ctx.fillRect(0, i * this.LANE_H, W, this.LANE_H);
    }

    for (const d of DYNASTIES) {
      const x = this.yearToX(d.start);
      const w = (d.end - d.start) * this.zoom;
      const y = d.lane * this.LANE_H;
      const h = this.LANE_H - 1;

      if (x + w < 0 || x > W) continue;

      // Filled band
      ctx.fillStyle = d.color;
      ctx.globalAlpha = 0.82;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;

      // Border
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, w, h);

      // Label — only if band is wide enough to show text
      if (w > 22) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(Math.max(0, x) + 2, y, Math.min(w, W - Math.max(0, x)) - 4, h);
        ctx.clip();

        const fontSize = Math.max(9, Math.min(13, w / 8));
        ctx.font = `600 ${fontSize}px 'Segoe UI', system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        // Center label within the visible portion of the band
        const visLeft  = Math.max(x, 4);
        const visRight = Math.min(x + w, W - 4);
        const labelX   = (visLeft + visRight) / 2;

        const label = w > 50 ? `${d.zh} ${d.name}` : (w > 28 ? d.zh : '');
        if (label) ctx.fillText(label, labelX, y + h / 2);
        ctx.restore();
      }
    }

    // Lane labels on the very left
    const laneLabels = ['Main', 'North', 'Other'];
    for (let i = 0; i < this.NUM_LANES; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(laneLabels[i], 3, i * this.LANE_H + this.LANE_H / 2);
    }
  }

  _drawRuler() {
    const { ctx } = this;
    const W = this.canvas.width;
    const Y = this.DYN_H;
    const H = this.RULER_H;

    ctx.fillStyle = '#111827';
    ctx.fillRect(0, Y, W, H);

    // Separator line
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Y); ctx.lineTo(W, Y);
    ctx.stroke();

    // Determine tick spacing from zoom
    let major, minor;
    if (this.zoom >= 10)      { major = 25;   minor = 5;   }
    else if (this.zoom >= 5)  { major = 50;   minor = 10;  }
    else if (this.zoom >= 2)  { major = 100;  minor = 25;  }
    else if (this.zoom >= 1)  { major = 250;  minor = 50;  }
    else if (this.zoom >= 0.6){ major = 500;  minor = 100; }
    else                      { major = 1000; minor = 200; }

    const y0 = this.xToYear(0);
    const y1 = this.xToYear(W);
    const startY = Math.ceil(y0 / minor) * minor;
    const endY   = Math.floor(y1 / minor) * minor;

    for (let yr = startY; yr <= endY; yr += minor) {
      const x = this.yearToX(yr);
      const isMaj = yr % major === 0;

      ctx.strokeStyle = isMaj ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)';
      ctx.lineWidth   = isMaj ? 1.5 : 0.5;
      const tickH = isMaj ? H * 0.55 : H * 0.25;
      ctx.beginPath();
      ctx.moveTo(x, Y);
      ctx.lineTo(x, Y + tickH);
      ctx.stroke();

      if (isMaj) {
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const lbl = yr < 0 ? `${Math.abs(yr)} BCE` : yr === 0 ? '0' : `${yr} CE`;
        ctx.fillText(lbl, x, Y + H - 4);
      }
    }
  }

  _drawYearLine() {
    const { ctx } = this;
    const x = this.yearToX(0);
    const W = this.canvas.width;
    if (x < 0 || x > W) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 220, 80, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.canvas.height);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(255, 220, 80, 0.8)';
    ctx.font = 'bold 9px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('0', x, this.DYN_H + this.RULER_H - 2);
    ctx.restore();
  }

  _drawEvents() {
    const { ctx } = this;
    const W = this.canvas.width;
    const BASE_Y = this.EVT_Y + 20;
    const TRACK_H = 42; // vertical spacing per track
    const R = 5;

    for (const ev of EVENTS) {
      const x = this.yearToX(ev.year);
      if (x < -20 || x > W + 20) continue;

      const catColor = (EVENT_CATEGORIES[ev.cat] || EVENT_CATEGORIES.political).color;
      const isHovered = this.hoveredEvent === ev;
      const dotY = BASE_Y + ev._track * TRACK_H;

      // Vertical connector line
      ctx.strokeStyle = catColor + '55';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, this.EVT_Y + 4);
      ctx.lineTo(x, dotY - R - 2);
      ctx.stroke();

      // Glow on hover
      if (isHovered) {
        ctx.save();
        ctx.shadowColor = catColor;
        ctx.shadowBlur  = 12;
        ctx.beginPath();
        ctx.arc(x, dotY, R + 3, 0, Math.PI * 2);
        ctx.fillStyle = catColor;
        ctx.fill();
        ctx.restore();
      }

      // Dot
      ctx.beginPath();
      ctx.arc(x, dotY, isHovered ? R + 2 : R, 0, Math.PI * 2);
      ctx.fillStyle = isHovered ? '#fff' : catColor;
      ctx.fill();
      ctx.strokeStyle = catColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Label — show when zoomed in or hovered
      if (this.zoom >= 3.5 || isHovered) {
        ctx.save();
        const fontSize = isHovered ? 11 : 10;
        ctx.font = `${isHovered ? '600 ' : ''}${fontSize}px 'Segoe UI', system-ui`;
        ctx.fillStyle = isHovered ? '#fff' : 'rgba(220,220,240,0.75)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const labelY = dotY + R + 3;
        const maxW = Math.max(70, this.zoom * 50);
        this._wrapText(ctx, ev.title, x, labelY, maxW, 13);
        ctx.restore();
      }
    }
  }

  _wrapText(ctx, text, cx, y, maxWidth, lineH) {
    const words = text.split(' ');
    let line = '';
    let lineY = y;
    for (const word of words) {
      const test = line + (line ? ' ' : '') + word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, cx, lineY);
        line = word;
        lineY += lineH;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, cx, lineY);
  }

  // ── Hit detection ───────────────────────────────────────────────────────────

  _eventAt(x, y) {
    const BASE_Y = this.EVT_Y + 20;
    const TRACK_H = 42;
    const HIT_R = 9;

    for (const ev of EVENTS) {
      const ex = this.yearToX(ev.year);
      const ey = BASE_Y + ev._track * TRACK_H;
      if (Math.hypot(x - ex, y - ey) <= HIT_R) return ev;
    }
    return null;
  }

  _onHover(x, y, clientX, clientY) {
    const ev = this._eventAt(x, y);
    if (ev !== this.hoveredEvent) {
      this.hoveredEvent = ev;
      this.render();
    }
    if (ev) {
      this.canvas.style.cursor = 'pointer';
      this._showTooltip(ev, clientX, clientY);
    } else {
      this.canvas.style.cursor = 'grab';
      this._hideTooltip();
    }
  }

  // ── Tooltip ─────────────────────────────────────────────────────────────────

  _showTooltip(ev, cx, cy) {
    const tt = document.getElementById('tooltip');
    const yr = ev.year < 0 ? `${Math.abs(ev.year)} BCE` : `${ev.year} CE`;
    tt.innerHTML = `<strong>${yr}: ${ev.title}</strong><br><em>${ev.dynasty}</em>`;
    tt.style.display = 'block';
    tt.style.left = (cx + 14) + 'px';
    tt.style.top  = (cy - 10) + 'px';
  }

  _hideTooltip() {
    document.getElementById('tooltip').style.display = 'none';
  }

  // ── Detail panel ─────────────────────────────────────────────────────────────

  _showDetail(ev) {
    const yr = ev.year < 0 ? `${Math.abs(ev.year)} BCE` : `${ev.year} CE`;
    const cat = EVENT_CATEGORIES[ev.cat] || EVENT_CATEGORIES.political;
    document.getElementById('event-content').innerHTML = `
      <div class="ev-year">${yr}</div>
      <h2>${ev.title}</h2>
      <div class="ev-dynasty">${ev.dynasty}</div>
      <span class="ev-cat" style="color:${cat.color};border-color:${cat.color};background:${cat.color}22">${cat.label}</span>
      <p class="ev-desc">${ev.desc}</p>
    `;
    document.getElementById('event-detail').classList.add('visible');
  }
}

window.addEventListener('DOMContentLoaded', () => new ChineseHistoryTimeline());
