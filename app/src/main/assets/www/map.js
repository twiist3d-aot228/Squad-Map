"use strict";

/*
 * SQUAD MAP — MAP MODULE
 * ======================
 * Renders the ChernarusPlus schematic into a pan/zoom viewport and owns all
 * coordinate math. World coordinates are DayZ meters: x grows east,
 * z grows north, the map is 15360 x 15360.
 *
 * SWAP POINT FOR REAL TILES: everything map-shaped lives in this file.
 * The tile layer LANDED Nov 3, 2026: iZurvive satellite tiles stream into
 * a .tile-layer div between the schematic and the pins, honouring the same
 * contract — screenToWorld(), worldToScreen(), focus(), render() — and the
 * schematic stays underneath as the offline fallback. The rest of the app
 * never noticed.
 */

const SquadMapGeo = (() => {
  const WORLD = 15360;

  /* Town positions in meters (x east, z north), approximately their real
     ChernarusPlus locations. `major` towns keep bigger labels. */
  const TOWNS = [
    { name: "Kamenka", x: 1189, z: 2252 },
    { name: "Komarovo", x: 3652, z: 2241 },
    { name: "Balota", x: 4528, z: 2346 },
    { name: "Chernogorsk", x: 6732, z: 2621, major: true },
    { name: "Prigorodki", x: 7471, z: 3368 },
    { name: "Elektrozavodsk", x: 10466, z: 2259, major: true },
    { name: "Kamyshevo", x: 12022, z: 3477 },
    { name: "Tulga", x: 12890, z: 4593 },
    { name: "Solnichniy", x: 13111, z: 6409 },
    { name: "Msta", x: 11263, z: 5497 },
    { name: "Staroye", x: 10110, z: 5454 },
    { name: "Berezino", x: 12483, z: 9650, major: true },
    { name: "Krasnostav", x: 11276, z: 12230, major: true },
    { name: "Svetlojarsk", x: 13911, z: 13267, major: true },
    { name: "Severograd", x: 8314, z: 13070, major: true },
    { name: "Tisy", x: 1674, z: 13947 },
    { name: "Kamensk", x: 787, z: 12123 },
    { name: "Sinistok", x: 1944, z: 10884 },
    { name: "Vavilovo", x: 3194, z: 11373 },
    { name: "Lopatino", x: 2766, z: 10057 },
    { name: "Vybor", x: 3778, z: 8854 },
    { name: "Pustoshka", x: 3065, z: 7322 },
    { name: "Pogorevka", x: 4521, z: 6488 },
    { name: "Rogovo", x: 4907, z: 7011 },
    { name: "Kabanino", x: 5224, z: 8645 },
    { name: "Grishino", x: 6050, z: 9489 },
    { name: "Stary Sobor", x: 6132, z: 7734, major: true },
    { name: "Novy Sobor", x: 7041, z: 7723 },
    { name: "Vyshnoye", x: 6563, z: 6037 },
    { name: "Mogilevka", x: 7565, z: 5220 },
    { name: "Nadezhdino", x: 5831, z: 4499 },
    { name: "Kozlovka", x: 4494, z: 4570 },
    { name: "Bor", x: 3255, z: 4127 },
    { name: "Pavlovo", x: 2073, z: 3403 },
    { name: "Myshkino", x: 1332, z: 5894 },
    { name: "Zelenogorsk", x: 2717, z: 5279, major: true },
    { name: "Guglovo", x: 8459, z: 6689 },
    { name: "Shakhovka", x: 9643, z: 6675 },
    { name: "Polana", x: 10397, z: 7793 },
    { name: "Dubrovka", x: 10048, z: 8158 },
    { name: "Gorka", x: 9514, z: 8845 },
    { name: "Orlovets", x: 8519, z: 5347 },
    { name: "NW Airfield", x: 4539, z: 10127, airfield: true },
    { name: "NE Airfield", x: 11942, z: 12573, airfield: true },
    { name: "Balota Airstrip", x: 4930, z: 2450, airfield: true }
  ];

  function gridRef(x, z) {
    const gx = String(Math.max(0, Math.min(153, Math.floor(x / 100)))).padStart(3, "0");
    const gz = String(Math.max(0, Math.min(153, Math.floor(z / 100)))).padStart(3, "0");
    return gx + " " + gz;
  }

  function nearest(x, z) {
    let best = null;
    let bestDist = Infinity;
    for (const t of TOWNS) {
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < bestDist) { bestDist = d; best = t; }
    }
    if (best && bestDist <= 2200) return { name: best.name, dist: Math.round(bestDist) };
    return { name: "Grid " + gridRef(x, z), dist: best ? Math.round(bestDist) : null };
  }

  return { WORLD, TOWNS, gridRef, nearest };
})();

