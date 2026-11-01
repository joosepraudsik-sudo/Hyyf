// Hüüf – browser side.
// "Kus täna otsida": value = sum_c fruiting_index(point, class, day) * S_c(cell)
// "Head metsad":     value = sum_c S_c(cell)  (site suitability in the 100 m neighbourhood)
"use strict";

const MAA = "https://tiles.maaamet.ee/tm/tms/1.0.0";

// Display classes per mode: [label, colour, opacity]. A class comes from two steps, forest and
// mushroom time (bounds in meta.astmed, from parameetrid.py), so small daily changes do not repaint
// the map. Soft autumn tones (deep brown / rust / ochre / sand), dark to light. The better the place,
// the darker and more opaque; "võimalik" is only a faint wash so roads, tracks and names stay
// readable everywhere. The layer as a whole fades a bit up close.
// TEMPORARY: colour and strength of the mushroom layer to compare (the user picks one, the switch
// goes away). The smooth style is settled. Pruun + Tugev is the look we started from; the other
// palettes give every class its own hue, best (dark) to lowest (light).
const VALIK = {
  varv: { pruun: "Pruun (algne)", spekter: "Spekter", magma: "Magma", soekulm: "Soe–külm" },
  tugevus: { kerge: "Kerge", keskmine: "Keskmine", tugev: "Tugev" },
};
const PALETID = {
  pruun: ["#4b1810", "#7a2a1c", "#a4432a", "#d9894a", "#e9cf8f"],
  spekter: ["#6a1b9a", "#d62828", "#f77f00", "#fcbf49", "#f3e9b5"],     // violet, red, orange, yellow, cream
  magma: ["#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcf3bf"],       // deep purple, magenta, rose, peach, pale yellow
  soekulm: ["#a50026", "#f46d43", "#fdb863", "#74add1", "#c6dbef"],     // dark red, orange, apricot, blue, pale blue
};
const TUGEVUS = { kerge: 0.45, keskmine: 0.7, tugev: 1 };
const ALFA = [0.9, 0.82, 0.72, 0.5, 0.28];
const KIHI_TUGEVUS = ["interpolate", ["linear"], ["zoom"], 11, 1, 14, 0.85, 16, 0.7];
let VARV;
const KLASSID = {};
function seaVaade(v = {}) {
  for (const [k, valikud] of Object.entries(VALIK)) olek[k] = valikud[v[k]] ? v[k] : Object.keys(valikud).at(k === "tugevus" ? -1 : 0);
  VARV = PALETID[olek.varv];
  KLASSID.tana = ["Tippkoht", "Suurepärane", "Väga hea", "Hea", "Võimalik"].map((n, c) => [n, VARV[c], ALFA[c]]);
  // forest only: one step per class, the top step in the second colour (the darkest needs a good time too)
  KLASSID.koht = ["Suurepärane mets", "Väga hea mets", "Hea mets", "Keskmine mets"].map((n, c) => [n, VARV[c + 1], ALFA[c + 1]]);
}
const ASTE_KOHT = ["suurepärane", "väga hea", "hea", "keskmine"];
const ASTE_AEG = ["väga hea", "hea", "keskmine", "vähe"];
// text colour on a class colour
const tekstVarv = (hex) => ([1, 3, 5].reduce((s, k, i) => s + parseInt(hex.slice(k, k + 2), 16) * [0.3, 0.59, 0.11][i], 0) < 150 ? "#fff" : "#2a1606");
const SILE = 5;        // drawing resolution per 50 m cell (smooth edges)
const SILU_KORDI = 2;  // smoothing passes for the class fields (more = rounder, small spots fade)
const NADALAPAEV = ["P", "E", "T", "K", "N", "R", "L"];
const NADALAPAEV_PIKK = ["pühapäev", "esmaspäev", "teisipäev", "kolmapäev", "neljapäev", "reede", "laupäev"];
const AJATELG_EDASI = 10;   // the strip shows the anchor day (today, or a date picked in the calendar) and 10 days ahead
const KUU = ["jaan", "veebr", "märts", "apr", "mai", "juuni", "juuli", "aug", "sept", "okt", "nov", "dets"];
const PARIMAID = 5;
const PARIM_VAHE_M = 500;    // best spots at least this far apart
const PARIM_YMBER_M = 300;   // good forest counted within this radius of a spot
const MIN_RAKKE = 4;         // 4 x 50 m cells = 1 ha

const PUUD = { MA: "mänd", KU: "kuusk", KS: "kask", HB: "haab", LV: "hall lepp", LM: "sanglepp", TA: "tamm",
  LH: "lehis", SA: "saar", VA: "vaher", PN: "pärn", RE: "remmelgas", JA: "jalakas", NU: "nulg", TS: "ebatsuuga",
  SD: "seedermänd", PP: "pappel", TM: "toomingas", PI: "pihlakas" };
const TEGUR_NIMI = { puuliik: "Puuliigid", vanus: "Puistu vanus", valgus: "Valgus (võrastik olemas)",
  kasvukoht: "Metsatüüp", muld: "Muld", mikroniiskus: "Maastiku niiskus", okotoon: "Soo serv (ökotoon)",
  sidusus: "Metsamassiiv", tihedus: "Võra tihedus" };

const olek = { reziim: "tana", paev: 0, p0: 0, markerid: [], kihtNahtav: true, kaardiVaade: "ylevaade" };
try { olek.kaardiVaade = { graafikud: "seened" }[localStorage.getItem("hyyf-kaardivaade")] || localStorage.getItem("hyyf-kaardivaade") || "ylevaade"; } catch (e) { /* private mode */ }
{ let v0; try { v0 = JSON.parse(localStorage.getItem("hyyf-vaade")); } catch (e) { /* private mode */ } seaVaade(v0 || {}); }
const canvas = document.createElement("canvas");

// ---------- data ----------

const NONE = 65535;          // no weather point: cell not shown
const Z_LEHT = 11;           // from this zoom on the 50 m sheets are drawn (all of Estonia), below it the overview
const LEHTI_MALUS = 60;
const YLE_TUGEVUS = 1.5;     // the overview's colours are this much more opaque (seen from afar)      // sheets kept in memory
const EESTI = "andmed/eesti/";     // data of all of Estonia (eksport_eesti.py)

// A grid of cells: one small area, one 10 km sheet with `varu` cells of its neighbours around it
// (only for the smoothed drawing), or the overview of Estonia. The inner part (Wi x Hi) is placed on
// the map by its corners (NW, NE, SE, SW), the overview exactly in Web Mercator (`merc`).
function vork(o) {
  const G = Object.assign({ varu: 0, kiht: null, info: null }, o);
  G.Wi = G.laius - 2 * G.varu;
  G.Hi = G.korgus - 2 * G.varu;
  G.n = G.laius * G.korgus;
  if (G.merc) {
    const { x0, y1, ruut_m: c } = G.merc;
    G.uv = (lng, lat) => { const [x, y] = merc(lng, lat); return [(x - x0) / (c * G.Wi), (y1 - y) / (c * G.Hi)]; };
    G.lngLat = (x, y) => unmerc(x0 + x * c, y1 - y * c);
  } else {
    const [nw, ne, , sw] = G.nurgad;
    const ax = ne[0] - nw[0], ay = ne[1] - nw[1], bx = sw[0] - nw[0], by = sw[1] - nw[1], det = ax * by - ay * bx;
    G.uv = (lng, lat) => { const dx = lng - nw[0], dy = lat - nw[1]; return [(dx * by - dy * bx) / det, (ax * dy - ay * dx) / det]; };
    G.lngLat = (x, y) => { const u = x / G.Wi, v = y / G.Hi; return [nw[0] + u * ax + v * bx, nw[1] + u * ay + v * by]; };
  }
  const xs = G.nurgad.map((c) => c[0]), ys = G.nurgad.map((c) => c[1]);
  G.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  return G;
}
const R_MAA = 6378137;
const merc = (lng, lat) => [R_MAA * lng * Math.PI / 180, R_MAA * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
const unmerc = (x, y) => [x / R_MAA * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R_MAA)) - Math.PI / 2) * 180 / Math.PI];
// distance in metres between two [lng, lat] (short distances)
const kaugus = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110540);

// cell of grid G at a map position: index into its layers, -1 outside the inner part
function rakkG(G, lng, lat) {
  const [u, v] = G.uv(lng, lat);
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return -1;
  return (Math.floor(v * G.Hi) + G.varu) * G.laius + Math.floor(u * G.Wi) + G.varu;
}
// inner cell coordinates (x east, y south) of index i
const xy = (G, i) => [i % G.laius - G.varu, Math.floor(i / G.laius) - G.varu];
// area of one cell in ha: the overview counts only its good 50 m cells
const haRakk = (G, i) => (G.yle ? G.kiht.rakke[i] * 0.25 : G.ruut_m ** 2 / 1e4);

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function jaga(baidid, nimed, n) {
  const kiht = {};
  nimed.forEach((k, i) => (kiht[k] = baidid.subarray(i * n, (i + 1) * n)));
  return kiht;
}

function seaIlm(v, aeg) {
  // "today" is the viewer's date when the data covers it, not the day the data was exported
  const kohalik = new Date().toLocaleDateString("sv-SE");
  if (v.kuupaevad.includes(kohalik)) v.tana = kohalik;
  Object.assign(olek, { vilj: v, aeg });
}

// gzip files of andmed/eesti, unpacked here (any static host serves them as they are)
async function laeGz(url, json = false) {
  let b;
  if (location.protocol === "file:") b = await laeSkript(url);
  else {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    b = new Uint8Array(await r.arrayBuffer());
  }
  if (b[0] === 0x1f && b[1] === 0x8b) {
    b = new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  }
  return json ? JSON.parse(new TextDecoder().decode(b)) : b;
}

// index.html opened straight from disk: file:// blocks fetch but not script tags, so every .gz file
// has a .js copy that hands its bytes to HYYF_FAIL (eksport_eesti.py)
const skriptid = {};
window.HYYF_FAIL = (tee, andmed) => skriptid[tee]?.(b64(andmed));
function laeSkript(url) {
  return new Promise((ok, viga) => {
    const tee = url.slice(EESTI.length), el = document.createElement("script");
    skriptid[tee] = (b) => { delete skriptid[tee]; el.remove(); ok(b); };
    el.onerror = () => { delete skriptid[tee]; el.remove(); viga(new Error(`${url}: puudub (käivita eksport_eesti.py --js)`)); };
    el.src = url.replace(/\.gz$/, ".js");
    document.head.append(el);
  });
}

// all of Estonia: index, weather and the overview now, the 50 m sheets when the view needs them
async function laeEesti() {
  const [ix, v, aeg, yle] = await Promise.all([laeGz(EESTI + "indeks.json.gz", true), laeGz(EESTI + "ilm.json.gz", true),
                                               laeGz(EESTI + "ilm.bin.gz"), laeGz(EESTI + "ylevaade.bin.gz")]);
  window.HYYF = { juhend: ix.juhend };
  seaIlm(v, aeg);
  const Y = ix.ylevaade, n = Y.laius * Y.korgus, u8 = Y.kihid.length - 1;
  const kiht = jaga(yle, Y.kihid.slice(0, u8), n);
  kiht.ilmapunkt = new Uint16Array(yle.slice(u8 * n, (u8 + 2) * n).buffer);
  olek.yle = vork({ id: "yle", yle: true, laius: Y.laius, korgus: Y.korgus, nurgad: Y.nurgad,
                    merc: { x0: Y.x0, y1: Y.y1, ruut_m: Y.ruut_m }, kiht });
  const m = ix.meta, L = m.laius + 2 * m.varu;
  olek.lehed = ix.lehed.map((e) => vork({ ...e, laius: L, korgus: L, varu: m.varu, ruut_m: m.ruut_m }));
  Object.assign(olek, { meta: { ...m, nimi: ix.nimi, nurgad: Y.nurgad }, klassid: Object.keys(m.klassid).map(Number),
                        solmed: new Map(v.ilmapunktid.map((id, k) => [id, k])) });
}

function laeLeht(G) {
  G.kasutatud = performance.now();
  if (G.kiht) return Promise.resolve(G);
  G.laeb ||= laeGz(`${EESTI}kaart/${G.id}.bin.gz`).then((b) => {
    const kiht = jaga(b, olek.meta.kihid, G.n);
    kiht.ilmapunkt = Uint16Array.from(kiht.ilmapunkt, (p) => (p === 255 ? NONE : G.punktid[p]));
    G.kiht = kiht;
    G.laeb = null;
    unusta();
    return G;
  }, (e) => { G.laeb = null; throw e; });
  return G.laeb;
}

function laeInfo(G) {
  if (G.info) return Promise.resolve(G.info);
  return laeGz(`${EESTI}info/${G.id}.json.gz`, true).then((S) => (G.info = {
    kiht: jaga(b64(S.rakud), S.kihid, G.Wi * G.Hi), eraldised: S.eraldised, mullad: S.mullad }));
}

// drop the sheets used longest ago (not on the map now) when too many are in memory
function unusta() {
  const laetud = olek.lehed.filter((G) => G.kiht);
  if (laetud.length <= LEHTI_MALUS) return;
  const nahtav = new Set(vaateLehed(0.5));
  laetud.filter((G) => !nahtav.has(G)).sort((a, b) => a.kasutatud - b.kasutatud)
    .slice(0, laetud.length - LEHTI_MALUS).forEach((G) => {
      eemaldaPilt(G);
      Object.assign(G, { kiht: null, info: null, kl: null, v: null, voti: null });
    });
}

// sheets overlapping the view, widened by `lisa` x its size on each side
function vaateLehed(lisa = 0) {
  const b = map.getBounds(), dx = (b.getEast() - b.getWest()) * lisa, dy = (b.getNorth() - b.getSouth()) * lisa;
  const [w, s, e, n] = [b.getWest() - dx, b.getSouth() - dy, b.getEast() + dx, b.getNorth() + dy];
  return olek.lehed.filter((G) => G.bbox[2] > w && G.bbox[0] < e && G.bbox[3] > s && G.bbox[1] < n);
}

// grids whose cells are on the map now: counted in the summary and searched for best spots
function nahtavadVorgud() {
  if (map.getZoom() < Z_LEHT) return [olek.yle];
  return vaateLehed().filter((G) => G.kiht && G.kl);
}

// cell of a loaded grid at a map position (no loading), for the cursor
function rakkNahtav(lng, lat) {
  for (const G of map.getZoom() < Z_LEHT ? [olek.yle] : olek.lehed.filter((L) => L.kiht)) {
    const i = rakkG(G, lng, lat);
    if (i >= 0) return G.kiht.ilmapunkt[i] === NONE ? null : { G, i };
  }
  return null;
}

// 50 m cell at a map position with its explanation data, loading the sheet if needed
async function leiaRakk(lng, lat) {
  const G = olek.lehed.find((L) => rakkG(L, lng, lat) >= 0);
  if (!G) return null;
  await Promise.all([laeLeht(G), laeInfo(G)]);
  const i = rakkG(G, lng, lat);
  return i < 0 || G.kiht.ilmapunkt[i] === NONE ? null : { G, i };
}

