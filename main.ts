// NIMBARA — a travel poster for a place that isn't there.
// The floating island that drifted down to kiss the sea: its waterfall
// pours into a turquoise lagoon at golden hour, a white cliff town curves
// around the shore, and the name rides big across a teal dusk sky.
// Dependency-free Node: hand-rolled rasteriser + PNG encoder, no assets.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;
const buf = new Uint8Array(W * H * 3);

// ---------- colour helpers ----------
type RGB = [number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// ---------- pixel primitives ----------
function px(x: number, y: number, c: RGB, a = 1) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
  const i = (yi * W + xi) * 3;
  if (a >= 1) {
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  } else {
    buf[i] = clamp255(lerp(buf[i], c[0], a));
    buf[i + 1] = clamp255(lerp(buf[i + 1], c[1], a));
    buf[i + 2] = clamp255(lerp(buf[i + 2], c[2], a));
  }
}

function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1) {
  const xa = Math.max(0, Math.floor(x0)), xb = Math.min(W - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0)), yb = Math.min(H - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) px(x, y, c, a);
}

// Vertical gradient over a rectangle, stops = [t, colour][] sorted by t.
function vgrad(x0: number, y0: number, x1: number, y1: number, stops: [number, RGB][]) {
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const t = (y - y0) / Math.max(1, y1 - y0);
    let c = stops[stops.length - 1][1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t <= stops[s + 1][0]) {
        const lt = (t - stops[s][0]) / Math.max(1e-6, stops[s + 1][0] - stops[s][0]);
        c = mix(stops[s][1], stops[s + 1][1], Math.max(0, Math.min(1, lt)));
        break;
      }
    }
    fillRect(x0, y, x1, y + 0.6, c);
  }
}

// Scanline polygon fill (even-odd), points as [x,y][].
function fillPoly(pts: [number, number][], c: RGB, a = 1) {
  let minY = H, maxY = -1;
  for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(H - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) px(x, y, c, a);
    }
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const dy = (y - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const dx = rx * Math.sqrt(1 - dy * dy);
    for (let x = Math.ceil(cx - dx); x <= Math.floor(cx + dx); x++) px(x, y, c, a);
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB, a = 1) {
  fillEllipse(cx, cy, r, r, c, a);
}

// Thick line as a quad.
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (w / 2), ny = (dx / len) * (w / 2);
  fillPoly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], c, a);
}

// Arc band (for bowls): points along outer arc then back along inner arc.
function arcBand(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, thick: number): [number, number][] {
  const pts: [number, number][] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  for (let i = steps; i >= 0; i--) {
    const t = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + (rx - thick) * Math.cos(t), cy + (ry - thick) * Math.sin(t)]);
  }
  return pts;
}

// ---------- palette ----------
const TEAL_DEEP: RGB = [13, 53, 66];
const TEAL: RGB = [22, 96, 122];
const TEAL_DARK: RGB = [10, 37, 48];
const ROCK: RGB = [38, 74, 82];
const ROCK_LT: RGB = [58, 90, 94];
const TURQ: RGB = [47, 157, 148];
const TURQ_DEEP: RGB = [14, 74, 94];
const PEACH: RGB = [242, 165, 92];
const GOLD: RGB = [247, 200, 115];
const SUN: RGB = [251, 227, 161];
const CREAM: RGB = [247, 235, 203];
const CORAL: RGB = [224, 120, 86];
const ROOF: RGB = [198, 91, 60];
const HOUSE: RGB = [245, 237, 216];
const GREEN: RGB = [110, 150, 74];
const GREEN_DK: RGB = [58, 94, 52];
const SAND: RGB = [232, 200, 143];

// ---------- sky ----------
vgrad(0, 0, W, 620, [
  [0, TEAL_DEEP], [0.42, [18, 82, 104]], [0.62, [58, 138, 138]],
  [0.78, [238, 164, 102]], [0.92, [247, 200, 115]], [1, [250, 214, 138]],
]);
// soft horizontal sunset bands
fillEllipse(512, 560, 560, 46, [244, 178, 110], 0.35);
fillEllipse(512, 585, 620, 34, [250, 208, 130], 0.3);