/* ---------------------------------------------------------------------- */

/* iZurvive satellite tiles: 256px webp, slippy scheme, y=0 at the NORTH
   edge (verified against live tiles Nov 3, 2026 — NW tile is inland, SE
   tile is open sea). "1.26.0" is iZurvive's tile-set version segment: if
   a DayZ update ever moves it and tiles 404, the schematic underneath
   keeps the app usable and bumping this one string is the whole fix. */
const IZ_TILE_BASE = "https://maps.izurvive.com/maps/ChernarusPlus-Sat/1.26.0/tiles/";

/* Loot drop categories (loot-data.js codes) in iZurvive's spirit: a
   coloured disc per building usage, letter/star glyph at deep zoom. */
const LOOT_STYLE = {
  M: { color: "#7a9a4d", glyph: "★" }, P: { color: "#4a7dc9", glyph: "P" },
  D: { color: "#d94f4f", glyph: "+" }, F: { color: "#ef8f3c", glyph: "F" },
  X: { color: "#9a6bc9", glyph: "▦" }, H: { color: "#a3804f", glyph: "H" },
  I: { color: "#9aa3ab", glyph: "I" }, A: { color: "#86a860", glyph: "A" },
  O: { color: "#7f9bb3", glyph: "O" }, S: { color: "#b48ec9", glyph: "S" },
  R: { color: "#d6c07a", glyph: "⌂" }
};

class SquadMapView {
  constructor(viewportEl, worldEl, opts) {
    this.viewport = viewportEl;
    this.world = worldEl;
    this.onTap = opts.onTap || (() => {});
    this.onPinTap = opts.onPinTap || (() => {});
    this.WORLD_PX = 1600; // world div is square, this many CSS px before transform
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.pointers = new Map();
    this.dragDist = 0;
    this.lastTapAt = 0;
    this.pinchDist = 0;

    this.world.style.width = this.WORLD_PX + "px";
    this.world.style.height = this.WORLD_PX + "px";
    this.world.insertAdjacentHTML("afterbegin", this._buildSchematicSvg());
    this.tileLayer = document.createElement("div");
    this.tileLayer.className = "tile-layer";
    this.world.appendChild(this.tileLayer);
    this.tileKey = "";
    this.tileTimer = 0;
    this.tileZ = -1;
    this.tileEls = new Map();
    this.failedTiles = new Set();
    this.tierSvg = this._buildTierSvg();
    if (this.tierSvg) this.world.appendChild(this.tierSvg);
    this.lootCanvas = document.createElement("canvas");
    this.lootCanvas.className = "loot-canvas";
    this.lootCanvas.width = this.WORLD_PX;
    this.lootCanvas.height = this.WORLD_PX;
    this.world.appendChild(this.lootCanvas);
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "label-layer";
    this.world.appendChild(this.labelLayer);
    this._buildLabels();
    this.showTiers = true;
    this.showLoot = true;
    this.lootPts = null;
    this.pinLayer = document.createElement("div");
    this.pinLayer.className = "pin-layer";
    this.world.appendChild(this.pinLayer);

    this._bindPointerEvents();
    requestAnimationFrame(() => this.fit());
  }

  /* --- schematic SVG -------------------------------------------------- */