// time component f (index into valjad) for day d, point p, class position j, 0..1
function T(d, p, j, f) {
  const { vilj, aeg } = olek;
  const P = vilj.ilmapunktid.length, K = vilj.klassid.length, F = vilj.valjad.length;
  return aeg[((d * P + p) * K + j) * F + f] / 255;
}
const F = (nimi) => olek.vilj.valjad.indexOf(nimi);

function kohaSobivus(G, i) {
  return olek.klassid.reduce((s, c) => s + G.kiht["S" + c][i], 0) / 255;
}

// [Koht, Aeg] of a cell: Koht = neighbourhood suitability, Aeg = suitability-weighted fruiting index
function hinnangG(G, i, d = olek.paev) {
  const p = G.kiht.ilmapunkt[i];
  if (p === NONE) return null;
  const koht = kohaSobivus(G, i);
  if (koht <= 0) return [0, 0];
  const fi = F("indeks"), ilm = ilmaKaalud(G, i) || [[p, 1]];
  const kaal = olek.klassid.reduce((s, c, j) => s + ilm.reduce((t, [q, w]) => t + w * T(d, q, j, fi), 0) * G.kiht["S" + c][i] / 255, 0);
  return [koht, kaal / koht];
}

// all of Estonia: the fruiting index of a cell is blended bilinearly from the four ERA5-Land nodes
// (0.1 deg grid, node id = round(lat*10)*1000 + round(lon*10)) around it, so the coarse weather grid
// does not cut straight edges into the map. Nodes without forest are left out. [[node, weight], ...]
function ilmaKaalud(G, i) {
  if (!olek.solmed) return null;
  const [x, y] = xy(G, i), [lng, lat] = G.lngLat(x + 0.5, y + 0.5);
  const a = lat * 10, b = lng * 10, i0 = Math.floor(a), j0 = Math.floor(b), fa = a - i0, fb = b - j0;
  const out = [];
  let s = 0;
  for (const [di, dj, w] of [[0, 0, (1 - fa) * (1 - fb)], [0, 1, (1 - fa) * fb], [1, 0, fa * (1 - fb)], [1, 1, fa * fb]]) {
    const q = olek.solmed.get((i0 + di) * 1000 + j0 + dj);
    if (q !== undefined && w > 0) { out.push([q, w]); s += w; }
  }
  return s ? out.map(([q, w]) => [q, w / s]) : null;
}
// the same for a cell {G, i}
const hinnang = (r, d) => hinnangG(r.G, r.i, d);

const aste = (x, piirid) => piirid.findIndex((piir) => x >= piir);

// class index 0 green, 1 orange, 2 yellow, -1 none
function klassKA(koht, aeg) {
  const A = olek.meta.astmed;
  const k = aste(koht, A.koht);
  if (olek.reziim === "koht") return k;
  const a = aste(aeg, A.aeg);
  return k < 0 || a < 0 || k + a >= KLASSID.tana.length ? -1 : k + a;
}

// ---------- map drawing ----------

// drawing resolution per cell: finer up close
const sileSuum = () => (map.getZoom() >= 14 ? SILE : map.getZoom() >= 13 ? 4 : map.getZoom() >= 12 ? 3 : 2);

// a new day or mode: everything is drawn again
function joonista() {
  olek.versioon = (olek.versioon || 0) + 1;
  uuendaKaart();
}

// draw what the view needs and is not yet drawn for this day and mode, then the panel and best spots
async function uuendaKaart() {
  const voti = `${olek.reziim}|${olek.paev}|${olek.versioon}`;
  // the overview only while it is on the map (zooming out draws it then)
  if (map.getZoom() < Z_LEHT) joonistaVork(olek.yle, 2, voti);
  else {
    const lehed = vaateLehed();
    if (lehed.some((G) => !G.kiht)) document.getElementById("kokkuvote").textContent = "Laen selle vaate metsi…";
    await Promise.allSettled(lehed.map(laeLeht));
    if (voti !== `${olek.reziim}|${olek.paev}|${olek.versioon}`) return;   // a newer call took over
    const sile = sileSuum();
    for (const G of vaateLehed()) if (G.kiht) joonistaVork(G, sile, voti);
  }
  // sheets far from the view leave the map (their data stays in memory for a while)
  const lahedal = new Set(vaateLehed(1));
  olek.lehed.forEach((G) => { if (G.pilt && !lahedal.has(G)) eemaldaPilt(G); });
  const kohad = parimadKohad(nahtavadVorgud());
  uuendaPaneel(kohad);
  uuendaMarkerid(kohad);
}

// classes of grid G for this day and mode, then its picture unless already drawn this fine
function joonistaVork(G, sile, voti) {
  if (G.voti !== voti) {
    G.kl = new Int8Array(G.n).fill(-1);
    G.v = new Float32Array(G.n);
    for (let i = 0; i < G.n; i++) {
      const h = hinnangG(G, i);
      if (h === null) continue;
      G.v[i] = olek.reziim === "koht" ? h[0] : h[0] * h[1];
      G.kl[i] = klassKA(h[0], h[1]);
    }
    Object.assign(G, { voti, sile: 0, koond: 0 });
  }
  if (G.yle) {
    // the overview zoomed far out: each picture cell is the best class of k x k cells, so small
    // good forests stay visible when the map shrinks the picture (it has no mipmaps)
    const z = map.getZoom(), k = z < 7.5 ? 4 : z < 8.5 ? 2 : 1;
    if (G.koond === k && G.pilt) return;
    G.koond = k;
    const K = koonda(G, k);
    G.pildiNurgad = [[0, 0], [K.laius * k, 0], [K.laius * k, K.korgus * k], [0, K.korgus * k]].map(([x, y]) => G.lngLat(x, y));
    naitaPilt(G, pilt(K, k === 1 ? 2 : 1));
    return;
  }
  if (G.sile >= sile && G.pilt) return;
  G.sile = sile;
  naitaPilt(G, pilt(G, sile));
}

// grid of the best (lowest, -1 = none) class of each k x k block of G's cells; the lowest class
// is left out, as blocks with some of it would wash over almost the whole country
function koonda(G, k) {
  if (k === 1) return G;
  const W = Math.ceil(G.laius / k), H = Math.ceil(G.korgus / k), kl = new Int8Array(W * H).fill(-1);
  const madalaim = KLASSID[olek.reziim].length - 1;
  for (let y = 0; y < G.korgus; y++) for (let x = 0; x < G.laius; x++) {
    const c = G.kl[y * G.laius + x], j = Math.floor(y / k) * W + Math.floor(x / k);
    if (c >= 0 && c < madalaim && (kl[j] < 0 || c < kl[j])) kl[j] = c;
  }
  return { laius: W, korgus: H, Wi: W, Hi: H, varu: 0, kl, yle: true };
}

// picture of grid G: like contour lines, for each class a field "this class or better" (0/1 per
// cell) is smoothed on the cell grid (margin cells included, so neighbouring sheets meet without
// a seam), sampled with a cubic B-spline on a sile x finer grid (smooth curves, no corners) and cut
// at 0.5 with a soft one-pixel edge. Nested, rounded shapes, darkest inside, class edges blended.
function pilt(G, sile) {
  const W = G.laius, H = G.korgus, kl = G.kl;
  const varvid = KLASSID[olek.reziim].map(([, c]) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16)));
  canvas.width = G.Wi * sile;
  canvas.height = G.Hi * sile;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(canvas.width, canvas.height);
  const kl0 = KLASSID[olek.reziim], nk = kl0.length;
  const valjad = kl0.map((_, k) => silu(Float32Array.from(kl, (c) => (c >= 0 && c <= k ? 1 : 0)), W, H));
  // B-spline taps and weights per fine column / row (4 cells each)
  const kaalud = (n, N) => {
    const idx = new Int32Array(n * 4), w = new Float32Array(n * 4);
    for (let q = 0; q < n; q++) {
      const x = (q + 0.5) / sile - 0.5 + G.varu, x0 = Math.floor(x), t = x - x0, t2 = t * t, t3 = t2 * t;
      const ww = [(1 - t) ** 3 / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6];
      for (let m = 0; m < 4; m++) { idx[q * 4 + m] = Math.max(0, Math.min(N - 1, x0 - 1 + m)); w[q * 4 + m] = ww[m]; }
    }
    return [idx, w];
  };
  const [cx, cwt] = kaalud(canvas.width, W), [ry, rwt] = kaalud(canvas.height, H);
  const proov = (f, px, py) => {
    let s = 0;
    for (let m = 0; m < 4; m++) {
      const rida = ry[py * 4 + m] * W;
      s += rwt[py * 4 + m] * (cwt[px * 4] * f[rida + cx[px * 4]] + cwt[px * 4 + 1] * f[rida + cx[px * 4 + 1]] +
                              cwt[px * 4 + 2] * f[rida + cx[px * 4 + 2]] + cwt[px * 4 + 3] * f[rida + cx[px * 4 + 3]]);
    }
    return s;
  };
  const tugevus = G.yle ? YLE_TUGEVUS : 1;
  const SERV = 0.07;   // edge softness in field units (about one fine pixel)
  const mitu = TUGEVUS[olek.tugevus];
  const kate = (f) => Math.max(0, Math.min(1, (f - 0.5) / SERV + 0.5));
  // rows of cells with nothing drawn are skipped quickly
  const tyhi = new Uint8Array(H);
  for (let y = 0; y < H; y++) tyhi[y] = valjad[nk - 1].subarray(y * W, (y + 1) * W).every((x) => x < 1e-4) ? 1 : 0;
  for (let py = 0; py < canvas.height; py++) {
    if (tyhi[ry[py * 4]] && tyhi[ry[py * 4 + 1]] && tyhi[ry[py * 4 + 2]] && tyhi[ry[py * 4 + 3]]) continue;
    for (let px = 0; px < canvas.width; px++) {
      const fo = proov(valjad[nk - 1], px, py), valine = kate(fo);
      if (valine <= 0) continue;
      // from the outermost class inwards: each darker class covers the previous by its own share
      let [r, g, bl] = varvid[nk - 1], al = kl0[nk - 1][2], eel = valine;
      for (let k = nk - 2; k >= 0; k--) {
        const a = Math.min(eel, kate(proov(valjad[k], px, py)));
        if (a <= 0) break;
        const t = a / eel;
        r += (varvid[k][0] - r) * t; g += (varvid[k][1] - g) * t; bl += (varvid[k][2] - bl) * t; al += (kl0[k][2] - al) * t;
        eel = a;
      }
      let A = Math.min(1, al * tugevus * mitu) * valine;
      const o = (py * canvas.width + px) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = bl; img.data[o + 3] = Math.round(A * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

// separable binomial smoothing of a cell field, SILU_KORDI passes of [1 2 1] / 4
function silu(f, W, H) {
  let a = f, b = new Float32Array(f.length);
  for (let k = 0; k < SILU_KORDI; k++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      b[i] = (a[y * W + Math.max(0, x - 1)] + 2 * a[i] + a[y * W + Math.min(W - 1, x + 1)]) / 4;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      a[i] = (b[Math.max(0, y - 1) * W + x] + 2 * b[i] + b[Math.min(H - 1, y + 1) * W + x]) / 4;
    }
  }
  return a;
}

// one image source per grid. With all of Estonia the overview shows only zoomed out, the sheets up close.
function naitaPilt(G, url) {
  const id = "hinnang-" + G.id;
  if (!map.getSource(id)) {
    G.pilt = { laeb: true, ootel: null };
    map.addSource(id, { type: "image", url, coordinates: G.pildiNurgad || G.nurgad });
    map.addLayer({ id, type: "raster", source: id, ...(G.yle ? { maxzoom: Z_LEHT } : { minzoom: Z_LEHT }),
                   layout: { visibility: olek.kihtNahtav ? "visible" : "none" },
                   paint: { "raster-opacity": KIHI_TUGEVUS, "raster-resampling": "linear", "raster-fade-duration": 0 } },
                 olek.siltideAlt);
    ootaPilt(G);
    return;
  }
  uuendaPilt(G, url);
}

function eemaldaPilt(G) {
  const id = "hinnang-" + G.id;
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
  clearTimeout(G.pilt?.taimer);
  Object.assign(G, { pilt: null, sile: 0 });
}

// one image load at a time per source: a new updateImage while the previous one is still decoding
// aborts it (AbortError in the console), so keep only the latest pending frame and send it when done
function uuendaPilt(G, url) {
  const P = G.pilt;
  if (P.laeb) { P.ootel = url; return; }
  P.laeb = true;
  map.getSource("hinnang-" + G.id).updateImage({ url, coordinates: G.pildiNurgad || G.nurgad });
  ootaPilt(G);
}
function ootaPilt(G) {
  const P = G.pilt, id = "hinnang-" + G.id;
  const valmis = () => {
    clearTimeout(P.taimer);
    map.off("sourcedata", kuula);
    P.laeb = false;
    if (P.ootel && G.pilt === P) { const u = P.ootel; P.ootel = null; uuendaPilt(G, u); }
  };
  const kuula = (e) => { if (e.sourceId === id && map.isSourceLoaded(id)) valmis(); };
  map.on("sourcedata", kuula);
  P.taimer = setTimeout(valmis, 1500);   // safety net if the event never comes
}

// shown cells of grid G inside the current map view (a sheet is a slightly rotated rectangle: take
// the cell range spanned by the view's corners, clipped to the grid)
function vaatesRakud(G) {
  const b = map.getBounds();
  const nurgad = [b.getNorthWest(), b.getNorthEast(), b.getSouthEast(), b.getSouthWest()].map((c) => G.uv(c.lng, c.lat));
  const x0 = Math.max(0, Math.floor(Math.min(...nurgad.map((c) => c[0])) * G.Wi)), x1 = Math.min(G.Wi - 1, Math.ceil(Math.max(...nurgad.map((c) => c[0])) * G.Wi));
  const y0 = Math.max(0, Math.floor(Math.min(...nurgad.map((c) => c[1])) * G.Hi)), y1 = Math.min(G.Hi - 1, Math.ceil(Math.max(...nurgad.map((c) => c[1])) * G.Hi));
  const rakud = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y + G.varu) * G.laius + x + G.varu;
    if (G.kiht.ilmapunkt[i] !== NONE && (G.merc || b.contains(G.lngLat(x + 0.5, y + 0.5)))) rakud.push(i);
  }
  return rakud;
}