// sun + glow (low, right of the island)
fillCircle(772, 496, 100, GOLD, 0.16);
fillCircle(772, 496, 76, GOLD, 0.28);
fillCircle(772, 496, 56, SUN, 1);

// drifting clouds (flat, warm)
function cloud(cx: number, cy: number, s: number, c: RGB, a: number) {
  fillEllipse(cx, cy, 92 * s, 20 * s, c, a);
  fillEllipse(cx - 58 * s, cy + 8 * s, 56 * s, 15 * s, c, a);
  fillEllipse(cx + 60 * s, cy + 9 * s, 60 * s, 15 * s, c, a);
  fillEllipse(cx + 8 * s, cy - 12 * s, 52 * s, 15 * s, c, a);
}
cloud(180, 258, 0.85, [246, 217, 168], 0.7);
cloud(880, 210, 0.65, [246, 217, 168], 0.6);
cloud(920, 330, 0.5, [240, 190, 140], 0.5);
cloud(120, 380, 0.55, [240, 190, 140], 0.45);

// birds
function bird(x: number, y: number, s: number) {
  thickLine(x - 9 * s, y, x, y + 5 * s, 2.4, TEAL_DARK);
  thickLine(x, y + 5 * s, x + 9 * s, y, 2.4, TEAL_DARK);
}
bird(238, 300, 1); bird(300, 268, 0.8); bird(842, 288, 0.9); bird(786, 246, 0.7);

// ---------- floating island ----------
// Rolling green hilltop, rocky underside tapering to an off-centre point.
const ISL = { x0: 268, x1: 688, top: 336, tipY: 540, tipX: 498 };
// hilltop profile (gentle bumps) + front face
fillPoly([
  [ISL.x0, ISL.top + 22], [ISL.x0 + 60, ISL.top + 6], [ISL.x0 + 130, ISL.top - 6],
  [ISL.x0 + 210, ISL.top + 2], [ISL.x0 + 290, ISL.top - 10], [ISL.x0 + 360, ISL.top + 4],
  [ISL.x1, ISL.top + 14], [ISL.x1, ISL.top + 30], [ISL.x0, ISL.top + 30],
], [146, 178, 92]);
fillPoly([[ISL.x0, ISL.top + 30], [ISL.x1, ISL.top + 30], [ISL.x1, ISL.top + 54], [ISL.x0, ISL.top + 54]], GREEN_DK);
// rocky underside: asymmetric, organic cone with facets
fillPoly([
  [ISL.x0, ISL.top + 54], [ISL.x1, ISL.top + 54], [ISL.x1 - 60, ISL.top + 130],
  [ISL.tipX + 52, ISL.tipY - 14], [ISL.tipX, ISL.tipY + 6], [ISL.tipX - 88, ISL.tipY - 46],
  [ISL.x0 + 56, ISL.top + 128],
], ROCK);
fillPoly([
  [ISL.x0 + 60, ISL.top + 54], [ISL.x1 - 110, ISL.top + 54], [ISL.tipX + 22, ISL.tipY - 30],
  [ISL.tipX - 46, ISL.tipY - 66], [ISL.x0 + 150, ISL.top + 96],
], ROCK_LT);
fillPoly([
  [ISL.x0, ISL.top + 54], [ISL.x0 + 120, ISL.top + 54], [ISL.tipX - 60, ISL.tipY - 40],
  [ISL.tipX - 120, ISL.tipY - 110],
], [28, 58, 66]);
// rock facet lines (soft)
thickLine(340, 400, 400, 478, 3, [20, 46, 54], 0.5);
thickLine(620, 400, 570, 470, 3, [20, 46, 54], 0.5);
thickLine(470, 404, 500, 506, 3, [20, 46, 54], 0.4);