  _buildSchematicSvg() {
    const W = SquadMapGeo.WORLD;
    const Y = (z) => W - z; // SVG y grows south; world z grows north

    // Coastline in (x east, z north), walked clockwise from the NW corner.
    const coast = [
      [0, 15360], [15360, 15360], [15360, 14000], [15000, 13300], [14600, 12800],
      [14000, 11500], [13600, 10800], [13300, 9900], [13000, 8800], [12800, 7600],
      [13200, 6600], [13050, 5400], [12700, 4300], [12300, 3600], [11700, 2900],
      [11000, 2350], [10600, 2050], [10000, 2300], [9400, 2100], [8700, 2400],
      [7900, 2350], [7300, 2100], [6600, 2450], [5900, 2250], [5200, 2400],
      [4600, 2150], [4000, 2050], [3400, 2250], [2700, 2500], [2000, 2900],
      [1300, 2600], [700, 2200], [200, 2600], [0, 3000]
    ];
    const landPath = "M" + coast.map(([x, z]) => x + "," + Y(z)).join(" L") + " Z";

    let grid = "";
    for (let g = 0; g <= W; g += 1000) {
      grid += `<line x1="${g}" y1="0" x2="${g}" y2="${W}"/>`;
      grid += `<line x1="0" y1="${g}" x2="${W}" y2="${g}"/>`;
    }
    let gridLabels = "";
    for (let g = 0; g < W; g += 1000) {
      const ref = String(g / 100).padStart(3, "0");
      gridLabels += `<text x="${g + 70}" y="430">${ref}</text>`;
      gridLabels += `<text x="70" y="${W - g - 90}">${ref}</text>`;
    }

    const roads = [
      [[1189, 2252], [3652, 2241], [4528, 2346], [6732, 2621], [7471, 3368], [10466, 2259], [12022, 3477], [13111, 6409]],
      [[2717, 5279], [4521, 6488], [4907, 7011], [6132, 7734], [7041, 7723], [8459, 6689], [9514, 8845], [12483, 9650]],
      [[3778, 8854], [2766, 10057], [1944, 10884], [787, 12123]],
      [[6132, 7734], [6050, 9489], [8314, 13070]]
    ];
    const roadPaths = roads.map((pts) =>
      `<path d="M${pts.map(([x, z]) => x + "," + Y(z)).join(" L")}"/>`).join("");

    const runways = [
      [[4100, 10040], [4980, 10210], "NW AIRFIELD", 4539, 10520],
      [[11500, 12500], [12400, 12650], "NE AIRFIELD", 11942, 12990],
      [[4650, 2380], [5200, 2520], "BALOTA STRIP", 4930, 2950]
    ];
    const runwayLines = runways.map(([a, b]) =>
      `<line x1="${a[0]}" y1="${Y(a[1])}" x2="${b[0]}" y2="${Y(b[1])}"/>`).join("");
    const runwayLabels = runways.map(([, , label, lx, lz]) =>
      `<text x="${lx}" y="${Y(lz)}">${label}</text>`).join("");

    const townSvg = SquadMapGeo.TOWNS.filter((t) => !t.airfield).map((t) => {
      const r = t.major ? 85 : 52;
      const cls = t.major ? "town major" : "town";
      return `<g class="${cls}"><circle cx="${t.x}" cy="${Y(t.z)}" r="${r}"/>` +
        `<text x="${t.x}" y="${Y(t.z) - 150}">${t.name.toUpperCase()}</text></g>`;
    }).join("");

    return `
    <svg class="map-svg" viewBox="0 0 ${W} ${W}" preserveAspectRatio="none" aria-hidden="true">
      <rect x="0" y="0" width="${W}" height="${W}" fill="#131a20"/>
      <path d="${landPath}" fill="#26301f" stroke="#4a5a3c" stroke-width="34"/>
      <g stroke="#4c4636" stroke-width="30" fill="none" opacity="0.75">${roadPaths}</g>
      <g stroke="#8f8a7a" stroke-width="110" opacity="0.8">${runwayLines}</g>
      <g class="runway-labels">${runwayLabels}</g>
      <g stroke="#ffffff" stroke-opacity="0.07" stroke-width="8">${grid}</g>
      <g class="grid-labels" font-size="270" fill="#97a184">${gridLabels}</g>
      ${townSvg}
    </svg>`;
  }

  /* --- transform plumbing ---------------------------------------------- */

  _apply() {
    this.world.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    // Counter-scale pins so they stay a constant on-screen size.
    const inv = 1 / this.scale;
    this.pinLayer.querySelectorAll(".pin").forEach((pin) => {
      pin.style.setProperty("--pin-scale", String(inv));
    });
    // Place labels counter-scale off the same factor, and minor-town
    // labels fade in once the view is past ~2x fit zoom (iZurvive-style).
    this.world.style.setProperty("--inv-scale", String(inv));
    this.labelLayer.classList.toggle("minors", this.scale > (this.minScale || 0.2) * 2.4);
    this._queueTiles();
  }

  /* --- satellite tile layer ---------------------------------------------- */

  _tileZoomForScale() {
    // Pick the tile zoom whose native resolution is closest to what the
    // screen is showing: tile zoom z renders the world at 256 * 2^z px.
    const z = Math.round(Math.log2((this.WORLD_PX * this.scale) / 256));
    return Math.max(2, Math.min(8, z));
  }

  _queueTiles() {
    if (this.tileTimer) return;
    this.tileTimer = setTimeout(() => { this.tileTimer = 0; this._syncTiles(); }, 120);
  }