// best spots in the view: the highest cells of class "hea" or better, at least 500 m apart, more
// when zoomed out (an eighth of the view); from the overview at most two per weather point, so they
// spread over the country. Each with the good forest around it (a point to walk to, not one blob).
function parimadKohad(vorgud) {
  const b = map.getBounds();
  const hea = KLASSID[olek.reziim].length - 2;   // every class but the lowest
  const kaugelt = vorgud.some((G) => G.yle);
  const vahe = Math.max(PARIM_VAHE_M, kaugus(b.getNorthWest().toArray(), b.getNorthEast().toArray()) / 8);
  const kandidaadid = [];
  for (const G of vorgud) for (const i of vaatesRakud(G)) if (G.kl[i] >= 0 && G.kl[i] <= hea) kandidaadid.push({ G, i });
  kandidaadid.sort((a, c) => c.G.v[c.i] - a.G.v[a.i]);
  const valitud = [], punktis = {};
  for (const r of kandidaadid) {
    const [x, y] = xy(r.G, r.i), lnglat = r.G.lngLat(x + 0.5, y + 0.5);
    if (valitud.some((k) => kaugus(k.lnglat, lnglat) < vahe)) continue;
    const p = r.G.kiht.ilmapunkt[r.i];
    if (kaugelt && (punktis[p] || 0) >= 2) continue;
    const ha = heaUmber(r.G, x, y, hea);
    if (ha < MIN_RAKKE * 0.25) continue;
    punktis[p] = (punktis[p] || 0) + 1;
    valitud.push({ parim: r.G.v[r.i], h: hinnang(r), kl: r.G.kl[r.i], ha, lnglat });
    if (valitud.length === PARIMAID) break;
  }
  return valitud;
}

// good forest (ha) around an inner cell: within PARIM_YMBER_M on the 50 m grid, the 3 x 3
// neighbouring cells (about 800 m square) in the overview
function heaUmber(G, x, y, hea) {
  const r = G.yle ? 1 : Math.round(PARIM_YMBER_M / G.ruut_m);
  let ha = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const xx = x + dx + G.varu, yy = y + dy + G.varu, j = yy * G.laius + xx;
    if ((G.yle || dx * dx + dy * dy <= r * r) && xx >= 0 && xx < G.laius && yy >= 0 && yy < G.korgus && G.kl[j] >= 0 && G.kl[j] <= hea) ha += haRakk(G, j);
  }
  return ha;
}

function uuendaMarkerid(kohad) {
  olek.markerid.forEach((m) => m.remove());
  olek.markerid = kohad.map((k, i) => {
    const el = document.createElement("button");
    el.className = "marker";
    el.textContent = i + 1;
    el.title = `${i + 1}. ${KLASSID[olek.reziim][k.kl][0].toLowerCase()}`;
    el.onclick = (e) => { e.stopPropagation(); naitaSelgitust(k.lnglat); };
    el.hidden = !olek.kihtNahtav;
    return new maplibregl.Marker({ element: el }).setLngLat(k.lnglat).addTo(map);
  });
}

function lulitaKiht(nahtav) {
  olek.kihtNahtav = nahtav;
  for (const l of map.getStyle().layers) {
    if (l.id.startsWith("hinnang-")) map.setLayoutProperty(l.id, "visibility", nahtav ? "visible" : "none");
  }
  olek.markerid.forEach((m) => (m.getElement().hidden = !nahtav));
  naitaReziim();
}

// one switch for the layer: "Kus otsida" / "Head metsad" / hidden. The panel follows: the day
// strip and calendar only where the day matters, nothing but the switch when the layer is hidden
function naitaReziim() {
  const valik = olek.kihtNahtav ? olek.reziim : "peidus";
  document.querySelectorAll("#reziim button").forEach((x) => {
    x.classList.toggle("aktiivne", x.dataset.reziim === valik);
    x.setAttribute("aria-pressed", String(x.dataset.reziim === valik));
  });
  document.getElementById("ajatelg").dataset.reziim = valik;
  document.getElementById("parimad-kaart").style.display = olek.kihtNahtav ? "" : "none";
}

// ---------- panel ----------

function uuendaPaneel(kohad) {
  const { vilj, paev, p0 } = olek;
  naitaReziim();
  document.getElementById("kuupaev").value = vilj.kuupaevad[paev];

  // timeline: the anchor day and the forecast ahead; the past is reached through the calendar only
  const nupud = document.getElementById("paevad");
  nupud.innerHTML = "";
  const aasta = vilj.kuupaevad[p0].slice(0, 4);
  let eelmineKuu = null;
  for (let i = p0; i <= p0 + AJATELG_EDASI; i++) {
    const d = vilj.kuupaevad[i];
    if (!d || d.slice(0, 4) !== aasta) continue;
    const b = document.createElement("button");
    const prog = vilj.paeva_allikas[i] === "prognoos";
    b.className = "paev" + (prog ? " prognoos" : "") + (d === vilj.tana ? " tana" : "") + (i === paev ? " aktiivne" : "");
    const kuu = +d.slice(5, 7) - 1;
    // month under the first day and wherever the month changes
    const kuuSilt = kuu !== eelmineKuu ? KUU[kuu] : "";
    eelmineKuu = kuu;
    b.innerHTML = `<span class="nadal">${d === vilj.tana ? "täna" : NADALAPAEV[new Date(d + "T12:00").getDay()]}</span><span class="kp">${+d.slice(8)}</span><span class="kuu">${kuuSilt || "&nbsp;"}</span>`;
    b.title = `${NADALAPAEV_PIKK[new Date(d + "T12:00").getDay()]} ${+d.slice(8)}.${d.slice(5, 7)}${prog ? " · prognoos" : ""}`;
    b.onclick = () => { olek.paev = i; joonista(); };
    nupud.append(b);
  }
  const valitud = nupud.querySelector(".aktiivne");
  if (valitud && nupud.scrollWidth > nupud.clientWidth) nupud.scrollLeft = valitud.offsetLeft - nupud.clientWidth / 2 + valitud.clientWidth / 2;

  uuendaKokkuvote();

  const ol = document.getElementById("parimad");
  ol.innerHTML = kohad.length ? "" : `<li class="tuhi">Häid kohti selle päeva kohta ei ole.</li>`;
  kohad.forEach((k, i) => {
    const li = document.createElement("li");
    const A = olek.meta.astmed, ms = ASTE_KOHT[aste(k.h[0], A.koht)] || "nõrk", as = ASTE_AEG[aste(k.h[1], A.aeg)] || "seeni pole";
    li.innerHTML = `<button><span class="nr" style="background:${KLASSID[olek.reziim][k.kl][1]};color:${tekstVarv(KLASSID[olek.reziim][k.kl][1])}">${i + 1}</span><span>${KLASSID[olek.reziim][k.kl][0]}<small>mets ${ms}${olek.reziim === "tana" ? ` · seeneaeg ${as}` : ""} · head metsa ümber ${Math.round(k.ha)} ha</small></span><span class="arv">›</span></button>`;
    li.querySelector("button").onclick = () => {
      // keep the spot visible beside the drawer (right) or above the bottom sheet (phones)
      const nihe = innerWidth <= 760 ? [0, -innerHeight * 0.3] : [-200, 0];
      map.flyTo({ center: k.lnglat, zoom: Math.max(map.getZoom(), 14), offset: nihe });
      naitaSelgitust(k.lnglat);
    };
    ol.append(li);
  });
}

// day summary and legend areas for what is on screen: classes counted in the view, the reason
// from the view's most common weather point and forest water class
function uuendaKokkuvote() {
  if (!olek.vilj) return;
  const { meta, paev } = olek, tana = olek.reziim === "tana";
  const ha = KLASSID[olek.reziim].map(() => 0);
  const punktid = {}, klassiS = olek.klassid.map(() => 0);
  for (const G of nahtavadVorgud()) for (const i of vaatesRakud(G)) {
    if (G.kl[i] >= 0) ha[G.kl[i]] += haRakk(G, i);
    const p = G.kiht.ilmapunkt[i];
    punktid[p] = (punktid[p] || 0) + 1;
    olek.klassid.forEach((c, j) => (klassiS[j] += G.kiht["S" + c][i]));
  }
  const legend = document.getElementById("legend");
  legend.innerHTML = KLASSID[olek.reziim].map(([nimi, c, alfa], j) =>
    `<li><span class="lapp" style="background:${c};opacity:${Math.min(1, alfa + 0.25)}"></span><span>${nimi}</span><span class="arv">${Math.round(ha[j])} ha</span></li>`).join("");

  const kv = document.getElementById("kokkuvote");
  const p = Object.keys(punktid).length ? +Object.entries(punktid).reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null;
  const j = klassiS.indexOf(Math.max(...klassiS));
  const pohjus = () => aegPohjus(paev, p, j);
  const head = ha.slice(0, -1).reduce((s, x) => s + x, 0), voimalik = ha.at(-1);
  if (p === null) kv.innerHTML = vaateLehed().some((G) => !G.kiht) && map.getZoom() >= Z_LEHT
    ? "Laen selle vaate metsi…" : "Siin pole hinnatud metsa.";
  else if (!tana) {
    const mets = ha.reduce((s, x) => s + x, 0);
    kv.innerHTML = head < 5
      ? `<b>Siin häid metsi pole.</b> Kukeseenele sobivat metsa ${Math.round(mets)} ha, aga ükski pole hea.`
      : `<b>Häid ja paremaid metsi ${Math.round(head)} ha</b>${ha[0] >= 1 ? `, neist suurepäraseid ${Math.round(ha[0])} ha` : ""}. Värv näitab ainult metsa, ilmast sõltumata – seeneaega vaata „Kus otsida“ alt.`;
  }
  else if (head < 5 && voimalik >= 50) kv.innerHTML = `<b>Tagasihoidlik aeg.</b> Kõrge hindega kohti pole, võimalikke ${Math.round(voimalik)} ha. ${pohjus()}`;
  else if (head < 5) kv.innerHTML = `<b>Kehv aeg.</b> ${pohjus()}`;
  else if (head < 100) kv.innerHTML = `<b>Leidub üksikuid häid kohti</b> – kokku ${Math.round(head)} ha. ${pohjus()}`;
  else kv.innerHTML = `<b>Hea aeg – tasub minna.</b> Häid ja paremaid kohti kokku ${Math.round(head)} ha${ha[0] >= 1 ? `, neist tippkohti ${Math.round(ha[0])} ha` : ""}.`;
}

// why is the day poor: the weakest weather effect of the last weeks (not today's weather) at
// weather point p for forest water class position j
const AEG_POHJUS = {
  hooaeg: (q) => q < 0.05 ? "Hooaeg pole veel alanud – suvi pole piisavalt soe olnud." : "Seeneniidistik pole veel täies jõus.",
  niiskus: () => "Viimastel nädalatel pole niiskus uutele seentele sobinud.",
  soojus: () => "Viimastel nädalatel on olnud uutele seentele liiga jahe – hooaeg on lõppemas.",
  sailimine: () => "Jahedus ja öökülmad on seened rikkunud.",
};
function aegPohjus(d, p, j) {
  if (T(d, p, j, F("indeks")) >= 0.3) return "";
  const nork = seeneajaTegurid(d, p, j).reduce((a, b) => (b.q < a.q ? b : a));
  if (nork.q < 0.6) return AEG_POHJUS[nork.nimi](nork.q);
  return ajaSelgitus(d, p, j).read.every((r) => r.v >= 0.4)
    ? "Uued seened juba tekivad – korjatavaks saavad need 1–3 nädala pärast."
    : "Seened tekivad 1–3 nädalat pärast vihma – head tingimused on olnud liiga ammu või liiga hiljuti.";
}

const hinne = (v) => Math.round(v * 100);

// ---------- explanation ----------

function puud(koosseis) {
  const osad = [...(koosseis || "").matchAll(/(\d+)([A-Z]+)/g)];
  if (!osad.length) return koosseis ? PUUD[koosseis] || koosseis : "puistu andmed puuduvad";
  return osad.map(([, k, s]) => `${PUUD[s] || s} ${k * 10}%`).join(", ");
}

function tegurid(r) {
  // explanation layers cover the inner cells only
  const I = r.G.info, k = I.kiht, [x, y] = xy(r.G, r.i), i = y * r.G.Wi + x;
  const t = (nimi) => k["t_" + nimi][i] / 255;
  const er = I.eraldised[(k.eraldis_hi[i] << 8 | k.eraldis_lo[i]) - 1];
  const mu = I.mullad[(k.muld_hi[i] << 8 | k.muld_lo[i]) - 1];
  const katvus = k.katvus[i], twi = k.twi[i] / 10, mets = k.metsaosa[i], soo = k.soo_10m[i] * 10;
  const vanus = er?.vanus;
  const pohjus = {
    puuliik: puud(er?.koosseis),
    vanus: vanus == null ? "vanus teadmata" : `${vanus} a – ${vanus < 15 ? "liiga noor" : vanus < 40 ? "noor, seeneniidistik alles kujuneb" : vanus <= 120 ? "parim vanus" : "vana puistu"}`,
    okotoon: soo < 20 ? "soo või turvasmulla sees" : soo <= 200 ? `soo/raba ${soo} m kaugusel – õhuniiskus püsib` : soo >= 2550 ? "soid lähedal ei ole" : `lähim soo ${soo} m kaugusel`,
    valgus: `võrastik katab ${katvus}%${katvus < 15 ? " – lage või raiesmik" : katvus < 40 ? " – hõre" : ""}`,
    kasvukoht: er?.kasvukoht ? `${er.kasvukoht} kasvukoht` : "kasvukoht teadmata",
    muld: mu || "mullakaardil andmed puuduvad",
    mikroniiskus: twi < 6.5 ? "kõrgem, kuivem koht (seljak)" : twi < 7.3 ? "kergelt kuiv koht" : twi <= 10 ? "parasniiske koht" : twi <= 11 ? "niiskem nõlvajalam" : "lohk või kraav, märg",
    sidusus: `${mets}% 300 m ümbrusest on mets${mets < 50 ? " – väike tukk, kuivab kiiresti" : ""}`,
    tihedus: katvus > 80 ? `väga tihe (${katvus}%), maapinnale jõuab vähe valgust` : "parajalt valgust",
  };
  // multipliers (0..1, limiting) and forest points (each worth at most its weight x 100)
  const astmed = window.HYYF.juhend.piiravad;
  const kordajad = Object.keys(astmed).map((nimi) => ({ nimi, x: t(nimi) ** astmed[nimi], pohjus: pohjus[nimi] }));
  const punktid = Object.entries(olek.meta.kaalud).map(([nimi, w]) => ({ nimi, p: t(nimi) * w * 100, max: w * 100, pohjus: pohjus[nimi] }));
  return { kordajad, punktid };
}