// island town: white houses, terracotta roofs, cypresses, a domed temple
function house(x: number, y: number, w: number, h: number, lit: boolean) {
  fillRect(x, y, x + w, y + h, HOUSE);
  fillPoly([[x - 3, y], [x + w / 2, y - 12], [x + w + 3, y]], ROOF);
  fillRect(x + w * 0.18, y + h * 0.45, x + w * 0.38, y + h * 0.72, lit ? GOLD : TEAL_DARK);
  fillRect(x + w * 0.62, y + h * 0.45, x + w * 0.82, y + h * 0.72, lit ? GOLD : TEAL_DARK);
  fillRect(x + w * 0.44, y + h * 0.62, x + w * 0.58, y + h, [90, 60, 40]);
}
function cypress(x: number, y: number, h: number) {
  fillPoly([[x - 6, y], [x, y - h], [x + 6, y]], GREEN_DK);
  fillRect(x - 1.5, y, x + 1.5, y + 5, [70, 48, 32]);
}
house(330, 315, 34, 26, true);
house(378, 310, 28, 22, false);
house(420, 310, 30, 24, true);
cypress(470, 338, 34);
house(560, 300, 36, 26, true);
house(612, 317, 30, 22, false);
cypress(656, 340, 30);
// domed temple at the right end (half-disc dome on the roof)
fillRect(668, 326, 692, 350, CREAM);
fillPoly([[666, 326], [680, 314], [694, 326]], ROOF);
{
  const dome: [number, number][] = [[668, 318]];
  for (let a = Math.PI; a >= 0; a -= 0.15) dome.push([680 + 12 * Math.cos(a), 318 - 12 * Math.sin(a)]);
  dome.push([692, 318]);
  fillPoly(dome, GOLD);
}
fillRect(677, 334, 683, 350, TEAL_DARK);

// (waterfall drawn after the lagoon so it splashes into the water — see below)

// ---------- lagoon ----------
vgrad(0, 560, W, H, [[0, [64, 178, 166]], [0.35, TURQ], [0.75, [20, 96, 116]], [1, TURQ_DEEP]]);
// soft horizon band so sky meets sea without a hard cut
fillRect(0, 556, W, 562, [250, 214, 138], 0.55);
// distant headland on the left horizon
fillPoly([[0, 560], [0, 540], [60, 528], [150, 540], [210, 556], [230, 560]], [24, 68, 80]);
function shimmer() {
  let seed = 1234567;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let y = 570; y < 850; y += 10) {
    const t = (y - 570) / 280;
    const wdt = 16 + t * 70 + rnd() * 24;
    const cx = 772 + (rnd() - 0.5) * (14 + t * 60);
    for (let x = cx - wdt; x < cx + wdt; x += 6) {
      const a = 0.55 * (1 - t) * (0.5 + rnd() * 0.5);
      fillRect(x, y, x + 8 + rnd() * 14, y + 2.2, GOLD, a);
    }
  }
}
shimmer();
// wave arcs
for (const [wx, wy, wr, wa] of [[180, 640, 90, 0.5], [880, 660, 110, 0.45], [240, 760, 120, 0.35], [860, 800, 130, 0.35], [420, 880, 150, 0.28], [760, 920, 120, 0.25]] as const) {
  for (let a = Math.PI * 1.08; a < Math.PI * 1.92; a += 0.06) {
    px(wx + wr * Math.cos(a), wy + 12 * Math.sin(a), [210, 240, 235], wa);
    px(wx + wr * Math.cos(a), wy + 12 * Math.sin(a) + 1, [210, 240, 235], wa * 0.7);
  }
}

// ---------- waterfall (over the lagoon so it splashes into the water) ----------
fillPoly([[592, 392], [620, 392], [610, 500], [600, 612], [578, 612], [584, 500]], [247, 236, 208]);
fillPoly([[606, 392], [620, 392], [612, 500], [604, 606]], [255, 250, 230]);
thickLine(596, 400, 590, 600, 3, [255, 255, 255], 0.8);
fillEllipse(589, 612, 42, 11, [240, 248, 238], 0.85);
fillEllipse(589, 618, 28, 7, [255, 255, 255], 0.9);