  _visibleFrac() {
    const rect = this.viewport.getBoundingClientRect();
    const worldPx = this.WORLD_PX * this.scale;
    return {
      rect,
      fx0: Math.max(0, -this.tx / worldPx), fx1: Math.min(1, (rect.width - this.tx) / worldPx),
      fy0: Math.max(0, -this.ty / worldPx), fy1: Math.min(1, (rect.height - this.ty) / worldPx)
    };
  }

  _syncTiles() {
    const v = this._visibleFrac();
    if (!v.rect.width || v.fx1 <= v.fx0 || v.fy1 <= v.fy0) return;
    const z = this._tileZoomForScale();
    if (z !== this.tileZ) { this.failedTiles.clear(); this.tileZ = z; }
    const n = Math.pow(2, z);
    const x0 = Math.max(0, Math.floor(v.fx0 * n) - 1), x1 = Math.min(n - 1, Math.floor(v.fx1 * n) + 1);
    const y0 = Math.max(0, Math.floor(v.fy0 * n) - 1), y1 = Math.min(n - 1, Math.floor(v.fy1 * n) + 1);
    const key = [z, x0, x1, y0, y1].join("/");
    if (key === this.tileKey) { this._drawLoot(z, v); return; }
    this.tileKey = key;
    const sizePct = 100 / n;
    const desired = new Set();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = z + "/" + x + "/" + y;
        desired.add(k);
        if (this.tileEls.has(k) || this.failedTiles.has(k)) continue;
        const img = document.createElement("img");
        img.alt = "";
        img.draggable = false;
        img.style.left = (x * sizePct) + "%";
        img.style.top = (y * sizePct) + "%";
        img.style.width = sizePct + "%";
        img.style.height = sizePct + "%";
        img.style.opacity = "0";
        img.addEventListener("load", () => { img.style.opacity = "1"; this._pruneTiles(desired); });
        img.addEventListener("error", () => { this.failedTiles.add(k); img.remove(); this.tileEls.delete(k); });
        img.src = IZ_TILE_BASE + z + "/" + x + "/" + y + ".webp";
        this.tileEls.set(k, img);
        this.tileLayer.appendChild(img);
      }
    }
    this._pruneTiles(desired);
    this._drawLoot(z, v);
  }

  _pruneTiles(desired) {
    // Old tiles stay on screen until their replacements have loaded —
    // swapping the whole layer at once is what made the map (and the old
    // schematic labels under it) flash during pans and zooms.
    let loaded = 0;
    for (const k of desired) {
      const el = this.tileEls.get(k);
      if (el && el.style.opacity === "1") loaded++;
    }
    const allIn = loaded >= desired.size;
    if (!allIn && this.tileEls.size <= 170) return;
    for (const [k, el] of this.tileEls) {
      if (!desired.has(k)) { el.remove(); this.tileEls.delete(k); }
    }
  }

  /* --- tier zones ---------------------------------------------------------- */

  _buildTierSvg() {
    const tiers = window.SQUADMAP_TIERS;
    if (!tiers) return null;
    const W = SquadMapGeo.WORLD;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${W}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "tier-svg");
    svg.setAttribute("aria-hidden", "true");
    const fills = { "1": "rgba(120,200,90,0.13)", "2": "rgba(240,200,60,0.15)", "3": "rgba(240,140,40,0.15)", "4": "rgba(230,60,50,0.19)" };
    const strokes = { "1": "rgba(120,200,90,0.45)", "2": "rgba(240,200,60,0.5)", "3": "rgba(240,140,40,0.55)", "4": "rgba(230,60,50,0.6)" };
    let html = "";
    for (const t of ["1", "2", "3", "4"]) {
      for (const ring of tiers[t] || []) {
        html += `<polygon points="${ring}" fill="${fills[t]}" stroke="${strokes[t]}" stroke-width="26" stroke-linejoin="round"/>`;
      }
    }
    const label = (x, z, text) => `<text class="tier-text" x="${x}" y="${W - z}">${text}</text>`;
    html += label(7200, 2400, "TIER 1") + label(9900, 5900, "TIER 2") +
            label(5000, 9300, "TIER 3") + label(1750, 13900, "TIER 4");
    svg.innerHTML = html;
    return svg;
  }

  toggleTiers() {
    this.showTiers = !this.showTiers;
    if (this.tierSvg) this.tierSvg.style.display = this.showTiers ? "" : "none";
    return this.showTiers;
  }

  /* --- place labels ---------------------------------------------------------- */

  _buildLabels() {
    const W = SquadMapGeo.WORLD;
    let html = "";
    for (const t of SquadMapGeo.TOWNS) {
      const cls = "map-label" + (t.major ? " major" : "") + (t.airfield ? " airfield minor" : " minor");
      html += `<span class="${cls}" style="left:${t.x / W * 100}%;top:${(1 - t.z / W) * 100}%">${t.name.toUpperCase()}</span>`;
    }
    this.labelLayer.innerHTML = html;
  }

  /* --- loot drop points ------------------------------------------------------- */

  _lootPoints() {
    if (this.lootPts) return this.lootPts;
    const raw = window.SQUADMAP_LOOT || {};
    const pts = [];
    for (const code of Object.keys(raw)) {
      for (const pair of raw[code].split(";")) {
        const [x, z] = pair.split(",");
        pts.push([+x, +z, code]);
      }
    }
    this.lootPts = pts;
    return pts;
  }

  _drawLoot(z, v) {
    const ctx = this.lootCanvas.getContext("2d");
    const S = this.WORLD_PX;
    ctx.clearRect(0, 0, S, S);
    if (!this.showLoot) return;
    const pts = this._lootPoints();
    if (!pts.length) return;
    const W = SquadMapGeo.WORLD;
    const wx0 = v.fx0 * W - 300, wx1 = v.fx1 * W + 300;
    const wz0 = (1 - v.fy1) * W - 300, wz1 = (1 - v.fy0) * W + 300;
    const discs = z >= 6;
    const targetPx = discs ? 13 : (z <= 3 ? 3 : (z === 4 ? 4 : 5.5));
    const r = targetPx / this.scale;
    const byCat = {};
    for (const [x, z2, code] of pts) {
      if (x < wx0 || x > wx1 || z2 < wz0 || z2 > wz1) continue;
      (byCat[code] = byCat[code] || []).push([x / W * S, (1 - z2 / W) * S]);
    }
    for (const code of Object.keys(byCat)) {
      const st = LOOT_STYLE[code];
      if (!st) continue;
      ctx.beginPath();
      for (const [cx, cy] of byCat[code]) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, 6.2832); }
      ctx.fillStyle = st.color;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      if (discs) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = r * 0.22;
        ctx.strokeStyle = "rgba(10,10,10,0.55)";
        ctx.stroke();
      }
    }
    if (discs) {
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 " + (r * 1.15) + "px sans-serif";
      for (const code of Object.keys(byCat)) {
        const st = LOOT_STYLE[code];
        if (!st || !st.glyph) continue;
        for (const [cx, cy] of byCat[code]) ctx.fillText(st.glyph, cx, cy + r * 0.06);
      }
    }
    ctx.globalAlpha = 1;
  }

  toggleLoot() {
    this.showLoot = !this.showLoot;
    this._drawLoot(this._tileZoomForScale(), this._visibleFrac());
    return this.showLoot;
  }

  fit() {
    const rect = this.viewport.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height) || this.WORLD_PX;
    this.scale = size / this.WORLD_PX;
    this.tx = (rect.width - this.WORLD_PX * this.scale) / 2;
    this.ty = (rect.height - this.WORLD_PX * this.scale) / 2;
    this.minScale = this.scale * 0.85;
    this.maxScale = this.scale * 48; // deep enough for native-res z6 tiles
    this._apply();
  }

  _clamp() {
    this.scale = Math.max(this.minScale || 0.1, Math.min(this.maxScale || 10, this.scale));
    const rect = this.viewport.getBoundingClientRect();
    const worldSize = this.WORLD_PX * this.scale;
    const slack = 120;
    if (worldSize <= rect.width) this.tx = (rect.width - worldSize) / 2;
    else this.tx = Math.max(rect.width - worldSize - slack, Math.min(slack, this.tx));
    if (worldSize <= rect.height) this.ty = (rect.height - worldSize) / 2;
    else this.ty = Math.max(rect.height - worldSize - slack, Math.min(slack, this.ty));
  }

  zoomAt(clientX, clientY, factor) {
    const rect = this.viewport.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const wx = (px - this.tx) / this.scale;
    const wy = (py - this.ty) / this.scale;
    this.scale *= factor;
    this._clamp();
    this.tx = px - wx * this.scale;
    this.ty = py - wy * this.scale;
    this._clamp();
    this._apply();
  }

  zoomStep(factor) {
    const rect = this.viewport.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  screenToWorld(clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    const fx = (clientX - rect.left - this.tx) / (this.WORLD_PX * this.scale);
    const fy = (clientY - rect.top - this.ty) / (this.WORLD_PX * this.scale);
    return {
      x: Math.round(fx * SquadMapGeo.WORLD),
      z: Math.round((1 - fy) * SquadMapGeo.WORLD)
    };
  }

  focus(x, z) {
    const rect = this.viewport.getBoundingClientRect();
    const targetScale = Math.max(this.scale, (Math.min(rect.width, rect.height) / this.WORLD_PX) * 3.2);
    this.scale = Math.min(targetScale, this.maxScale || targetScale);
    const fx = x / SquadMapGeo.WORLD;
    const fy = 1 - z / SquadMapGeo.WORLD;
    this.tx = rect.width / 2 - fx * this.WORLD_PX * this.scale;
    this.ty = rect.height / 2 - fy * this.WORLD_PX * this.scale;
    this._clamp();
    this._apply();
  }

  /* --- input ------------------------------------------------------------ */

  _bindPointerEvents() {
    const el = this.viewport;
    el.style.touchAction = "none";

    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragDist = 0;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });

    el.addEventListener("pointermove", (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const prev = this.pointers.get(e.pointerId);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 1) {
        this.dragDist += Math.abs(dx) + Math.abs(dy);
        if (this.dragDist > 4) {
          this.tx += dx;
          this.ty += dy;
          this._clamp();
          this._apply();
        }
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDist > 0) {
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          this.zoomAt(midX, midY, dist / this.pinchDist);
        }
        this.pinchDist = dist;
        this.dragDist = 99; // a pinch is never a tap
      }
    });

    const release = (e) => {
      const wasTap = this.pointers.size === 1 && this.dragDist <= 6;
      this.pointers.delete(e.pointerId);
      if (wasTap) {
        const now = Date.now();
        if (now - this.lastTapAt > 250) {
          this.lastTapAt = now;
          const pos = this.screenToWorld(e.clientX, e.clientY);
          if (pos.x >= 0 && pos.x <= SquadMapGeo.WORLD && pos.z >= 0 && pos.z <= SquadMapGeo.WORLD) {
            this.onTap(pos);
          }
        }
      }
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", (e) => this.pointers.delete(e.pointerId));

    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 0.89);
    }, { passive: false });
  }

  /* --- pins -------------------------------------------------------------- */

  render(members, tags, myId) {
    this.pinLayer.innerHTML = "";
    const W = SquadMapGeo.WORLD;

    for (const t of tags) {
      if (t.x == null) continue;
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "pin pin-tag cat-" + t.category.replace(/\s+/g, "-").toLowerCase();
      pin.style.left = (t.x / W * 100) + "%";
      pin.style.top = ((1 - t.z / W) * 100) + "%";
      pin.innerHTML = `<span class="pin-diamond"><span class="pin-diamond-letter">${t.category.charAt(0)}</span></span>`;
      pin.setAttribute("aria-label", t.category + ": " + t.title);
      pin.addEventListener("pointerdown", (e) => e.stopPropagation());
      pin.addEventListener("click", (e) => { e.stopPropagation(); this.onPinTap("tag", t); });
      this.pinLayer.appendChild(pin);
    }

    for (const m of members) {
      if (m.x == null || m.z == null) continue;
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "pin pin-member" + (m.online ? " online" : " offline") + (m.id === myId ? " me" : "");
      pin.style.left = (m.x / W * 100) + "%";
      pin.style.top = ((1 - m.z / W) * 100) + "%";
      const initials = m.name.trim().split(/\s+/).map((w) => w.charAt(0)).slice(0, 2).join("").toUpperCase();
      pin.innerHTML = `<span class="pin-dot">${initials}</span><span class="pin-name">${m.name}</span>`;
      pin.setAttribute("aria-label", m.name + (m.online ? " online" : " last seen"));
      pin.addEventListener("pointerdown", (e) => e.stopPropagation());
      pin.addEventListener("click", (e) => { e.stopPropagation(); this.onPinTap("member", m); });
      this.pinLayer.appendChild(pin);
    }

    this._apply();
  }

  flashAt(x, z) {
    const W = SquadMapGeo.WORLD;
    const ring = document.createElement("div");
    ring.className = "pin-flash";
    ring.style.left = (x / W * 100) + "%";
    ring.style.top = ((1 - z / W) * 100) + "%";
    this.pinLayer.appendChild(ring);
    setTimeout(() => ring.remove(), 2400);
  }
}