// time part for day d, point p, class position j
function ajaSelgitus(d, p, j) {
  const g = (nimi) => T(d, p, j, F(nimi));
  const indeks = g("indeks"), w = g("w"), niiskus = g("niiskus"), hooaeg = g("hooaeg"), temp = g("temperatuur");
  const kypseb = Math.round(g("kypseb") * 255);
  const read = [
    { nimi: "Niiskus", v: niiskus, sona: w < 0.2 ? "kuiv" : w < 0.45 ? "pigem kuiv" : niiskus < 0.8 ? "liiga märg" : "parajalt niiske" },
    { nimi: "Hooaeg", v: hooaeg, sona: hooaeg < 0.2 ? "liiga vara" : hooaeg < 0.8 ? "alles algab" : "käib" },
    { nimi: "Soojus", v: temp, sona: temp < 0.2 ? "liiga jahe" : temp < 0.8 ? "jahedavõitu" : "piisav" },
  ];
  let kokku;
  if (indeks >= 0.3) kokku = "Seeni on metsas praegu.";
  else {
    const nork = read.reduce((a, b) => (b.v < a.v ? b : a));
    kokku = nork.v < 0.5 ? `${nork.nimi}: ${nork.sona}.` : "Viimane vihm oli liiga ammu või liiga hiljuti – seened tekivad 1–3 nädalat pärast vihma.";
  }
  return { indeks, read, kokku, kypseb: kypseb >= 255 ? null : kypseb };
}

// mushroom-time factors at day d for the forest's water regime class (position j): summer warmth
// and moisture (season), soil moisture now, warmth now. Moisture depends on the forest, warmth not.
const ILM = (nimi, d, p) => olek.vilj.ilm[nimi][d]?.[p];
const TEGUR_AEG = { hooaeg: "Hooaja valmidus", niiskus: "Niiskus", soojus: "Soojus", sailimine: "Seente püsimine" };
const PERIOOD = 28;      // mushrooms in the forest now started 1-4 weeks ago: weather effects over 4 weeks
const PYSIMINE = 14;     // pickable mushrooms are at most ~2 weeks old
const POOLESTUS = 7;     // recent days weigh more: weight halves every 7 days back
const VEE_KIRJELDUS = {
  1: "Väike veevaru: kuivab paari päevaga ja vajab sagedast vihma, aga liigvett ei karda.",
  2: "Keskmine veevaru: talub nii lühikest põuda kui suurt vihma.",
  3: "Suur veevaru, põhjavesi lähedal: põuas parem kui kuivad metsad, pikk vihmane aeg teeb liiga märjaks.",
  4: "Põhjavesi maapinna lähedal: põud ei mõju, aga vihmane aeg teeb liiga märjaks.",
  5: "Kuivendatud turvas: hoiab vett hästi, märjal ajal jääb liiga niiskeks.",
};

function vihm(d, p, paevi) {
  let s = 0;
  for (let k = Math.max(0, d - paevi + 1); k <= d; k++) s += ILM("sademed", k, p) || 0;
  return s;
}

// mushroom time as effects of the weather, not the weather itself: is the mycelium ready
// (season), did moisture and warmth let new mushrooms start over the last 4 weeks, and how well
// did the mushrooms last (cold, frost, drought). Moisture and soil warmth are this forest type's own.
function seeneajaTegurid(d, p, j) {
  const A = window.HYYF.juhend.aeg, v = olek.vilj, aasta = v.kuupaevad[d].slice(0, 4);
  const g = (nimi, k = d) => T(k, p, j, F(nimi));
  const paevad = (n) => { const r = []; for (let k = d; k > d - n && k >= 0 && v.kuupaevad[k].slice(0, 4) === aasta; k--) r.push(k); return r; };
  const kaal = (k) => 0.5 ** ((d - k) / POOLESTUS);
  const kesk = (arr, f) => arr.reduce((s, k) => s + kaal(k) * f(k), 0) / Math.max(1e-9, arr.reduce((s, k) => s + kaal(k), 0));
  const per = paevad(PERIOOD), pys = paevad(PYSIMINE), n = per.length;
  const nadalat = Math.round(n / 7);
  const c = olek.klassid[j], R = A.reziim[c];

  // season: warm enough summer (degree days) and moist spring-summer -> mycelium ready to fruit
  const kp = ILM("kp", d, p), hooaeg = g("hooaeg");
  const kpVaja = A.hooaeg_kp.at(-1)[0];
  const sKp = kp == null ? hooaeg : kohal(A.hooaeg_kp, kp) / 100;
  const m = sKp > 0.05 ? Math.min(1, hooaeg / sKp) : 1;
  const hooaegPohjus = sKp < 0.05 ? `liiga vara – suvi pole veel piisavalt soe olnud (${Math.round(kp)} kraadipäeva, vaja ~${kpVaja})`
    : sKp < 1 ? `seeneniidistik alles valmib: ${Math.round(kp)} kraadipäeva ~${kpVaja}-st`
    : m >= 0.9 ? "suvi on olnud piisavalt soe ja niiske – seeneniidistik on valmis vilju kandma"
    : `suvi on olnud piisavalt soe, aga ${Math.round(A.hooaeg_aken[1] / 7)}–${Math.round(A.hooaeg_aken[0] / 7)} nädalat tagasi ${m >= 0.6 ? "kuivavõitu" : "kuiv"} – seeneniidistik on nõrgem`;

  // new mushrooms over the period: share of days with good moisture / warmth for this forest
  const niiskus = kesk(per, (k) => g("niiskus", k));
  const hea = (f) => per.filter((k) => g(f, k) >= 0.8).length;
  const kuivi = per.filter((k) => g("w", k) < 0.45).length, margi = per.filter((k) => g("w", k) >= 0.45 && g("niiskus", k) < 0.8).length;
  const niiskusPohjus = `vihma ${Math.round(vihm(d, p, n))} mm · sobiv niiskus ${hea("niiskus")} päeval ${n}-st` +
    (kuivi > n / 3 ? " – liiga kuiv" : margi > n / 3 ? " – liiga märg" : "");
  const soojus = kesk(per, (k) => g("temperatuur", k));
  const ohk = kesk(per, (k) => ILM("temp", k, p) ?? 0), muld = kesk(per, (k) => g("mullatemp", k) * v.mullatemp_skaala);
  const soojusPohjus = `õhk keskmiselt ${Math.round(ohk)} °C, selle metsa muld ${Math.round(muld)} °C · piisavalt soe ${hea("temperatuur")} päeval ${n}-st` +
    (R.soojus > 0 ? " (kuiv liivamuld soojeneb kiiresti)" : R.soojus < 0 ? " (märg muld soojeneb aeglaselt)" : "");

  // how well mushrooms last, as in the model: daily survival and ageing (cool days age them
  // 1.5x, frost 3x faster) relative to a normal warm, moist day
  const vananeb = (k) => (ILM("tmin", k, p) ?? 99) < A.kulm ? A.vananemine_kulm : (ILM("temp", k, p) ?? 99) < A.jahe ? A.vananemine_jahe : 1;
  const sailimine = Math.min(1, kesk(pys, (k) => g("sailimine", k) / (1 - A.elu / 100) / vananeb(k)));
  const kylm = pys.filter((k) => (ILM("tmin", k, p) ?? 99) < A.kulm).length;
  const jahe = pys.filter((k) => (ILM("temp", k, p) ?? 99) < A.jahe).length;
  const poud = pys.filter((k) => g("w", k) < 0.2).length;
  const halvad = [kylm && `öökülma ${kylm}`, jahe && `jahedaid päevi ${jahe}`, poud && `põuapäevi ${poud}`].filter(Boolean);
  const sailPohjus = halvad.length ? `viimase ${pys.length} päeva jooksul ${halvad.join(", ")} – seened vananevad ja kaovad kiiremini`
    : `viimased ${pys.length} päeva soojad ja niisked – seened püsivad kaua`;

  return [
    { nimi: "hooaeg", q: hooaeg, pohjus: hooaegPohjus },
    { nimi: "niiskus", q: niiskus, pohjus: `${nadalat} nädalat: ${niiskusPohjus}` },
    { nimi: "soojus", q: soojus, pohjus: `${nadalat} nädalat: ${soojusPohjus}` },
    { nimi: "sailimine", q: sailimine, pohjus: sailPohjus },
  ];
}

// moisture and warmth of this forest, 4 weeks back and the forecast, one panel each on a shared
// time axis (different units, so not one y axis): soil water of its own bucket with daily rain under it, and topsoil
// temperature of this forest type with the 5-day mean air temperature, each with its optimum band
function ilmaGraafik(d, p, j) {
  const v = olek.vilj, J = window.HYYF.juhend.aeg, aasta = v.kuupaevad[d].slice(0, 4);
  let a = d, b = d;
  while (a > 0 && d - a < 27 && v.kuupaevad[a - 1].slice(0, 4) === aasta) a--;
  while (b < v.kuupaevad.length - 1 && b - d < 10 && v.kuupaevad[b + 1].slice(0, 4) === aasta) b++;
  const c = olek.klassid[j], R = J.reziim[c];
  const W = 320, H = 226, pad = 6, n = Math.max(1, b - a);
  const N = [16, 70], V = [74, 100], S = [122, 200];   // moisture with its rain strip below, warmth: [top, bottom] in px
  const xs = (k) => pad + (k - a) / n * (W - 2 * pad);
  const paevad = [];
  for (let k = a; k <= b; k++) paevad.push(k);
  const tee = (f) => paevad.map((k, kk) => `${kk ? "L" : "M"}${xs(k).toFixed(1)},${f(k).toFixed(1)}`).join("");
  const riba = (y0, y1, cls) => `<rect x="${pad}" y="${Math.min(y0, y1).toFixed(1)}" width="${W - 2 * pad}" height="${Math.abs(y1 - y0).toFixed(1)}" class="${cls}"/>`;

  // moisture: relative storage 0..1
  const yN = (w) => N[1] - Math.max(0, Math.min(1, w)) * (N[1] - N[0]);
  const fw = F("w"), wv = (k) => T(k, p, j, fw);
  const opt = J.niiskus.filter(([, y]) => y >= 100).map(([x]) => x);
  const marg = R.marg < 90;
  const wMin = J.niiskus[Math.max(0, J.niiskus.findIndex(([, y]) => y > 0) - 1)][0];   // below: too dry

  // daily rain, mm
  const mm = paevad.map((k) => ILM("sademed", k, p) || 0), mmMax = Math.max(10, ...mm);
  const w2 = (W - 2 * pad) / (n + 1);
  const vihmaRibad = mm.map((x, kk) => x < 0.2 ? "" : `<rect x="${(xs(a + kk) - w2 / 2 + 0.5).toFixed(1)}" y="${(V[1] - x / mmMax * (V[1] - V[0])).toFixed(1)}" width="${Math.max(1, w2 - 1).toFixed(1)}" height="${(x / mmMax * (V[1] - V[0])).toFixed(1)}" class="g-vihm${v.paeva_allikas[a + kk] === "prognoos" ? " g-vihm-prog" : ""}"/>`).join("");

  // warmth: topsoil of this forest type and the 5-day mean air temperature, C
  const muld = (k) => T(k, p, j, F("mullatemp")) * v.mullatemp_skaala;
  const ohk = (k) => { let s = 0, m = 0; for (let q = Math.max(0, k - J.algus_temp_aken + 1); q <= k; q++) { const t = ILM("temp", q, p); if (t != null) { s += t; m++; } } return m ? s / m : null; };
  const temps = paevad.flatMap((k) => [muld(k), ohk(k)]).filter((t) => t != null);
  const lo = Math.min(4, Math.floor(Math.min(...temps))), hi = Math.max(24, Math.ceil(Math.max(...temps)));
  const yS = (t) => S[1] - (Math.max(lo, Math.min(hi, t)) - lo) / (hi - lo) * (S[1] - S[0]);
  const tOpt = J.algus_temp.filter(([, y]) => y >= 100).map(([x]) => x);   // e.g. 14..22 C
  const tMin = J.mulla_temp[Math.max(0, J.mulla_temp.findIndex(([, y]) => y > 0) - 1)][0];   // below: too cold
  const ohkTee = paevad.filter((k) => ohk(k) != null);

  const progI = v.paeva_allikas.indexOf("prognoos", a);
  const progAlgus = progI >= 0 && progI <= b ? xs(progI - 0.5) : null;
  const kp = (k) => `${+v.kuupaevad[k].slice(8)}.${v.kuupaevad[k].slice(5, 7)}`;
  const tx = xs(d);
  const soojusLause = R.soojus > 0 ? "Kuiv liivamuld soojeneb päikese käes kiiresti ja jahtub sügisel kiiresti."
    : R.soojus < 0 ? "Märg muld soojeneb aeglaselt ja jääb suvel jahedamaks." : "";
  return `<svg class="g" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mulla niiskus ja soojus selles metsas">
    ${progAlgus != null ? `<rect x="${progAlgus}" y="2" width="${W - pad - progAlgus}" height="${S[1] - 2}" class="g-prognoosiala"/><text x="${(progAlgus + W - pad) / 2}" y="10" class="g-silt" text-anchor="middle">prognoos</text>` : ""}
    <text x="${pad}" y="${N[0] - 4}" class="g-silt g-tugev">Niiskus</text>
    ${riba(yN(opt[0]), yN(opt.at(-1)), "g-opt")}
    ${marg ? riba(yN(opt.at(-1)), yN(1), "g-marg") : ""}
    <line x1="${pad}" x2="${W - pad}" y1="${N[1]}" y2="${N[1]}" class="g-joon"/>
    <line x1="${pad}" x2="${W - pad}" y1="${yN(wMin)}" y2="${yN(wMin)}" class="g-joon"/>
    <path d="${tee((k) => yN(wv(k)))}" class="g-vesi"/>
    <circle cx="${tx}" cy="${yN(wv(d))}" r="4" class="g-tapp g-tapp-vesi"/>
    <text x="${pad + 2}" y="${yN(opt[0]) - 3}" class="g-silt g-halo">${Math.round(opt[0] * 100)} %</text>
    <text x="${pad + 2}" y="${yN(wMin) - 3}" class="g-silt g-halo">${Math.round(wMin * 100)} %</text>

    ${vihmaRibad}
    <text x="${pad + 2}" y="${V[0] + 8}" class="g-silt g-halo">vihm, kuni ${Math.round(mmMax)} mm päevas</text>
    <line x1="${pad}" x2="${W - pad}" y1="${V[1]}" y2="${V[1]}" class="g-joon"/>

    <text x="${pad}" y="${S[0] - 4}" class="g-silt g-tugev">Soojus</text>
    ${riba(yS(tOpt[0]), yS(Math.min(hi, tOpt.at(-1))), "g-opt")}
    <line x1="${pad}" x2="${W - pad}" y1="${yS(tMin)}" y2="${yS(tMin)}" class="g-joon"/>
    <line x1="${pad}" x2="${W - pad}" y1="${S[1]}" y2="${S[1]}" class="g-joon"/>
    ${ohkTee.length > 1 ? `<path d="${ohkTee.map((k, kk) => `${kk ? "L" : "M"}${xs(k).toFixed(1)},${yS(ohk(k)).toFixed(1)}`).join("")}" class="g-ohk"/>` : ""}
    <path d="${tee((k) => yS(muld(k)))}" class="g-muld"/>
    <circle cx="${tx}" cy="${yS(muld(d))}" r="4" class="g-tapp g-tapp-muld"/>
    <text x="${pad + 2}" y="${yS(tOpt[0]) - 3}" class="g-silt g-halo">${tOpt[0]} °C</text>
    <text x="${pad + 2}" y="${yS(tMin) - 3}" class="g-silt g-halo">${tMin} °C</text>

    <line x1="${tx}" x2="${tx}" y1="${N[0]}" y2="${S[1]}" class="g-tana"/>
    <text x="${pad}" y="${H - 3}" class="g-silt">${kp(a)}</text>
    <text x="${tx}" y="${H - 3}" class="g-silt g-tugev" text-anchor="middle">${v.kuupaevad[d] === v.tana ? "täna" : kp(d)}</text>
    ${b > d + 2 ? `<text x="${W - pad}" y="${H - 3}" class="g-silt" text-anchor="end">${kp(b)}</text>` : ""}
  </svg>
  <div class="g-legend"><span><i class="g-l-vesi"></i>mulla veevaru (${R.nimi}, ${R.kp} mm)</span><span><i class="g-l-muld"></i>selle metsa muld</span><span><i class="g-l-ohk"></i>õhk (${J.algus_temp_aken} p keskmine)</span><span><i class="g-l-vihm"></i>vihm</span><span><i class="g-l-opt"></i>parim</span>${marg ? `<span><i class="g-l-marg"></i>liiga märg</span>` : ""}</div>
  <p class="vaike g-markus">${VEE_KIRJELDUS[c] || ""} ${soojusLause}</p>`;
}

