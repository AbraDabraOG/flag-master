/* Flag Master — interactive map widget.
   Two maps: a draggable orthographic globe (world) and a pan/zoom Albers USA map (states).
   Drawn on a canvas with d3-geo; features carry Flag Master ids in properties.ids. */
(() => {
'use strict';
const G = window.FM_GEO;
const SMALL_SR = 0.00025;          // ~10,000 km²: below this a feature also gets a clickable dot
const DEG = 180 / Math.PI;

function build(kind) {
  let features;
  if (kind === 'us') {
    features = topojson.feature(G.us, G.us.objects.states).features.filter(f => f.properties.ids.length);
  } else {
    features = topojson.feature(G.world, G.world.objects.countries).features;
    G.points.forEach(([id, lon, lat]) => features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { ids: [id], n: '' } }));
  }
  // Tolerances in degrees for the two simplified levels of detail.
  const [tolMid, tolLow] = kind === 'us' ? [0.01, 0.04] : [0.03, 0.18];
  features.forEach(f => {
    const isPt = f.geometry.type === 'Point';
    f.isPt = isPt;
    f.c = isPt ? f.geometry.coordinates : d3.geoCentroid(f);
    f.b = isPt ? null : d3.geoBounds(f);
    f.sr = isPt ? 0 : d3.geoArea(f);
    f.small = isPt || f.sr < SMALL_SR;
    if (!isPt) {
      f.mid = simplifyFeature(f, tolMid);
      f.low = simplifyFeature(f, tolLow);
      // angular radius around the centroid, used to skip countries on the far side of the globe
      const [[w, s], [e, n]] = f.b;
      f.rad = (e - w > 180 || w > e) ? Math.PI : Math.max(...[[w, s], [w, n], [e, s], [e, n]].map(p => d3.geoDistance(f.c, p))) + 0.02;
    }
  });
  const byId = new Map();
  features.forEach((f, i) => f.properties.ids.forEach(id => { if (!byId.has(id)) byId.set(id, i); }));
  return { features, byId };
}
// Douglas-Peucker simplification in lon/lat. Good enough for drawing; hit-testing uses the full shapes.
// Points on either side of an antimeridian jump are always kept.
function simplifyRing(ring, tol) {
  const n = ring.length; if (n <= 4) return ring;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  for (let i = 0; i < n - 1; i++) if (Math.abs(ring[i + 1][0] - ring[i][0]) > 180) keep[i] = keep[i + 1] = 1;
  // measure in ground terms: a degree of longitude shrinks with latitude
  let lat = 0; for (let i = 0; i < n; i++) lat += ring[i][1];
  const kx = Math.max(0.05, Math.cos(lat / n * Math.PI / 180));
  const t2 = tol * tol, stack = [];
  let a = 0;
  for (let b = 1; b < n; b++) if (keep[b]) { if (b - a > 1) stack.push([a, b]); a = b; }
  while (stack.length) {
    const [s, e] = stack.pop();
    const x1 = ring[s][0] * kx, y1 = ring[s][1], x2 = ring[e][0] * kx, y2 = ring[e][1], dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    let best = -1, bd = t2;
    for (let i = s + 1; i < e; i++) {
      const x = ring[i][0] * kx, y = ring[i][1];
      let d;
      if (!L) d = (x - x1) ** 2 + (y - y1) ** 2;
      else { const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L)); d = (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2; }
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; if (best - s > 1) stack.push([s, best]); if (e - best > 1) stack.push([best, e]); }
  }
  const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i]);
  return out;
}
function simplifyFeature(f, tol) {
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
  if (!polys) return f;
  const kept = [];
  const ext = r => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; r.forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }); return Math.max(x1 - x0, y1 - y0); };
  const sizes = polys.map(r => ext(r[0])), biggest = sizes.indexOf(Math.max(...sizes));
  polys.forEach((rings, pi) => {
    if (pi !== biggest && sizes[pi] < tol * 3) return;   // specks of islands vanish at this detail
    const outer = simplifyRing(rings[0], tol);
    let outer2 = outer;
    if (outer.length < 4) {
      if (pi !== biggest) return;
      // a ring that simplifies to nothing (e.g. the circle round the South Pole): keep evenly spaced points
      const r = rings[0], step = Math.max(1, Math.floor((r.length - 1) / 12));
      outer2 = r.filter((_, i) => i % step === 0); outer2.push(r[r.length - 1]);
      if (outer2.length < 4) { kept.push(rings); return; }
    }
    const poly = [outer2, ...rings.slice(1).filter(r => ext(r) >= tol * 3).map(r => simplifyRing(r, tol)).filter(r => r.length >= 4)];
    // a ring that collapsed can flip its winding and cover the whole sphere: fall back to the original
    kept.push(d3.geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI ? rings : poly);
  });
  if (!kept.length) return f;
  return { type: 'Feature', properties: f.properties, geometry: { type: 'MultiPolygon', coordinates: kept } };
}
const cache = {};
const data = kind => cache[kind] || (cache[kind] = build(kind));