// ---------- sailboats ----------
function sailboat(x: number, y: number, s: number) {
  fillPoly([[x, y - 52 * s], [x, y - 4 * s], [x + 30 * s, y - 4 * s]], [250, 246, 232]); // main sail
  fillPoly([[x - 4 * s, y - 44 * s], [x - 4 * s, y - 4 * s], [x - 24 * s, y - 4 * s]], [240, 220, 180]); // jib
  thickLine(x, y - 54 * s, x, y - 2 * s, 2.5, [60, 40, 28]);
  fillPoly([[x - 26 * s, y], [x + 30 * s, y], [x + 22 * s, y + 9 * s], [x - 18 * s, y + 9 * s]], [96, 58, 38]); // hull
  fillEllipse(x + 2 * s, y + 14 * s, 26 * s, 3.5 * s, [255, 255, 255], 0.35); // reflection
}
sailboat(596, 724, 1);
sailboat(268, 800, 0.62);
sailboat(884, 742, 0.5);

// ---------- foreground headlands (frame the bottom corners) ----------
fillPoly([[0, 1024], [0, 902], [70, 874], [150, 894], [182, 952], [142, 1024]], TEAL_DARK);
fillPoly([[0, 1024], [0, 946], [84, 924], [150, 968], [122, 1024]], [16, 52, 62]);
fillPoly([[1024, 1024], [1024, 892], [952, 868], [874, 890], [840, 950], [880, 1024]], TEAL_DARK);
fillPoly([[1024, 1024], [1024, 940], [940, 918], [882, 964], [922, 1024]], [16, 52, 62]);

// ---------- crescent shore town along the bottom ----------
fillPoly([[100, 1024], [150, 964], [320, 938], [512, 930], [704, 938], [874, 964], [924, 1024]], SAND);
fillPoly([[150, 970], [320, 946], [512, 938], [704, 946], [874, 970], [874, 984], [150, 984]], [214, 176, 118]);
function shoreHouse(x: number, y: number, s: number, lit: boolean) {
  const w = 40 * s, h = 30 * s;
  fillRect(x, y, x + w, y + h, HOUSE);
  fillPoly([[x - 3, y], [x + w / 2, y - 13 * s], [x + w + 3, y]], ROOF);
  fillRect(x + w * 0.2, y + h * 0.4, x + w * 0.36, y + h * 0.68, lit ? GOLD : TEAL_DARK);
  fillRect(x + w * 0.62, y + h * 0.4, x + w * 0.78, y + h * 0.68, lit ? GOLD : TEAL_DARK);
  fillRect(x + w * 0.45, y + h * 0.6, x + w * 0.57, y + h, [90, 60, 40]);
}
const shore: [number, number, number, boolean][] = [
  [196, 932, 0.9, true], [252, 924, 1.05, false], [312, 918, 0.85, true],
  [366, 914, 1.1, true], [428, 910, 0.9, false], [486, 908, 1.0, true],
  [542, 908, 0.85, false], [596, 910, 1.05, true], [656, 914, 0.9, true],
  [712, 918, 1.0, false], [770, 924, 0.88, true], [824, 932, 0.95, false],
];
for (const [x, y, s, lit] of shore) shoreHouse(x, y, s, lit);
cypress(238, 930, 26); cypress(700, 916, 24);