const pk = (x) => String(Math.round(x));
const kord = (x) => "×" + x.toFixed(2).replace(".", ",");
const kvaliteet = (q) => (q >= 0.85 ? "hea" : q >= 0.6 ? "keskmine" : "nork");
const IKOON = {
  mets: '<svg viewBox="0 0 24 24"><path d="M12 3l-5 7h3l-4 6h12l-4-6h3z"/><path d="M12 16v5"/></svg>',
  aeg: '<svg viewBox="0 0 24 24"><path d="M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5A3.5 3.5 0 0 1 17 18z"/><path d="M9 21l.5-1M13 21l.5-1"/></svg>',
};

// step bar: equal segments (below, then the steps from low to high) in the class colours;
// segments above the current step are faded, the marker sits inside its segment
function astmeAsend(x, piirid) {
  const yles = [...piirid].reverse(), lo = [0, ...yles], hi = [...yles, 1];
  const k = Math.max(0, lo.findLastIndex((a) => x >= a));
  return [(k + Math.min(1, (Math.min(x, 1) - lo[k]) / (hi[k] - lo[k]))) / lo.length, k];
}
function astmeriba(x, piirid) {
  const varv = ["var(--pind-3)", ...VARV.slice(1).reverse()];
  const [asend, k] = astmeAsend(x, piirid);
  const segs = varv.slice(0, piirid.length + 1).map((c, kk) => `<span class="aste-seg${kk > k ? " tuhm" : ""}" style="background:${c}"></span>`).join("");
  return `<div class="astmeriba"><div class="aste-segmendid">${segs}<span class="aste-marker" style="left:${asend * 100}%"></span></div></div>`;
}

// mushroom time: one week back and the forecast ahead; below it, day by day, how well new
// mushrooms can start (they are ready to pick 1-3 weeks later)
function graafik(r, d, p, j) {
  const v = olek.vilj, aasta = v.kuupaevad[d].slice(0, 4);
  let a = d, b = d;
  while (a > 0 && d - a < 7 && v.kuupaevad[a - 1].slice(0, 4) === aasta) a--;
  while (b < v.kuupaevad.length - 1 && b - d < 10 && v.kuupaevad[b + 1].slice(0, 4) === aasta) b++;
  const W = 320, H = 92, pad = 6, n = Math.max(1, b - a), riba = 10, alus = H - 30;
  const xs = (k) => pad + (k - a) / n * (W - 2 * pad), ys = (val) => alus - val * (alus - 8);
  const pts = [];
  for (let k = a; k <= b; k++) pts.push([xs(k), ys(Math.min(1, hinnang(r, k)[1])), v.paeva_allikas[k] === "prognoos"]);
  const tee = (arr) => arr.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const moot = pts.filter((q) => !q[2]), prog = pts.slice(Math.max(0, moot.length - 1));
  const A = olek.meta.astmed.aeg;
  const jooned = [[A[0], "hea"], [A[1], "keskmine"]].map(([val, nimi]) =>
    `<line x1="${pad}" x2="${W - pad}" y1="${ys(val)}" y2="${ys(val)}" class="g-joon"/><text x="${W - pad}" y="${ys(val) - 3}" class="g-silt" text-anchor="end">${nimi}</text>`).join("");
  const [tx, ty] = pts[d - a];
  const progAlgus = moot.length < pts.length ? moot.at(-1)[0] : null;
  // new mushrooms: the weakest of moisture, season and warmth on each day
  const lahtrid = [];
  for (let k = a; k <= b; k++) {
    const q = Math.min(...["niiskus", "hooaeg", "temperatuur"].map((f) => T(k, p, j, F(f))));
    const c = q >= 0.8 ? "#a4432a" : q >= 0.4 ? "#e9cf8f" : "var(--pind-3)";
    const w2 = (W - 2 * pad) / (n + 1);
    lahtrid.push(`<rect x="${(xs(k) - w2 / 2 + 1).toFixed(1)}" y="${H - 26}" width="${(w2 - 2).toFixed(1)}" height="${riba}" rx="2" style="fill:${c};stroke:none"/>`);
  }
  const kp = (k) => `${+v.kuupaevad[k].slice(8)}.${v.kuupaevad[k].slice(5, 7)}`;
  return `<svg class="g" viewBox="0 0 ${W} ${H}" role="img" aria-label="Seeneaeg nädal tagasi ja prognoos">
    ${progAlgus != null ? `<rect x="${progAlgus}" y="2" width="${W - pad - progAlgus}" height="${alus - 2}" class="g-prognoosiala"/><text x="${(progAlgus + W - pad) / 2}" y="12" class="g-silt" text-anchor="middle">prognoos</text>` : ""}
    ${jooned}
    <path d="${tee(moot)}" class="g-tee"/>
    ${prog.length > 1 ? `<path d="${tee(prog)}" class="g-tee g-prognoos"/>` : ""}
    <line x1="${tx}" x2="${tx}" y1="2" y2="${alus}" class="g-tana"/>
    <circle cx="${tx}" cy="${ty}" r="4.5" class="g-tapp"/>
    ${lahtrid.join("")}
    <text x="${pad}" y="${H - 3}" class="g-silt">${kp(a)}</text>
    <text x="${tx}" y="${H - 3}" class="g-silt g-tugev" text-anchor="middle">${v.kuupaevad[d] === v.tana ? "täna" : kp(d)}</text>
    ${b > d + 2 ? `<text x="${W - pad}" y="${H - 3}" class="g-silt" text-anchor="end">${kp(b)}</text>` : ""}
  </svg>
  <div class="g-legend"><span><i class="g-l-joon"></i>seeni metsas</span><span><i style="background:#a4432a"></i>uued seened tekivad</span><span><i style="background:#e9cf8f"></i>vähe</span><span><i style="background:var(--pind-3)"></i>ei teki</span></div>`;
}

// forest waterfall: the forest points build up to 100 category by category (grey = points this
// place does not get), then each multiplier cuts the total down to Koht
const KOSK_NIMI = { valgus: "Valgus" };
function kosk(r, koht) {
  const { kordajad, punktid } = tegurid(r);
  const W = 320, L = 112, R = W - 44, rida = 19, sx = (v) => L + v / 100 * (R - L);
  const read = [];
  let kum = 0;
  for (const r of punktid) {
    read.push({ nimi: TEGUR_NIMI[r.nimi], a: kum, b: kum + r.p, c: kum + r.max, tekst: `${pk(r.p)}/${pk(r.max)}`, liik: "p" });
    kum += r.p;
  }
  read.push({ nimi: "Metsa punktid", a: 0, b: kum, tekst: pk(kum), liik: "s" });
  let v = kum;
  for (const r of kordajad) {
    read.push({ nimi: KOSK_NIMI[r.nimi] || TEGUR_NIMI[r.nimi], a: v * r.x, b: v, tekst: kord(r.x), liik: "k" });
    v *= r.x;
  }
  // the map uses the 100 m neighbourhood mean of whole scores, the rows above are neighbourhood
  // means of each factor: the two differ a little
  if (Math.abs(v - koht * 100) >= 1.5) read.push({ nimi: "100 m ümbrus", a: Math.min(v, koht * 100), b: Math.max(v, koht * 100), tekst: (koht * 100 > v ? "+" : "−") + pk(Math.abs(koht * 100 - v)), liik: "u" });
  read.push({ nimi: "Koht", a: 0, b: koht * 100, tekst: pk(koht * 100), liik: "s" });
  const H = read.length * rida + 22;
  const A = olek.meta.astmed.koht;
  const piirid = A.map((t) => `<line x1="${sx(t * 100)}" x2="${sx(t * 100)}" y1="2" y2="${H - 18}" class="k-piir"/>`).join("");
  const ridu = read.map((r, k) => {
    const y = k * rida + 4, h = rida - 7, ym = y + h / 2 + 3.5;
    let bar = "";
    if (r.liik === "p") bar = `<rect x="${sx(r.b)}" y="${y}" width="${Math.max(0, sx(r.c) - sx(r.b))}" height="${h}" class="k-kadu"/><rect x="${sx(r.a)}" y="${y}" width="${Math.max(0, sx(r.b) - sx(r.a))}" height="${h}" class="k-pluss"/>`;
    else if (r.liik === "k" || r.liik === "u") bar = `<rect x="${sx(r.a)}" y="${y}" width="${Math.max(0.5, sx(r.b) - sx(r.a))}" height="${h}" class="k-miinus"/>`;
    else bar = `<rect x="${sx(0)}" y="${y}" width="${sx(r.b) - sx(0)}" height="${h}" class="${r.nimi === "Koht" ? "k-koht" : "k-summa"}"/>`;
    // connector to the next row at the running total
    const jargmine = read[k + 1], ots = r.liik === "k" ? r.a : r.liik === "u" ? koht * 100 : r.b;
    const sild = jargmine
      ? `<line x1="${sx(ots)}" x2="${sx(ots)}" y1="${y + h}" y2="${y + rida}" class="k-sild"/>` : "";
    const eraldus = r.liik === "s" ? `<line x1="0" x2="${W}" y1="${y - 3.5}" y2="${y - 3.5}" class="k-eraldus"/>` : "";
    return `${eraldus}<text x="0" y="${ym}" class="k-nimi${r.liik === "s" ? " g-tugev" : ""}">${r.nimi}</text>${bar}${sild}
      <text x="${W}" y="${ym}" class="k-arv${r.liik === "s" ? " g-tugev" : ""}" text-anchor="end">${r.tekst}</text>`;
  }).join("");
  const telg = [0, 25, 50, 75, 100].map((t) => `<text x="${sx(t)}" y="${H - 4}" class="g-silt" text-anchor="middle">${t}</text>`).join("");
  return `<svg class="g k-kosk" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kuidas metsa hinne kokku tuleb">${piirid}${ridu}${telg}</svg>
  <div class="g-legend"><span><i class="k-l-pluss"></i>saadud punktid</span><span><i class="k-l-kadu"></i>jääb saamata</span><span><i class="k-l-miinus"></i>kordaja võtab maha</span><span><i class="k-l-piir"></i>klassipiirid</span></div>`;
}

// mushroom time: the four weather effects as bars (grey = what is missing), then the resulting
// Aeg with the class bounds. Not a product: new mushrooms need season, moisture and warmth at the
// same time, and survival decides how long they last
function aegKosk(d, p, j, aegV) {
  const W = 320, L = 112, R = W - 44, rida = 19, sx = (v) => L + v / 100 * (R - L);
  const read = seeneajaTegurid(d, p, j).map((r) => ({ nimi: TEGUR_AEG[r.nimi], v: Math.min(1, r.q) * 100, liik: "p" }));
  read.push({ nimi: "Seeneaeg", v: Math.min(1, aegV) * 100, liik: "s" });
  const H = read.length * rida + 26;
  const piirid = olek.meta.astmed.aeg.map((t) => `<line x1="${sx(t * 100)}" x2="${sx(t * 100)}" y1="${(read.length - 1) * rida}" y2="${H - 18}" class="k-piir"/>`).join("");
  const ridu = read.map((r, k) => {
    const y = k * rida + 4 + (r.liik === "s" ? 4 : 0), h = rida - 7, ym = y + h / 2 + 3.5;
    const bar = r.liik === "p"
      ? `<rect x="${sx(0)}" y="${y}" width="${sx(100) - sx(0)}" height="${h}" class="k-kadu"/><rect x="${sx(0)}" y="${y}" width="${sx(r.v) - sx(0)}" height="${h}" class="k-pluss"/>`
      : `<line x1="0" x2="${W}" y1="${y - 4}" y2="${y - 4}" class="k-eraldus"/><rect x="${sx(0)}" y="${y}" width="${Math.max(0.5, sx(r.v) - sx(0))}" height="${h}" class="k-koht"/>`;
    return `<text x="0" y="${ym}" class="k-nimi${r.liik === "s" ? " g-tugev" : ""}">${r.nimi}</text>${bar}
      <text x="${W}" y="${ym}" class="k-arv${r.liik === "s" ? " g-tugev" : ""}" text-anchor="end">${pk(r.v)}%</text>`;
  }).join("");
  const telg = [0, 25, 50, 75, 100].map((t) => `<text x="${sx(t)}" y="${H - 4}" class="g-silt" text-anchor="middle">${t}</text>`).join("");
  return `<svg class="g k-kosk" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kuidas seeneaja hinne kokku tuleb">${piirid}${ridu}${telg}</svg>
  <p class="vaike g-markus">Uued seened tekivad, kui hooaeg, niiskus ja soojus on korraga head; püsimine ütleb, kui kaua need metsas korjatavad on.</p>`;
}