const US_IDS = new Set(), WORLD_IDS = new Set();
if (G) {
  G.us.objects.states.geometries.forEach(g => g.properties.ids.forEach(id => US_IDS.add(id)));
  G.world.objects.countries.geometries.forEach(g => g.properties.ids.forEach(id => WORLD_IDS.add(id)));
  G.points.forEach(p => WORLD_IDS.add(p[0]));
}

function inBounds(b, p) {
  const [[w, s], [e, n]] = b; const [lon, lat] = p;
  if (lat < s - 0.01 || lat > n + 0.01) return false;
  return w <= e ? lon >= w - 0.01 && lon <= e + 0.01 : lon >= w || lon <= e;
}
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function create(opts) {
  const kind = opts.kind;           // 'world' | 'us'
  const { features, byId } = data(kind);
  const el = document.createElement('div'); el.className = 'map-wrap';
  el.innerHTML = `<canvas></canvas><div class="map-ctl"><button class="btn sm" data-z="in" title="Zoom in">+</button><button class="btn sm" data-z="out" title="Zoom out">−</button><button class="btn sm" data-z="home" title="Reset view">⌂</button></div>`;
  const canvas = el.querySelector('canvas'); const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let pool = new Set(opts.pool || []);
  let result = null;                // { good: Set, badIdx: number }
  let hover = -1;
  let anim = null;
  let colors = {};
  let marks = null;                 // { id: css colour variable } (Border Hop route)
  const markColor = {};
  let hideRest = false;              // Border Hop: places without a mark are not drawn or hoverable
  const shown = i => !hideRest || !marks || features[i].properties.ids.some(id => marks[id]);
  const proj = kind === 'us' ? d3.geoAlbersUsa() : d3.geoOrthographic().clipAngle(90).precision(0.3);
  const path = d3.geoPath(proj, ctx);
  const grat = kind === 'world' ? d3.geoGraticule10() : null;
  // view: world {rot:[λ,φ], s} where s is a multiple of the base scale; us {k, T:[x,y]} relative to a fitted base
  let base = { s: 1, t: [0, 0] };
  let view = null, home = null;

  function readColors() {
    colors = { ocean: css('--map-ocean'), land: css('--map-land'), dim: css('--map-dim'), border: css('--map-border'), hover: css('--map-hover'), good: css('--good'), bad: css('--bad'), grat: css('--map-grat'), rim: css('--line-2') };
  }
  function fitBase() {
    if (kind === 'us') {
      proj.scale(1).translate([0, 0]);
      const fc = { type: 'FeatureCollection', features };
      proj.fitExtent([[16, 16], [W - 16, H - 16]], fc);
      base = { s: proj.scale(), t: proj.translate() };
      const pb = d3.geoPath(proj); features.forEach(f => { if (!f.isPt) f.sb = pb.bounds(f); });
    } else base = { s: Math.min(W, H) / 2 - 12, t: [W / 2, H / 2] };
  }
  function apply() {
    if (kind === 'us') { proj.scale(base.s * view.k).translate([base.t[0] * view.k + view.T[0], base.t[1] * view.k + view.T[1]]); }
    else proj.rotate([view.rot[0], view.rot[1], 0]).scale(base.s * view.s).translate([W / 2, H / 2]);
  }
  // Projected area of a feature is about steradians × scale² for both projections (near the centre).
  const needsDot = f => f.small && (f.isPt || f.sr * proj.scale() * proj.scale() < 120);
  const center = () => [-view.rot[0], -view.rot[1]];
  const visible = f => kind === 'us' || d3.geoDistance(f.c, center()) < Math.PI / 2 - 0.02;
  let viewR = Math.PI / 2;                 // angular radius of the globe that fits on screen
  function onScreen(f, c) {
    if (f.isPt) return true;
    if (kind === 'world') return d3.geoDistance(f.c, c) - f.rad < viewR;
    const b = f.sb; if (!b) return true;     // U.S.: bounds at zoom 1, mapped through the current zoom/pan
    return b[1][0] * view.k + view.T[0] >= 0 && b[0][0] * view.k + view.T[0] <= W && b[1][1] * view.k + view.T[1] >= 0 && b[0][1] * view.k + view.T[1] <= H;
  }

  // Rendering: the whole map goes into an offscreen "base" canvas, rebuilt only when the view, pool,
  // result or theme changes. Hover just copies the base and paints the one hovered place on top.
  // While the view is moving, simplified outlines are used and the full detail returns once it settles.
  const baseCv = document.createElement('canvas'), bctx = baseCv.getContext('2d');
  let baseValid = false, moving = false, idleTimer = 0, dots = [];
  const zoom = () => kind === 'us' ? view.k : view.s;
  function lod(f) {
    const z = zoom();
    if (moving) return z < 3.5 ? f.low : f.mid;
    return z < 2.5 ? f.mid : f;
  }
  function baseColor(i) {
    const ids = features[i].properties.ids;
    if (marks) { const m = ids.find(id => marks[id]); if (m) return markColor[marks[m]] || (markColor[marks[m]] = css(marks[m])); }
    if (result) {
      if (ids.some(id => result.good.has(id))) return colors.good;
      if (i === result.badIdx) return colors.bad;
    }
    return ids.some(id => pool.has(id)) ? colors.land : colors.dim;
  }
  function renderBase() {
    apply();
    proj.precision(moving ? 0 : 0.4);
    const g = bctx; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const P = d3.geoPath(proj, g);
    if (kind === 'world') {
      g.beginPath(); P({ type: 'Sphere' }); g.fillStyle = colors.ocean; g.fill();
      g.beginPath(); P(grat); g.strokeStyle = colors.grat; g.lineWidth = 0.6; g.stroke();
    }
    // one path per colour: a few fill calls instead of ~240
    const c = kind === 'world' ? center() : null;
    if (kind === 'world') viewR = Math.min(Math.PI / 2, Math.asin(Math.min(1, Math.hypot(W, H) / 2 / proj.scale())) + 0.02);
    const groups = new Map();
    features.forEach((f, i) => {
      if (f.isPt || !onScreen(f, c) || !shown(i)) return;
      const col = baseColor(i);
      if (!groups.has(col)) groups.set(col, []);
      groups.get(col).push(f);
    });
    const all = new Path2D();
    groups.forEach((fs, col) => {
      const p2 = new Path2D(); const Pp = d3.geoPath(proj, p2);
      fs.forEach(f => Pp(lod(f)));
      g.fillStyle = col; g.fill(p2); all.addPath(p2);
    });
    g.strokeStyle = colors.border; g.lineWidth = 0.6; g.stroke(all);
    // dots for tiny places that are part of this quiz (or part of the answer)
    dots = [];
    features.forEach((f, i) => {
      if (!f.small || !needsDot(f)) return;
      const ids = f.properties.ids;
      if (!shown(i)) return;
      const inPool = ids.some(id => pool.has(id));
      const relevant = inPool || (hideRest && marks) || (result && (i === result.badIdx || ids.some(id => result.good.has(id))));
      if (!relevant || !visible(f)) return;
      const p = proj(f.c); if (!p) return;
      if (inPool) dots.push({ i, x: p[0], y: p[1] });
      g.beginPath(); g.arc(p[0], p[1], 5, 0, 2 * Math.PI);
      g.fillStyle = baseColor(i); g.fill(); g.lineWidth = 1.5; g.strokeStyle = colors.border; g.stroke();
    });
    if (kind === 'world') { g.beginPath(); P({ type: 'Sphere' }); g.strokeStyle = colors.rim; g.lineWidth = 1.2; g.stroke(); }
    baseValid = true;
  }
  function draw() {
    if (!W) return;
    if (!baseValid) renderBase();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseCv, 0, 0);
    if (hover >= 0 && !result && !moving) {
      const f = features[hover];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const d = dots.find(o => o.i === hover);
      if (d) { ctx.beginPath(); ctx.arc(d.x, d.y, 6.5, 0, 2 * Math.PI); ctx.fillStyle = colors.hover; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = colors.border; ctx.stroke(); }
      else if (!f.isPt) { apply(); ctx.beginPath(); path(lod(f)); ctx.fillStyle = colors.hover; ctx.fill(); ctx.strokeStyle = colors.border; ctx.lineWidth = 0.6; ctx.stroke(); }
    }
  }
  let raf = 0; const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  const invalidate = () => { baseValid = false; redraw(); };
  // call after every view change; full detail comes back 160 ms after the last one
  function moved() {
    moving = true; hover = -1; invalidate();
    clearTimeout(idleTimer); idleTimer = setTimeout(() => { moving = false; invalidate(); }, 160);
  }

  function hit(x, y) {
    apply();
    // dots first, they sit on top
    let best = -1, bd = 8;
    dots.forEach(o => { const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; best = o.i; } });
    if (best >= 0) return best;
    if (kind === 'world' && Math.hypot(x - W / 2, y - H / 2) > proj.scale()) return -1;
    const ll = proj.invert([x, y]); if (!ll || isNaN(ll[0])) return -1;
    for (let i = 0; i < features.length; i++) { const f = features[i]; if (f.isPt || !inBounds(f.b, ll)) continue; if (d3.geoContains(f, ll)) return shown(i) ? i : -1; }
    return -1;
  }

  // ---- view targets ----
  function fitFor(fs) {
    // returns a view that centres and frames the given features
    if (kind === 'us') {
      const k0 = view ? { ...view } : { k: 1, T: [0, 0] };
      view = { k: 1, T: [0, 0] }; apply();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const pb = d3.geoPath(proj);
      fs.forEach(f => { const b = f.isPt ? [proj(f.c), proj(f.c)] : pb.bounds(f); if (!b[0] || !isFinite(b[0][0])) return; x0 = Math.min(x0, b[0][0]); y0 = Math.min(y0, b[0][1]); x1 = Math.max(x1, b[1][0]); y1 = Math.max(y1, b[1][1]); });
      view = k0;
      if (!isFinite(x0)) return { k: 1, T: [0, 0] };
      const k = Math.max(1, Math.min(8, 0.6 * Math.min(W / Math.max(30, x1 - x0), H / Math.max(30, y1 - y0))));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      // a point at p under k=1 maps to base.t*k + T + (p - base.t)*k  =>  choose T so (cx,cy) lands in the centre
      return { k, T: [W / 2 - cx * k, H / 2 - cy * k] };
    }
    // centre on the average member, not the area-weighted centroid (Russia would drag Europe east)
    const c = fs.length === 1 ? fs[0].c : d3.geoCentroid({ type: 'MultiPoint', coordinates: fs.map(f => f.c) });
    let r = 0, fill;
    if (fs.length === 1) {
      const f = fs[0]; fill = 0.42;
      (f.isPt ? [f.c] : [f.b[0], f.b[1], [f.b[0][0], f.b[1][1]], [f.b[1][0], f.b[0][1]]]).forEach(p => { r = Math.max(r, d3.geoDistance(c, p)); });
    } else {
      // frame most of the region; a far-flung member (Russia in Europe, Alaska) should not zoom the whole view out
      const d = fs.map(f => d3.geoDistance(c, f.c)).sort((a, b) => a - b);
      r = d[Math.floor(d.length * 0.85)] + 0.06; fill = 0.95;
    }
    r = Math.max(r, 0.04);
    const s = r > 1.3 ? 1 : Math.max(1, Math.min(30, fill / Math.sin(r)));
    return { rot: [-c[0], -c[1]], s };
  }
  function animateTo(target, ms = 700) {
    cancelAnimationFrame(anim);
    const from = JSON.parse(JSON.stringify(view));
    if (kind === 'world') { let d = target.rot[0] - from.rot[0]; d = ((d + 540) % 360) - 180; target = { rot: [from.rot[0] + d, target.rot[1]], s: target.s }; }
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / ms), e = ease(t);
      if (kind === 'world') {
        // ease the zoom out-then-in a little for long hops so you can see where you are going
        view = { rot: [from.rot[0] + (target.rot[0] - from.rot[0]) * e, from.rot[1] + (target.rot[1] - from.rot[1]) * e], s: Math.exp(Math.log(from.s) + (Math.log(target.s) - Math.log(from.s)) * e) };
      } else {
        view = { k: from.k + (target.k - from.k) * e, T: [from.T[0] + (target.T[0] - from.T[0]) * e, from.T[1] + (target.T[1] - from.T[1]) * e] };
      }
      moving = true; hover = -1; baseValid = false; draw();
      if (t < 1) anim = requestAnimationFrame(step); else moved();
    };
    anim = requestAnimationFrame(step);
  }
  function zoomBy(f, cx = W / 2, cy = H / 2) {
    cancelAnimationFrame(anim);
    if (kind === 'us') {
      const k = Math.max(1, Math.min(14, view.k * f)), r = k / view.k;
      const tx = base.t[0] * view.k + view.T[0], ty = base.t[1] * view.k + view.T[1];
      const ntx = cx - (cx - tx) * r, nty = cy - (cy - ty) * r;
      view = { k, T: [ntx - base.t[0] * k, nty - base.t[1] * k] };
    } else view = { ...view, s: Math.max(0.9, Math.min(40, view.s * f)) };
    moved();
  }

  // ---- input ----
  let down = null;
  // two-finger pinch zoom (phones): pointers on the canvas, and the last finger spread
  const touches = new Map(); let pinch = null;
  const spread = () => { const [a, b] = [...touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; try { canvas.setPointerCapture(e.pointerId); } catch (err) {} cancelAnimationFrame(anim);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { pinch = spread(); down = null; el.classList.remove('dragging'); return; }
    if (touches.size > 2 || pinch) return;
    down = { x: e.clientX, y: e.clientY, v: JSON.parse(JSON.stringify(view)), drag: false };
  });
  const lift = e => { touches.delete(e.pointerId); if (!touches.size) pinch = null; };
  canvas.addEventListener('pointerup', lift); canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (touches.size < 2) return;
      const now = spread(); if (pinch.d > 0 && now.d > 0) zoomBy(now.d / pinch.d, now.x - r.left, now.y - r.top);
      pinch = now; return;
    }
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.drag && Math.hypot(dx, dy) > (e.pointerType === 'touch' ? 10 : 4)) { down.drag = true; el.classList.add('dragging'); }
      if (down.drag) {
        if (kind === 'us') view = { k: down.v.k, T: [down.v.T[0] + dx, down.v.T[1] + dy] };
        else { const k = DEG / (base.s * down.v.s); view = { s: down.v.s, rot: [down.v.rot[0] + dx * k, Math.max(-89, Math.min(89, down.v.rot[1] - dy * k))] }; }
        moved(); return;
      }
    }
    if (result) { if (hover !== -1) { hover = -1; redraw(); } canvas.style.cursor = 'grab'; return; }
    // hit-test at most once per frame, at the latest pointer position
    hoverAt = [x, y];
    if (!hoverRaf) hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0; if (!hoverAt || down?.drag || moving) return;
      const i = hit(hoverAt[0], hoverAt[1]);
      canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
      if (i !== hover) { hover = i; draw(); }
    });
  });
  let hoverAt = null, hoverRaf = 0;
  const up = e => {
    if (!down) return;
    const wasDrag = down.drag; down = null; el.classList.remove('dragging');
    if (wasDrag || e.type === 'pointercancel') return;
    const r = canvas.getBoundingClientRect(); const i = hit(e.clientX - r.left, e.clientY - r.top);
    if (i >= 0 && opts.onPick) opts.onPick({ ids: features[i].properties.ids, name: features[i].properties.n, index: i });
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { hoverAt = null; if (hover !== -1 && !down) { hover = -1; redraw(); } });
  canvas.addEventListener('wheel', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  el.querySelector('.map-ctl').addEventListener('click', e => {
    const z = e.target.closest('[data-z]')?.dataset.z; if (!z) return;
    if (z === 'in') zoomBy(1.5); else if (z === 'out') zoomBy(1 / 1.5); else animateTo(JSON.parse(JSON.stringify(home)), 500);
  });

  function resize() {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
    const first = !W;
    W = r.width; H = r.height; dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    baseCv.width = canvas.width; baseCv.height = canvas.height; baseValid = false;
    fitBase();
    if (first) { home = homeView(); view = JSON.parse(JSON.stringify(opts.view || home)); }
    readColors(); draw();
  }
  function homeView() {
    const fs = [...pool].map(id => byId.get(id)).filter(i => i != null).map(i => features[i]);
    if (!fs.length) return kind === 'us' ? { k: 1, T: [0, 0] } : { rot: [-10, -25], s: 1 };
    if (kind === 'world' && fs.length > 60) return { rot: [-10, -25], s: 1 };
    return fitFor(fs);
  }
  const ro = new ResizeObserver(() => resize()); ro.observe(el);

  return {
    el, kind,
    get view() { return view; },
    setPool(ids) { pool = new Set(ids); home = W ? homeView() : home; invalidate(); },
    showResult(goodId, badIndex) { result = { good: new Set([goodId]), badIdx: badIndex == null ? -1 : badIndex }; hover = -1; invalidate(); },
    clearResult() { result = null; invalidate(); },
    setMarks(m, o = {}) { marks = m && Object.keys(m).length ? m : null; hideRest = !!o.hideRest; for (const k in markColor) delete markColor[k]; invalidate(); },
    fitTo(ids, ms = 600) { const fs = ids.map(id => byId.get(id)).filter(i => i != null).map(i => features[i]); if (fs.length && W) { const t = fitFor(fs); if (kind === 'world') t.s = Math.min(t.s, 8); animateTo(t, ms); } },
    flyTo(id, { zoom = true } = {}) {
      const i = byId.get(id); if (i == null || !W) return;
      const f = features[i]; const t = fitFor([f]);
      if (kind === 'world') { if (!zoom) t.s = view.s; else t.s = Math.max(view.s, Math.min(t.s, 14)); if (!f.small && view.s > t.s) t.s = view.s; }
      else if (!zoom || t.k < view.k) t.k = view.k, t.T = fitForKeepZoom(f);
      animateTo(t);
    },
    goHome(ms = 500) { if (home && W) animateTo(JSON.parse(JSON.stringify(home)), ms); },
    zoomedIn() { return view && home && (kind === 'us' ? view.k > home.k * 1.6 : view.s > home.s * 1.6); },
    refresh() { readColors(); invalidate(); },
    // screen position of a place (used by the automated smoke test)
    pointOf(id) { const i = byId.get(id); if (i == null) return null; apply(); const p = proj(features[i].c); return p && visible(features[i]) ? p : null; },
    resize,
    destroy() { ro.disconnect(); cancelAnimationFrame(anim); cancelAnimationFrame(raf); cancelAnimationFrame(hoverRaf); clearTimeout(idleTimer); el.remove(); },
  };
  function fitForKeepZoom(f) {
    // US map: keep current zoom, pan so f is centred
    const k = view.k; const saved = view; view = { k: 1, T: [0, 0] }; apply();
    const p = f.isPt ? proj(f.c) : d3.geoPath(proj).centroid(f); view = saved;
    if (!p || !isFinite(p[0])) return view.T;
    return [W / 2 - p[0] * k, H / 2 - p[1] * k];
  }
}

