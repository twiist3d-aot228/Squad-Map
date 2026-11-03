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

  _syncTiles() {
    const rect = this.viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const z = this._tileZoomForScale();
    const n = Math.pow(2, z);
    const worldPx = this.WORLD_PX * this.scale;
    const fx0 = Math.max(0, -this.tx / worldPx), fx1 = Math.min(1, (rect.width - this.tx) / worldPx);
    const fy0 = Math.max(0, -this.ty / worldPx), fy1 = Math.min(1, (rect.height - this.ty) / worldPx);
    if (fx1 <= fx0 || fy1 <= fy0) return;
    const x0 = Math.max(0, Math.floor(fx0 * n) - 1), x1 = Math.min(n - 1, Math.floor(fx1 * n) + 1);
    const y0 = Math.max(0, Math.floor(fy0 * n) - 1), y1 = Math.min(n - 1, Math.floor(fy1 * n) + 1);
    const key = [z, x0, x1, y0, y1].join("/");
    if (key === this.tileKey) return;
    this.tileKey = key;
    const sizePct = 100 / n;
    let html = "";
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        html += `<img alt="" draggable="false" src="${IZ_TILE_BASE}${z}/${x}/${y}.webp" ` +
          `style="left:${x * sizePct}%;top:${y * sizePct}%;width:${sizePct}%;height:${sizePct}%">`;
      }
    }
    this.tileLayer.innerHTML = html;
    // A tile that fails (offline, moved version) hides itself; the
    // schematic underneath shows through and the map stays usable.
    this.tileLayer.querySelectorAll("img").forEach((img) => {
      img.addEventListener("error", () => { img.style.display = "none"; });
    });
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