async function naitaSelgitust(lnglat) {
  const r = await leiaRakk(lnglat[0] ?? lnglat.lng, lnglat[1] ?? lnglat.lat);
  if (!r) return;
  const p = r.G.kiht.ilmapunkt[r.i], d = olek.paev, A = olek.meta.astmed;
  const tana = olek.reziim === "tana";
  // headline: the same numbers the map colour comes from (100 m neighbourhood)
  const [koht, aegV] = hinnang(r);
  const kl = klassKA(koht, aegV);
  // conditions for new mushrooms: the water regime class that dominates this place
  const j = olek.klassid.map((c) => r.G.kiht["S" + c][r.i]).reduce((b, x, jj, a) => (x > a[b] ? jj : b), 0);
  const aeg = ajaSelgitus(d, p, j);
  const { kordajad, punktid } = tegurid(r);
  const kAste = aste(koht, A.koht), aAste = aste(aegV, A.aeg);

  // all forest properties as bars: host trees, age and light first, then the rest
  const ribad = [...kordajad.map((r) => ({ nimi: r.nimi, q: r.x, pohjus: r.pohjus })),
                 ...punktid.map((r) => ({ nimi: r.nimi, q: r.p / r.max, pohjus: r.pohjus }))];
  // one line per property (name, bar, reason cut short); a click opens the whole reason
  const omadus = (r) => `<li tabindex="0" title="Näita põhjust"><span class="tegur">${KOSK_NIMI[r.nimi] || TEGUR_NIMI[r.nimi] || r.nimi}</span><span class="riba q-${kvaliteet(r.q)}"><span style="width:${Math.round(r.q * 100)}%"></span></span><span class="pohjus">${r.pohjus}</span></li>`;

  // where the forecast is heading, and when today's new mushrooms are ready
  const v = olek.vilj;
  let lopp = d;
  while (lopp < v.kuupaevad.length - 1 && lopp - d < 10 && v.kuupaevad[lopp + 1].slice(0, 4) === v.kuupaevad[d].slice(0, 4)) lopp++;
  const muutus = hinnang(r, lopp)[1] - aegV;
  const suund = lopp === d ? "" : muutus > 0.08 ? "Prognoosi järgi seeni lisandub." : muutus < -0.08 ? "Prognoosi järgi seeni jääb vähemaks." : "Prognoosi järgi jääb seeni umbes sama palju.";
  const kuupaev = (k) => {
    const x = new Date(v.kuupaevad[d] + "T12:00");
    x.setDate(x.getDate() + k);
    return `${x.getDate()}.${String(x.getMonth() + 1).padStart(2, "0")}`;
  };
  const tekib = aeg.read.every((r) => r.v >= 0.4);
  const korjatav = aeg.kypseb != null && tekib
    ? `Täna alanud seened on korjatavad umbes <b>${kuupaev(aeg.kypseb)}</b>.`
    : aeg.kypseb == null ? "Liiga jahe – uued seened ei jõua enam küpseda." : `Täna uusi seeni peaaegu ei teki (${aeg.read.filter((r) => r.v < 0.4).map((r) => r.sona).join(", ")}).`;

  const VAATED = { ylevaade: "Ülevaade", seened: "Seened ja ilm", arvutus: "Arvutus" };
  const vaade = VAATED[olek.kaardiVaade] && (tana || olek.kaardiVaade !== "seened") ? olek.kaardiVaade : "ylevaade";
  const valik = `<div class="segment vaade-valik" role="group" aria-label="Selgituse vaade">${Object.entries(VAATED)
    .filter(([k]) => tana || k !== "seened")
    .map(([k, nimi]) => `<button data-vaade="${k}"${k === vaade ? ' class="aktiivne"' : ""}>${nimi}</button>`).join("")}</div>`;
  const kypsebHtml = tana ? `<p class="kypseb">${suund ? suund + " " : ""}${korjatav}</p>` : "";

  // overview: the two steps, then every property on one line each (no charts, little scrolling)
  const ylevaadeHtml = `
    <div class="kaksik${tana ? "" : " yks"}">
      <div class="naitaja">
        <div class="n-pea">${IKOON.mets}Mets</div>
        <div class="n-rida"><span class="n-sona">${kAste >= 0 ? ASTE_KOHT[kAste] : "nõrk"}</span><span class="n-arv">${hinne(koht)}</span></div>
        ${astmeriba(koht, A.koht)}
      </div>
      ${tana ? `<div class="naitaja">
        <div class="n-pea">${IKOON.aeg}Seeneaeg</div>
        <div class="n-rida"><span class="n-sona">${aAste >= 0 ? ASTE_AEG[aAste] : "seeni pole"}</span><span class="n-arv">${hinne(Math.min(1, aegV))}%</span></div>
        ${astmeriba(Math.min(1, aegV), A.aeg)}
      </div>` : ""}
    </div>
    ${kypsebHtml}
    <h3 class="sel-h">${IKOON.mets}Mets</h3>
    <ul class="omadused">${ribad.map(omadus).join("")}</ul>
    ${tana ? `<h3 class="sel-h">${IKOON.aeg}Seeneaeg – ilma mõju</h3>
    <ul class="omadused">${seeneajaTegurid(d, p, j).map((r) => omadus({ ...r, nimi: TEGUR_AEG[r.nimi] })).join("")}</ul>` : ""}`;

  // mushrooms and weather over time: amount of mushrooms, then moisture and warmth of this forest
  const seenedHtml = `
    <h3 class="sel-h sel-h-esimene">${IKOON.aeg}Seente hulk</h3>
    ${graafik(r, d, p, j)}
    ${kypsebHtml}
    <h3 class="sel-h">Niiskus ja soojus selles metsas</h3>
    ${ilmaGraafik(d, p, j)}`;

  // how the two scores add up: forest points and multipliers, then the weather effects
  const arvutusHtml = `
    <h3 class="sel-h sel-h-esimene">${IKOON.mets}Metsa hinne</h3>
    ${kosk(r, koht)}
    ${tana ? `<h3 class="sel-h">${IKOON.aeg}Seeneaja hinne</h3>
    ${aegKosk(d, p, j, aegV)}` : ""}`;

  const html = valik + { ylevaade: ylevaadeHtml, seened: seenedHtml, arvutus: arvutusHtml }[vaade];
  // explanation in a side drawer (bottom sheet on phones), the spot marked with a dot
  peidaSelgitus();
  const silt = document.getElementById("sahtel-silt");
  silt.textContent = kl >= 0 ? KLASSID[olek.reziim][kl][0] : "Kaardil ei näidata";
  silt.className = "otsus-silt";
  silt.style.background = kl >= 0 ? KLASSID[olek.reziim][kl][1] : "";
  silt.style.color = kl >= 0 ? tekstVarv(KLASSID[olek.reziim][kl][1]) : "";
  // the score: forest x mushroom time (forest only in "Head metsad" mode), shown next to the label
  const skoor = document.getElementById("sahtel-hinne");
  skoor.innerHTML = `<span class="hinne-arv">${hinne(tana ? koht * Math.min(1, aegV) : koht)}</span><span class="hinne-silt">hinne</span>`;
  const sisu = document.getElementById("selgitus");
  sisu.innerHTML = html;
  sisu.scrollTop = 0;
  sisu.querySelectorAll(".omadused li").forEach((li) => {
    li.onclick = () => li.classList.toggle("lahti");
    li.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); li.click(); } };
  });
  naitaKoordinaadid(lnglat);
  sisu.querySelectorAll(".vaade-valik button").forEach((nupp) => nupp.onclick = () => {
    olek.kaardiVaade = nupp.dataset.vaade;
    try { localStorage.setItem("hyyf-kaardivaade", olek.kaardiVaade); } catch (e) { /* private mode */ }
    naitaSelgitust(lnglat);
  });
  document.getElementById("sahtel").hidden = false;
  document.getElementById("parimad-kaart").style.visibility = "hidden";
  const tapp = document.createElement("div");
  tapp.className = "tapp";
  olek.tapp = new maplibregl.Marker({ element: tapp }).setLngLat(lnglat).addTo(map);
}

// WGS84 coordinates of the clicked spot, ready to paste into a map app or a phone's navigator
function naitaKoordinaadid(lnglat) {
  const lng = lnglat[0] ?? lnglat.lng, lat = lnglat[1] ?? lnglat.lat;
  const tekst = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const koht = document.getElementById("sahtel-koord");
  koht.innerHTML = `<span>${tekst}</span><button class="kopeeri" title="Kopeeri koordinaadid" aria-label="Kopeeri koordinaadid">
    <svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg><span>Kopeeri</span></button>`;
  const nupp = koht.querySelector("button");
  nupp.onclick = async () => {
    try { await navigator.clipboard.writeText(tekst); }
    catch (e) {   // older browsers, or no clipboard permission: select the text instead
      const r = document.createRange(); r.selectNodeContents(koht.firstChild);
      getSelection().removeAllRanges(); getSelection().addRange(r);
      return;
    }
    nupp.classList.add("tehtud");
    nupp.lastChild.textContent = "Kopeeritud";
    setTimeout(() => { nupp.classList.remove("tehtud"); nupp.lastChild.textContent = "Kopeeri"; }, 1600);
  };
}

function peidaSelgitus() {
  if (olek.tapp) olek.tapp.remove();
  olek.tapp = null;
  document.getElementById("sahtel").hidden = true;
  document.getElementById("parimad-kaart").style.visibility = "";
}

// ---------- guide (built from the model's own parameters in window.HYYF.juhend) ----------

const nr = (x) => String(x).replace(".", ",");

// piecewise-linear curve [[x, score 0..100], ...] -> readable rows; fy formats the score
function kover(punktid, yhik = "", fy = (y) => `${y}`) {
  const read = [];
  for (let i = 0; i + 1 < punktid.length; i++) {
    const [x0, y0] = punktid[i], [x1, y1] = punktid[i + 1];
    if (x1 === x0) continue;
    const vahemik = i === 0 && x0 <= 0 ? `alla ${nr(x1)}${yhik}` : x1 >= 10000 || i === punktid.length - 2 && y0 === y1 ? `üle ${nr(x0)}${yhik}` : `${nr(x0)}–${nr(x1)}${yhik}`;
    read.push([vahemik, y0 === y1 ? fy(y0) : `${fy(y0)} → ${fy(y1)}`]);
  }
  return read;
}