// ---------- serif name: NIMBARA ----------
// Glyph space: cap height 100, drawn with slab-serif strokes.
// Local helpers work in glyph coords; caller scales/translates.
let gx = 0, gy = 0, gs = 1, gcol: RGB = CREAM, galpha = 1;
const X = (lx: number) => gx + lx * gs;
const Y = (ly: number) => gy + ly * gs;
function gRect(x0: number, y0: number, x1: number, y1: number) {
  fillRect(X(x0), Y(y0), X(x1), Y(y1), gcol, galpha);
}
function gPoly(pts: [number, number][]) {
  fillPoly(pts.map(([a, b]) => [X(a), Y(b)] as [number, number]), gcol, galpha);
}
function gLine(x0: number, y0: number, x1: number, y1: number, w: number) {
  thickLine(X(x0), Y(y0), X(x1), Y(y1), w * gs, gcol, galpha);
}
function gStem(x: number, w = 15) {
  gRect(x, 0, x + w, 100);
  gRect(x - 4.5, 0, x + w + 4.5, 7);   // top slab serif
  gRect(x - 4.5, 93, x + w + 4.5, 100); // bottom slab serif
}
function gBowl(cx: number, cy: number, rx: number, ry: number) {
  // right-half bowl band, open at the stem (left edge)
  gPoly(arcBand(cx, cy, rx, ry, -Math.PI / 2, Math.PI / 2, 13));
}
const GLYPHS: Record<string, { w: number; draw: () => void }> = {
  N: { w: 78, draw() {
    gLine(16, 4, 70, 96, 13.5);
    gStem(0); gStem(63);
  } },
  I: { w: 34, draw() {
    gRect(9.5, 0, 24.5, 100);
    gRect(0, 0, 34, 7); gRect(0, 93, 34, 100);
  } },
  M: { w: 93, draw() {
    gStem(0); gStem(78);
    gLine(15, 2, 46.5, 58, 13);
    gLine(46.5, 58, 78, 2, 13);
  } },
  B: { w: 74, draw() {
    gStem(0);
    gBowl(16, 26, 40, 26); gBowl(16, 74, 43, 27);
    gRect(15, 20, 34, 32); gRect(15, 68, 36, 80); // join bowls to stem
  } },
  A: { w: 72, draw() {
    gLine(36, 0, 6, 100, 14);
    gLine(36, 0, 66, 100, 14);
    gRect(2, 93, 16, 100); gRect(56, 93, 70, 100); // foot serifs
    gRect(20, 60, 52, 70); // crossbar
  } },
  R: { w: 74, draw() {
    gStem(0);
    gBowl(16, 27, 40, 27);
    gRect(15, 21, 34, 33);
    gLine(34, 48, 70, 100, 13.5);
  } },
};
function drawName(text: string, cx: number, top: number, capH: number, col: RGB, alpha = 1, dy = 0) {
  const scale = capH / 100;
  const tracking = 24 * scale;
  const widths = [...text].map((ch) => GLYPHS[ch].w * scale);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (text.length - 1);
  let x = cx - total / 2;
  gcol = col; galpha = alpha; gs = scale; gy = top + dy;
  for (let i = 0; i < text.length; i++) {
    gx = x;
    GLYPHS[text[i]].draw();
    x += widths[i] + tracking;
  }
}
// soft shadow, then cream letters
drawName("NIMBARA", 512, 66, 118, [8, 30, 40], 0.55, 5);
drawName("NIMBARA", 512, 66, 118, CREAM, 1);

// thin gold rule under the name, echoing the horizon
fillRect(392, 208, 632, 210.5, GOLD, 0.9);
fillRect(492, 206, 532, 212.5, GOLD, 0.9);

// ---------- poster frame ----------
fillRect(24, 24, 1000, 29, CREAM, 0.95);
fillRect(24, 995, 1000, 1000, CREAM, 0.95);
fillRect(24, 24, 29, 1000, CREAM, 0.95);
fillRect(995, 24, 1000, 1000, CREAM, 0.95);

// ---------- vintage grain (sparse, keeps PNG small) ----------
{
  let seed = 987654321;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 26000; i++) {
    const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H);
    const d = (rnd() - 0.5) * 14;
    const j = (y * W + x) * 3;
    buf[j] = clamp255(buf[j] + d); buf[j + 1] = clamp255(buf[j + 1] + d); buf[j + 2] = clamp255(buf[j + 2] + d);
  }
}

// ---------- PNG encode (RGB, filter 0) ----------
function crc32(b: Buffer): number {
  let table = (crc32 as unknown as { t?: Int32Array }).t;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    (crc32 as unknown as { t: Int32Array }).t = table;
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0;
  Buffer.from(buf.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync("/output", { recursive: true });
writeFileSync("/output/entry.png", png);
console.log("wrote /output/entry.png", png.length, "bytes");