// A small static globe centred on [lon, lat] with a ring around the place (used after Shapes questions).
// rDeg is the place's angular radius; the place itself is filled when the world map knows it.
function locator(canvas, c, rDeg, id) {
  const { features, byId } = data('world');
  const size = canvas.width, dpr = window.devicePixelRatio || 1;
  canvas.style.width = canvas.style.height = size + 'px';
  canvas.width = canvas.height = size * dpr;
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const proj = d3.geoOrthographic().clipAngle(90).rotate([-c[0], -c[1]]).scale(size / 2 - 2).translate([size / 2, size / 2]).precision(0.5);
  const P = d3.geoPath(proj, g);
  g.beginPath(); P({ type: 'Sphere' }); g.fillStyle = css('--map-ocean'); g.fill();
  g.beginPath(); features.forEach(f => { if (!f.isPt && d3.geoDistance(f.c, c) - f.rad < Math.PI / 2) P(f.low); }); g.fillStyle = css('--map-land'); g.fill();
  const i = byId.get(id);
  if (i != null && !features[i].isPt) { g.beginPath(); P(features[i].mid); g.fillStyle = css('--accent'); g.fill(); }
  const [x, y] = proj(c);
  const rpx = Math.max(7, rDeg * Math.PI / 180 * proj.scale() + 4);
  g.beginPath(); g.arc(x, y, rpx, 0, 2 * Math.PI); g.lineWidth = 2; g.strokeStyle = css('--accent'); g.stroke();
  g.beginPath(); P({ type: 'Sphere' }); g.lineWidth = 1; g.strokeStyle = css('--line-2'); g.stroke();
}

window.FMMap = {
  locator,
  ready: !!(G && window.d3 && window.topojson),
  has: id => WORLD_IDS.has(id) || US_IDS.has(id),
  // Which map shows this id. US states and D.C. go on the U.S. map; everything else on the globe.
  mapFor: id => (US_IDS.has(id) && /^us:us-/.test(id)) ? 'us' : WORLD_IDS.has(id) ? 'world' : null,
  create,
};
})();