// value of a curve at x (same linear interpolation as the model)
function kohal(punktid, x) {
  if (x <= punktid[0][0]) return punktid[0][1];
  for (let i = 1; i < punktid.length; i++) {
    const [x0, y0] = punktid[i - 1], [x1, y1] = punktid[i];
    if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return punktid.at(-1)[1];
}

const tabel = (read, pais = ["", "punkte"]) =>
  `<table><thead><tr><th>${pais[0]}</th><th>${pais[1]}</th></tr></thead><tbody>${read.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</tbody></table>`;

const osa = (pealkiri, sisu, lahti = false) => `<details${lahti ? " open" : ""}><summary>${pealkiri}</summary>${sisu}</details>`;

function giidHtml() {
  const J = window.HYYF.juhend, A = J.aeg, AST = olek.meta.astmed;
  const lahter = (ki, ai) => {
    const c = ki + ai;
    return c < KLASSID.tana.length ? `<td style="background:${KLASSID.tana[c][1]};color:${tekstVarv(KLASSID.tana[c][1])}">${KLASSID.tana[c][0]}</td>` : `<td class="tyhi">–</td>`;
  };
  const maatriks = `<table class="maatriks"><thead><tr><th>Mets ↓ · Seeneaeg →</th>${ASTE_AEG.map((n, ai) => `<th>${n}<br><small>Aeg ${Math.round(AST.aeg[ai] * 100)}%+</small></th>`).join("")}</tr></thead>
    <tbody>${ASTE_KOHT.map((n, ki) => `<tr><th>${n}<br><small>Koht ${Math.round(AST.koht[ki] * 100)}+</small></th>${ASTE_AEG.map((_, ai) => lahter(ki, ai)).join("")}</tr>`).join("")}</tbody></table>`;
  const max = Object.fromEntries(Object.entries(J.kaalud).map(([n, w]) => [n, Math.round(w * 100)]));
  const p = (n) => (y) => pk(y / 100 * max[n]);            // score 0..100 -> points of category n
  const x = (y) => kord(y / 100);                          // score 0..100 -> multiplier
  const ylevaade = Object.entries(max).map(([n, m]) =>
    `<li><span>${TEGUR_NIMI[n]}</span><span class="riba"><span style="width:${m / 36 * 100}%"></span></span><span class="arv">${m} p</span></li>`).join("");

  // worked example, computed with the same rules
  const M = J.muld_astmed;
  const mullaP = (loimis, niiskus, hape) => max.muld * (loimis / 100) ** M.loimis * (niiskus / 100) ** M.niiskus * (hape / 100) ** M.hape;
  const puuMA = J.puuliik.find((r) => r[0] === "mänd")[1], puuKU = J.puuliik.find((r) => r[0] === "kuusk")[1];
  const n2 = {
    kasvukoht: max.kasvukoht * J.kasvukoht.find((r) => r[0] === "pohla")[1] / 100,
    muld: mullaP(J.loimis.find((r) => r[0] === "saviliiv")[1], J.muld_niiskus.find((r) => r[0] === "nõrgalt gleistunud")[1], 100),
    mikroniiskus: max.mikroniiskus * kohal(J.twi, 8) / 100,
    okotoon: max.okotoon * kohal(J.okotoon, 300) / 100,
    sidusus: max.sidusus * kohal(J.sidusus, 90) / 100,
    tihedus: max.tihedus * kohal(J.tihedus, 95) / 100,
  };
  const nSumma = Object.values(n2).reduce((a, b) => a + b, 0);
  const nPuu = Math.min(1, (0.6 * puuMA + 0.4 * puuKU) / 100 + J.segu_boonus / 100) ** J.piiravad.puuliik;
  const nKord = nPuu * kohal(J.vanus, 55) / 100 * kohal(J.valgus, 95) / 100;
  const nKoht = nSumma / 100 * nKord, nAeg = 0.6;

  return `
  <div class="valemikast">
    <div><span class="vk">Metsa punktid</span> <small>0–100</small> × <span class="vk">Kordajad</span> <small>0–1</small> = <span class="vk">Koht</span></div>
    <div><span class="vk">Koht</span> × <span class="vk">Aeg</span> <small>0–100%</small> = <span class="vk hinne">Hinne</span></div>
  </div>
  <p><b>Kaardi värv</b> tuleb kahest astmest: kui hea on mets ja kui hea on seeneaeg. Nii ei muuda väike päevane kõikumine värvi – värv jääb samaks, kuni seeneaeg päriselt muutub. Kaks tumedaimat klassi (tippkoht ja suurepärane) vajavad ühes neist ülimat ja teises vähemalt järgmist astet.</p>
  ${maatriks}
  <p class="vaike">„Head metsad“ režiimis on värv ainult metsa järgi: suurepärane / väga hea / hea / keskmine.</p>
  ${osa("Mille järgi läved on valitud", laved())}

  <h3>1. Metsa punktid – kokku 100</h3>
  <p>Iga kategooria annab kuni oma maksimumi. Punktid liidetakse.</p>
  <ul class="giid-kaalud">${ylevaade}</ul>
  ${osa(`Metsatüüp – kuni ${max.kasvukoht} p`, `${tabel(J.kasvukoht.map(([n, y]) => [n, p("kasvukoht")(y)]), ["kasvukohatüüp", "punkte"])}<p class="vaike">Kõige parem üksiknäitaja: võtab kokku mulla niiskuse, viljakuse ja alustaimestiku. Liiga viljakas (naadi, angervaksa) – lopsakas rohustu; liiga kuiv (sambliku) – porosamblik ja kõrvetav päike.</p>`)}
  ${osa(`Muld – kuni ${max.muld} p`, `${tabel([
      ["liiv, kuiv, happeline", pk(mullaP(100, 100, 100))],
      ["saviliiv, nõrgalt gleistunud", pk(mullaP(90, 90, 100))],
      ["saviliiv, gleistunud", pk(mullaP(90, 75, 100))],
      ["liivsavi, gleimuld (märg)", pk(mullaP(65, 35, 85))],
      ["savi, lubjarikas", pk(mullaP(35, 100, 60))],
      ["turvasmuld", pk(mullaP(30, 10, 100))]], ["muld (näited)", "punkte"])}
    <p class="vaike">Mulla punktid tulevad kolmest omadusest: liigniiskus (kaalub kõige rohkem), lõimis (liiv parim, savi halvim) ja happesus (happeline parim, lubjarikas ja paekivine halvem). Allikas: Maa- ja Ruumiameti mullakaart.</p>`)}
  ${osa(`Maastiku niiskus – kuni ${max.mikroniiskus} p`, `${tabel(kover(J.twi, "", p("mikroniiskus")), ["märgumisindeks (TWI)", "punkte"])}<p class="vaike">TWI näitab kõrgusmudeli järgi, kuhu vesi koguneb: väike = seljak, kuivab kiiresti; suur = lohk või kraav, seisev vesi lämmatab seeneniidistiku. Parim on parasniiske nõlv.</p>`)}
  ${osa(`Soo serv (ökotoon) – kuni ${max.okotoon} p`, `${tabel(kover(J.okotoon, " m", p("okotoon")), ["kaugus soost/rabast", "punkte"])}<p class="vaike">Mineraalmullal mets soo või raba lähedal: puu juured saavad hapnikku, soo hoiab öise udu ja õhuniiskuse – seened ei kuiva.</p>`)}
  ${osa(`Metsamassiiv – kuni ${max.sidusus} p`, `${tabel(kover(J.sidusus, "%", p("sidusus")), [`metsa osakaal ${J.sidusus_raadius} m ümbruses`, "punkte"])}<p class="vaike">Suur katkematu mets hoiab mikrokliimat; väike tukk põllu või tee ääres kuivab kiiresti.</p>`)}
  ${osa(`Võra tihedus – kuni ${max.tihedus} p`, `${tabel(kover(J.tihedus, "%", p("tihedus")), ["võrastiku katvus", "punkte"])}<p class="vaike">Kõige parem on täpiline valgus. Kottpime kuusik saab vähem.</p>`)}

  <h3>2. Kordajad – korrutavad metsa punkte</h3>
  <p>Kukeseen elab ainult koos elava puuga. Kordaja ×1,00 ei muuda midagi, ×0,50 poolitab, ×0 nullib – olgu muld kui tahes hea.</p>
  ${osa("Puuliigid", `${tabel(J.puuliik.map(([n, y]) => [`puhas ${n}`, x(100 * (y / 100) ** J.piiravad.puuliik)]), ["puistu", "kordaja"])}
    <p class="vaike"><b>Parim on männi enamusega segamets</b>, kus kasvab hajusalt kuuske või kaske (×1,00): kui kaks sobivat liiki on kumbki vähemalt ${J.segu_min}%, tuleb boonus. Liigid kaalutakse osakaaluga; alumine rinne läheb arvesse ${Math.round(J.teine_rinne * 100)}% kaaluga.</p>`)}
  ${osa("Puistu vanus", `${tabel(kover(J.vanus, " a", x), ["vanus", "kordaja"])}<p class="vaike">Noored puud kulutavad süsiniku oma kasvule; seeneniidistik vajab aastakümneid, et muutuda viljakaks.</p>`)}
  ${osa("Valgus (võrastik olemas)", `${tabel(kover(J.valgus, "%", x), ["võrastiku katvus", "kordaja"])}<p class="vaike">Katvus = kui suur osa maast on üle 5 m kõrguste puude all (lidar). Raiesmik ja lage maa ≈ 0.</p>`)}

  <h3>3. Aeg – kui palju seeni praegu metsas on</h3>
  <p>Aeg (0–100%) tuleb ilmast. Uued seened tekivad, kui kolm tingimust on korraga täidetud; korjatavaks saavad nad 1–3 nädala pärast ja püsivad umbes kaks nädalat.</p>
  ${osa("Mulla niiskus", `<p>Iga päev arvutatakse mulla veevaru: vihm miinus aurumine. Sama vihm mõjub eri metsades erinevalt, sest „veeämber“ on eri suurusega: ${Object.values(A.reziim).map((r) => `${r.nimi} ${r.kp} mm`).join(", ")}.</p>${tabel(kover(A.niiskus.map(([xx, y]) => [Math.round(xx * 100), y]), "%", (y) => y + "%"), ["veevaru täidetus", "tingimus täidetud"])}`)}
  ${osa("Hooaeg", `<p>Hooaja valmidus ütleb, kas seeneniidistik on valmis vilju kandma. Kraadipäevad (päeva keskmise temperatuuri osa üle ${nr(A.kp_alus)} °C, kokku alates 1. jaanuarist) määravad ainult <b>hooaja alguse</b>: enne ~${A.hooaeg_kp[1][0]} kraadipäeva (juuni lõpp) seeni ei teki, ~${A.hooaeg_kp.at(-1)[0]} juures (juuli keskpaik) on hooaeg täies jõus ja edasi soojus enam ei kogune. Teine pool on 6–13 nädala tagune niiskus: kuiva kevad-suvega jääb seeneniidistik nõrgemaks.</p>${tabel(kover(A.hooaeg_kp, "", (y) => y + "%"), ["kraadipäevi", "tingimus täidetud"])}`)}
  ${osa("Soojus", `${tabel(kover(A.algus_temp, " °C", (y) => y + "%"), [`õhu temperatuur (${A.algus_temp_aken} p keskmine)`, "tingimus täidetud"])}${tabel(kover(A.mulla_temp, " °C", (y) => y + "%"), ["mulla temperatuur", "tingimus täidetud"])}<p class="vaike">Arvesse läheb mitme päeva keskmine, mitte üks päev. Mulla soojus sõltub metsast: ${Object.values(A.reziim).map((r) => `${r.nimi} ${r.mulla_aken} p keskmine${r.soojus ? `, ${r.soojus > 0 ? "+" : "−"}${nr(Math.abs(r.soojus * 10))} °C iga 10 °C õhusooja kohta üle ${nr(A.soojus_alus)} °C` : ""}`).join("; ")}. Kuiv liivamännik soojeneb päikese käes kiiresti ja hooaeg algab seal varem; märg ja varjuline mets soojeneb aeglaselt. Sügisel jaheneva mullaga uusi seeni enam ei teki – nii lõpeb hooaeg.</p>`)}
  ${osa("Viivitus ja säilimine", `<ul class="giid-loend"><li>Seened on korjatavad ${A.viivitus_kp} kraadipäeva (üle ${nr(A.viivitus_alus)} °C) pärast vihma: soojaga ~12 päeva, jahedaga ~4 nädalat.</li><li>Valmis seentest kaob iga päev ~${A.elu}%, jahedaga ~${A.elu_jahe}%, öökülmaga pooled.</li><li>Korjatavaks loetakse ainult kuni ${A.korjatav_vanus} päeva vanad seened. Jahedaga vananevad need ${nr(A.vananemine_jahe)} korda ja öökülmaga ${nr(A.vananemine_kulm)} korda kiiremini – sügisel on vanad seened läbivettinud ja pehmed.</li><li>Seetõttu määrab ka 3 päeva prognoosi peamiselt juba möödunud ilm.</li></ul>`)}

  <h3>Näide</h3>
  <div class="naide">
    <p>Pohla kasvukoht, saviliiv, männik 6 osa mändi + 4 osa kuuske, 55 a, 300 m soost, suur mets:</p>
    <table><tbody>
      ${Object.entries(n2).map(([nn, v]) => `<tr><td>${TEGUR_NIMI[nn]}</td><td>${pk(v)}/${max[nn]}</td></tr>`).join("")}
      <tr class="summa"><td>Metsa punktid</td><td>${pk(nSumma)}/100</td></tr>
      <tr><td>Kordajad: puud ${kord(nPuu)} · vanus ×1,00 · valgus ×1,00</td><td>${kord(nKord)}</td></tr>
      <tr class="summa"><td>Koht = ${pk(nSumma)} × ${kord(nKord).slice(1)}</td><td>${hinne(nKoht)}</td></tr>
      <tr><td>Aeg (hea seeneaeg)</td><td>${hinne(nAeg)}%</td></tr>
      <tr class="summa"><td>Hinne = ${hinne(nKoht)} × ${nr(nAeg)}</td><td>${hinne(nKoht * nAeg)}</td></tr>
    </tbody></table>
  </div>

  <p class="markus">Kõik numbrid on ekspertteadmistel põhinevad hüpoteesid. Mudelit ei ole veel päris leidudega kontrollitud.</p>`;
}

// how the class bounds were chosen, with shares computed from the data on the page
function laved() {
  const A = olek.meta.astmed, v = olek.vilj;
  let mets = A.koht.map(() => 0), rakke = 0;
  // counted at export for every sheet
  for (const G of olek.lehed) { rakke += G.rakke; mets = mets.map((m, j) => m + G.koht_astmed[j]); }
  // mushroom time: fresh forest at the middle weather point, July-September
  const p = Math.floor(v.ilmapunktid.length / 2), j2 = olek.klassid.indexOf(2), fi = F("indeks");
  const aeg = A.aeg.map(() => 0), aastad = new Set();
  let paevi = 0;
  v.kuupaevad.forEach((d, di) => {
    const kuu = +d.slice(5, 7);
    if (kuu < 7 || kuu > 9) return;
    paevi++;
    aastad.add(d.slice(0, 4));
    const x = T(di, p, j2, fi);
    A.aeg.forEach((b, jj) => { if (x >= b) aeg[jj]++; });
  });
  const pr = (a, b) => `${Math.round(a / b * 100)}%`;
  const ay = [...aastad].sort();
  return `<p><b>Läved ei ole mõõdetud tõenäosused.</b> Mudelit pole veel piisavalt leidudega kontrollitud, et öelda „tippkoht = nii mitu protsenti tõenäosusega seeni“. Läved on valitud nii, et kaart saadaks inimesed vähestesse, tõeliselt headesse kohtadesse.</p>
    ${tabel(ASTE_KOHT.map((n, j) => [`Mets ${n} (Koht ${Math.round(A.koht[j] * 100)}+)`, `parim ${pr(mets[j], rakke)}`]), ["metsa aste", "osa kaardi metsast"])}
    <p class="vaike">Metsa astmed on seatud testala metsa jaotuse järgi, siin kogu Eesti metsa kohta: „${ASTE_KOHT[0]}“ on ainult parim ${pr(mets[0], rakke)}, „${ASTE_KOHT[1]}“ parim ${pr(mets[1], rakke)}.</p>
    ${tabel(ASTE_AEG.map((n, jj) => [`Seeneaeg ${n} (Aeg ${Math.round(A.aeg[jj] * 100)}%+)`, pr(aeg[jj], paevi)]), ["seeneaja aste", `osa juuli–septembri päevadest ${ay[0]}–${ay.at(-1)}`])}
    <p class="vaike">Seeneaja indeks on skaleeritud nii, et tavalise hea hooaja tipp on umbes 75%. „Väga hea“ (70%+) on hea hooaja tipp, „hea“ (50%+) umbes kaks kolmandikku sellest.</p>
    <p class="vaike">Päris tõenäosuseks saab hinde muuta alles siis, kui leide ja tühje käike on palju – siis saab kontrollida, kui tihti tumedal alal tegelikult seeni leitakse.</p>`;
}

// the data the map is made of: one row per dataset, what is taken from it and what it is used for
const ANDMED = [
  { nimi: "Metsaregister", allikas: "Keskkonnaagentuur", link: "https://www.keskkonnaagentuur.ee/metsaregister", litsents: "CC BY 4.0", seis: "seis 10.2026",
    andmed: "Metsaeraldiste piirid; puuliigid ja nende osakaal rinde kaupa; puistu vanus; kasvukohatüüp; kuivendatus",
    milleks: "Puuliigid (peremeespuu), puistu vanus, metsatüüp, metsa veerežiim (kuiv … märg) ja soode asukoht (soo serv). Mets, mille kohta registris andmeid pole, jääb kaardilt välja." },
  { nimi: "Mullakaart 1 : 10 000", allikas: "Maa- ja Ruumiamet", link: "https://geoportaal.maaruum.ee", litsents: "avaandmed",
    andmed: "Mullaliik ja selle osakaal mullakompleksis; lõimis (liiv … savi, turvas); karbonaatsus ja kivisus",
    milleks: "Muld: kui hästi vesi ära voolab ja kui happeline muld on. Turvasmullad annavad soo serva." },
  { nimi: "Maapinna kõrgusmudel", allikas: "Maa- ja Ruumiamet", link: "https://geoportaal.maaruum.ee", litsents: "avaandmed", seis: "5 m (testalal 1 m)",
    andmed: "Maapinna kõrgus",
    milleks: "Maastiku niiskus: kas koht on seljak, nõlv või lohk, kuhu vesi koguneb." },
  { nimi: "Võrastiku kõrgusmudel (lidar)", allikas: "Maa- ja Ruumiamet", link: "https://geoportaal.maaruum.ee", litsents: "avaandmed", seis: "lennud 2020–2023",
    andmed: "Puude ja põõsaste kõrgus maapinnast",
    milleks: "Valgus (kas võrastik on olemas), võra tihedus ja metsamassiiv (kui suur osa 300 m ümbrusest on mets)." },
  { nimi: "ERA5-Land", allikas: "Copernicus / ECMWF (Open-Meteo kaudu)", link: "https://open-meteo.com", litsents: "CC BY 4.0", seis: "u 11 × 6 km, ~5 p viivitusega",
    andmed: "Õhu keskmine ja miinimumtemperatuur; pinnase temperatuur",
    milleks: "Seeneaeg: suve soojus (kraadipäevad), uute seente tekkeks piisav õhu- ja mullasoojus, küpsemise kiirus, öökülm ja jahedusega kiirem vananemine." },
  { nimi: "ERA5", allikas: "Copernicus / ECMWF (Open-Meteo kaudu)", link: "https://open-meteo.com", litsents: "CC BY 4.0", seis: "u 28 × 15 km",
    andmed: "Sademed; potentsiaalne aurumine (ET0); suvede 2016–2025 keskmised",
    milleks: "Iga metsatüübi mullavee varu ja kevad-suve niiskus. Kümne suve keskmise järgi viiakse iga koha ilm testala kliimasse – kuivema kliimaga paik ei jää kaardilt välja." },
  { nimi: "Ilmaprognoos", allikas: "Open-Meteo (riiklike ilmateenistuste mudelid)", link: "https://open-meteo.com", litsents: "CC BY 4.0", seis: "viimased 14 p ja 10 p ette",
    andmed: "Sama mis ERA5 ja ERA5-Land: temperatuur, sademed, aurumine, mulla temperatuur",
    milleks: "Viimaste päevade ilm (ERA5 jõuab kohale ~5 päevaga) ja prognoos ajateljel." },
  { nimi: "Aluskaardid", allikas: "OpenStreetMap / OpenFreeMap, OpenTopoMap, Maa- ja Ruumiamet", link: "https://www.openstreetmap.org/copyright", litsents: "ODbL, CC BY-SA, avaandmed",
    andmed: "Teed, rajad, asulad, kõrgusjooned, ortofoto",
    milleks: "Ainult taust orienteerumiseks – hinnet ei mõjuta." },
];

function andmedHtml() {
  const v = olek.vilj, kp = (d) => d ? `${+d.slice(8)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "–";
  const moot = v.kuupaevad[v.paeva_allikas.lastIndexOf("era5")], lopp = v.kuupaevad.at(-1);
  return `<p>Kaart on arvutatud avalikest andmetest. Iga andmestiku kohta: mida sealt võtame ja milleks.</p>
    <table class="andmed-tabel"><thead><tr><th>Andmestik</th><th>Mida võtame</th><th>Milleks</th></tr></thead><tbody>
    ${ANDMED.map((a) => `<tr><td><b>${a.nimi}</b><small><a href="${a.link}" target="_blank" rel="noopener">${a.allikas}</a> · ${a.litsents}${a.seis ? ` · ${a.seis}` : ""}</small></td><td>${a.andmed}</td><td>${a.milleks}</td></tr>`).join("")}
    </tbody></table>
    <p class="vaike">Ilm: mõõdetud (ERA5) kuni <b>${kp(moot)}</b>, edasi mudelianalüüs ja prognoos kuni <b>${kp(lopp)}</b>. Metsa andmed uuenevad 1–2 korda aastas.</p>
    <p class="vaike">Hinne on mudeli hinnang, mitte lubadus: kaart ei tea raietest pärast registri viimast uuendust ega seda, kas mets on era- või kaitseala. Metsas liikudes kehtivad igaüheõigus ja kaitsealade reeglid.</p>
    <p class="vaike">Sisaldab muudetud Copernicuse kliimamuutuste teenistuse teavet (ERA5, ERA5-Land). Ilm: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0). Metsaregister © Keskkonnaagentuur (CC BY 4.0). Mullakaart ja kõrgusandmed © Maa- ja Ruumiamet.</p>`;
}

// the guide has two pages: how the score is made, and the data it is made of
const GIID_LEHED = { hinne: "Kuidas hinne tekib", andmed: "Andmed ja allikad" };
function avaGiid(leht = olek.giidLeht || "hinne") {
  olek.giidLeht = GIID_LEHED[leht] ? leht : "hinne";
  const sisu = document.getElementById("giid-sisu");
  document.getElementById("giid-pealkiri").textContent = GIID_LEHED[olek.giidLeht];
  if (window.HYYF) {
    const valik = `<div class="segment vaade-valik giid-valik" role="group" aria-label="Juhendi leht">${Object.entries(GIID_LEHED)
      .map(([k, nimi]) => `<button data-leht="${k}"${k === olek.giidLeht ? ' class="aktiivne"' : ""}>${k === "andmed" ? "Andmed" : nimi}</button>`).join("")}</div>`;
    sisu.innerHTML = valik + (olek.giidLeht === "andmed" ? andmedHtml() : giidHtml());
    sisu.querySelectorAll(".giid-valik button").forEach((b) => b.onclick = () => { avaGiid(b.dataset.leht); document.getElementById("giid").scrollTop = 0; });
  }
  if (!document.getElementById("giid").open) document.getElementById("giid").showModal();
}

// ---------- what a chanterelle needs (logo click) ----------
const SEEN_IKOON = {
  puu: '<svg viewBox="0 0 24 24"><path d="M12 3l-5 7h3l-4 6h12l-4-6h3z"/><path d="M12 16v5"/></svg>',
  muld: '<svg viewBox="0 0 24 24"><path d="M3 14h18M3 18h18"/><path d="M7 14c0-3 2-5 5-5s5 2 5 5"/><path d="M12 9V5"/></svg>',
  vihm: '<svg viewBox="0 0 24 24"><path d="M7 15a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5A3.5 3.5 0 0 1 17 15z"/><path d="M9 19l-1 2M13 19l-1 2M17 19l-1 2"/></svg>',
  paike: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></svg>',
  kalender: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
};
const KUUD_HOOAEG = [["mai", 0], ["juuni", 1], ["juuli", 2], ["aug", 3], ["sept", 3], ["okt", 2], ["nov", 0]];

// short text, one paragraph per need; the season as bars by month
function avaSeeninfo() {
  const kuud = `<div class="si-kuud">${KUUD_HOOAEG.map(([k, t]) => `<div><span class="si-tulp t${t}"></span><small>${k}</small></div>`).join("")}</div>`;
  document.getElementById("seeninfo-sisu").innerHTML = `
    <p class="si-sissejuhatus">Kukeseen ei kasva üksi: tema seeneniidistik elab koos puu juurtega ja vahetab puuga toitaineid. Seen saab puult suhkrut, puu seenelt vett ja mineraale. Seepärast leiab kukeseeni ainult elavate puude alt.</p>
    <ul class="si-read">
      <li>${SEEN_IKOON.puu}<div><b>Puu</b><span>Kõige sagedamini mänd, ka kuusk ja kask. Parim on keskealine või vanem mets – noorel metsal pole seeneniidistik veel välja kujunenud.</span></div></li>
      <li>${SEEN_IKOON.muld}<div><b>Muld</b><span>Vaene, happeline ja hästi kuivendatud: liiv või saviliiv, sammal maas. Lopsakas rohi, väetatud või lubjarikas maa ja seisev vesi ei sobi.</span></div></li>
      <li>${SEEN_IKOON.paike}<div><b>Valgus</b><span>Hõre või keskmine mets, kus päike paistab laiguti maani. Kottpimedas kuusikus ja lagedal raiesmikul on seeni vähe.</span></div></li>
      <li>${SEEN_IKOON.vihm}<div><b>Soe suvi ja vihm</b><span>Seeneniidistik vajab sooja suve ja niisket mulda. Pärast korralikku vihma tulevad seened 1–3 nädalaga – jahedaga kauem.</span></div></li>
      <li>${SEEN_IKOON.kalender}<div><b>Hooaeg</b><span>Juulist oktoobrini, kõige rohkem augustis ja septembris. Seened kasvavad aeglaselt ja püsivad metsas nädalaid.</span>${kuud}</div></li>
    </ul>`;
  document.getElementById("seeninfo").showModal();
}

// ---------- map ----------

// Basemaps: OpenFreeMap "Liberty" (natural vector map, OpenStreetMap data) by default; OpenTopoMap
// (contours and forest tracks), Maa- ja Ruumiamet orthophoto and Estonian map as rasters. Raster
// basemaps and the mushroom layer sit under the vector labels, so place names stay readable.
const ALUS_STIIL = "https://tiles.openfreemap.org/styles/liberty";
const RASTRID = {
  topo: { tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"], maxzoom: 17,
          attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)', omad_sildid: true },
  foto: { tiles: [`${MAA}/foto@GMC/{z}/{x}/{y}.jpg`], scheme: "tms", maxzoom: 18,
          attribution: '© <a href="https://maaruum.ee">Maa- ja Ruumiamet</a>', omad_sildid: false },
  kaart: { tiles: [`${MAA}/kaart@GMC/{z}/{x}/{y}.png`], scheme: "tms", maxzoom: 18,
           attribution: '© <a href="https://maaruum.ee">Maa- ja Ruumiamet</a>', omad_sildid: true },
};

function lisaAluskaardid() {
  olek.siltideAlt = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  for (const [id, r] of Object.entries(RASTRID)) {
    map.addSource(id, { type: "raster", tileSize: 256, tiles: r.tiles, maxzoom: r.maxzoom, attribution: r.attribution,
                        ...(r.scheme ? { scheme: r.scheme } : {}) });
    map.addLayer({ id, type: "raster", source: id, layout: { visibility: "none" } }, olek.siltideAlt);
  }
}

// TEMPORARY: colour or strength changed
function valiVaade(k, v) {
  seaVaade({ varv: olek.varv, tugevus: olek.tugevus, [k]: v });
  try { localStorage.setItem("hyyf-vaade", JSON.stringify({ varv: olek.varv, tugevus: olek.tugevus })); } catch (e) { /* private mode */ }
  document.querySelectorAll("#variandid button").forEach((b) => b.classList.toggle("aktiivne", olek[b.dataset.k] === b.dataset.v));
  if (olek.vilj) joonista();
}

function valiAluskaart(id) {
  for (const r of Object.keys(RASTRID)) map.setLayoutProperty(r, "visibility", r === id ? "visible" : "none");
  // rasters with their own labels (topo, Estonian map): hide the vector ones to avoid doubles
  const peida = RASTRID[id]?.omad_sildid;
  for (const l of map.getStyle().layers) {
    if (l.type === "symbol") map.setLayoutProperty(l.id, "visibility", peida ? "none" : "visible");
  }
}

function valiKuupaev(i) {
  olek.paev = olek.p0 = Math.max(0, Math.min(olek.vilj.kuupaevad.length - 1, i));
  joonista();
}

const map = new maplibregl.Map({ container: "kaart", style: ALUS_STIIL, center: [27.147, 58.197], zoom: 11.5, maxZoom: 17,
                                  attributionControl: { compact: true } });
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "bottom-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
// attribution starts collapsed to its (i) button, so it does not cover the map on phones
map.once("load", () => document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));

// keep the study area clear of the floating cards
function vaba() {
  const telefon = innerWidth <= 760;
  return telefon ? { top: 70, right: 20, bottom: 220, left: 20 } : { top: 80, right: 300, bottom: 200, left: 40 };
}

// data of all of Estonia from andmed/eesti (from disk as their .js copies); only wait for the
// style, not for all basemap tiles ("load")
map.once("style.load", async () => {
  lisaAluskaardid();
  const kv = document.getElementById("kokkuvote");
  try {
    kv.textContent = "Laen andmeid…";
    await laeEesti();
  } catch (e) {
    kv.textContent = `Andmeid ei saanud laadida (${e.message}).`;
    return;
  }
  const kp = document.getElementById("kuupaev");
  kp.min = olek.vilj.kuupaevad[0];
  kp.max = olek.vilj.kuupaevad.at(-1);
  const m = olek.meta;
  map.fitBounds([m.nurgad[3], m.nurgad[1]], { padding: vaba(), duration: 0 });
  // open on today if the data covers it, otherwise on the last measured day
  const tana = olek.vilj.kuupaevad.indexOf(olek.vilj.tana);
  const viimaneMoot = olek.vilj.paeva_allikas.lastIndexOf("analuus");
  valiKuupaev(tana >= 0 ? tana : Math.max(viimaneMoot, olek.vilj.kuupaevad.length - 4));
});

// the view decides the sheets, the summary and the best spots
map.on("moveend", () => olek.versioon && uuendaKaart());
map.on("mousemove", (e) => {
  if (!olek.vilj) return;
  map.getCanvas().style.cursor = rakkNahtav(e.lngLat.lng, e.lngLat.lat) ? "pointer" : "";
});
map.on("click", (e) => olek.vilj && naitaSelgitust(e.lngLat));

document.getElementById("kuupaev").addEventListener("change", (e) => {
  if (!olek.vilj) return;
  const i = olek.vilj.kuupaevad.indexOf(e.target.value);
  if (i >= 0) valiKuupaev(i);
  else e.target.value = olek.vilj.kuupaevad[olek.paev];  // outside the season: snap back
});
document.querySelectorAll("#reziim button").forEach((b) => b.onclick = () => {
  if (b.dataset.reziim === "peidus") { lulitaKiht(false); return; }
  const muutus = b.dataset.reziim !== olek.reziim;
  olek.reziim = b.dataset.reziim;
  lulitaKiht(true);
  if (muutus) { peidaSelgitus(); if (olek.vilj) joonista(); }
});
document.querySelectorAll("#aluskaart button[data-kiht]").forEach((b) => b.onclick = () => {
  document.querySelectorAll("#aluskaart button[data-kiht]").forEach((x) => x.classList.toggle("aktiivne", x === b));
  valiAluskaart(b.dataset.kiht);
});
// basemap menu: opens under its round button, closes on choice or outside click
const aluskaartNupp = document.getElementById("aluskaart-nupp"), aluskaartMenyy = document.getElementById("aluskaart");
aluskaartNupp.onclick = (e) => {
  e.stopPropagation();
  aluskaartMenyy.hidden = !aluskaartMenyy.hidden;
  aluskaartNupp.setAttribute("aria-expanded", String(!aluskaartMenyy.hidden));
};
aluskaartMenyy.addEventListener("click", () => { aluskaartMenyy.hidden = true; aluskaartNupp.setAttribute("aria-expanded", "false"); });
document.addEventListener("click", (e) => {
  if (!aluskaartMenyy.hidden && !e.target.closest(".menyy-hoidja")) { aluskaartMenyy.hidden = true; aluskaartNupp.setAttribute("aria-expanded", "false"); }
});
document.getElementById("giid-nupp").onclick = () => avaGiid();
// TEMPORARY: look variant switch
document.getElementById("variandid").innerHTML = Object.entries(VALIK).map(([k, valikud]) =>
  `<div class="segment">${Object.entries(valikud).map(([v, nimi]) =>
    `<button data-k="${k}" data-v="${v}"${olek[k] === v ? ' class="aktiivne"' : ""}>${nimi}</button>`).join("")}</div>`).join("");
document.querySelectorAll("#variandid button").forEach((b) => b.onclick = () => valiVaade(b.dataset.k, b.dataset.v));
document.getElementById("brand").onclick = () => avaSeeninfo();
document.getElementById("seeninfo-sulge").onclick = () => document.getElementById("seeninfo").close();
document.getElementById("seeninfo").addEventListener("click", (e) => {
  if (e.target.id === "seeninfo") e.target.close();   // click on the backdrop
});
document.getElementById("giid-sulge").onclick = () => document.getElementById("giid").close();
document.getElementById("giid").addEventListener("click", (e) => {
  if (e.target.id === "giid") e.target.close();   // click on the backdrop
});
document.getElementById("sahtel-sulge").onclick = peidaSelgitus;
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.getElementById("giid").open) peidaSelgitus();
});
document.getElementById("parimad-pea").onclick = (e) => {
  const kaart = document.getElementById("parimad-kaart");
  const kinni = kaart.classList.toggle("kinni");
  e.currentTarget.setAttribute("aria-expanded", String(!kinni));
};
// phones: best spots start collapsed so the map stays visible
if (innerWidth <= 760) document.getElementById("parimad-pea").click();
