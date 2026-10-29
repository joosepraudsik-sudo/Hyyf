// Siil – browser side.
// "Kus täna otsida": value = sum_c fruiting_index(point, class, day) * S_c(cell)
// "Head metsad":     value = sum_c S_c(cell)  (site suitability in the 100 m neighbourhood)
"use strict";

const MAA = "https://tiles.maaamet.ee/tm/tms/1.0.0";

// Display classes per mode: [label, colour]. A class comes from two steps, forest and mushroom
// time (bounds in meta.astmed, from parameetrid.py), so small daily changes do not repaint the map.
// Chanterelle tones, dark to light (OKLab L 0.47 / 0.69 / 0.86): they stand out on green forest and
// on the orthophoto, and the lightness steps keep them apart for colour-blind users.
const KLASSID = {
  tana: [["Parim koht", "#9a3412"], ["Hea koht", "#ea7a0c"], ["Võimalik", "#f6cf3c"]],
  koht: [["Väga hea mets", "#9a3412"], ["Hea mets", "#ea7a0c"], ["Keskmine mets", "#f6cf3c"]],
};
const ASTE_KOHT = ["väga hea", "hea", "keskmine"];
const ASTE_AEG = ["hea", "keskmine", "vähe"];
// layer strength: strong when zoomed out, lighter up close so paths and tracks show through
const KIHI_TUGEVUS = ["interpolate", ["linear"], ["zoom"], 11, 0.75, 14, 0.5, 16, 0.4];
const NADALAPAEV = ["P", "E", "T", "K", "N", "R", "L"];
const NADALAPAEV_PIKK = ["pühapäev", "esmaspäev", "teisipäev", "kolmapäev", "neljapäev", "reede", "laupäev"];
const AJATELG_TAGASI = 7, AJATELG_EDASI = 10;   // days shown before and after the window anchor
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

const olek = { reziim: "tana", paev: 0, p0: 0, markerid: [], kihtNahtav: true };
const canvas = document.createElement("canvas");

// ---------- data ----------

function lae() {
  const S = window.SIIL;
  const meta = S.meta;
  const rakud = Uint8Array.from(atob(S.rakud), (c) => c.charCodeAt(0));
  const n = meta.laius * meta.korgus;
  const kiht = {};
  meta.kihid.forEach((k, i) => (kiht[k] = rakud.subarray(i * n, (i + 1) * n)));
  const v = S.viljumine;
  const aeg = Uint8Array.from(atob(v.andmed), (c) => c.charCodeAt(0));
  // "today" is the viewer's date when the data covers it, not the day the data was exported
  const kohalik = new Date().toLocaleDateString("sv-SE");
  if (v.kuupaevad.includes(kohalik)) v.tana = kohalik;
  Object.assign(olek, { meta, n, kiht, vilj: v, aeg, eraldised: S.eraldised, mullad: S.mullad,
                        klassid: Object.keys(meta.klassid).map(Number) });
}

// time component f (index into valjad) for day d, point p, class position j, 0..1
function T(d, p, j, f) {
  const { vilj, aeg } = olek;
  const P = vilj.ilmapunktid.length, K = vilj.klassid.length, F = vilj.valjad.length;
  return aeg[((d * P + p) * K + j) * F + f] / 255;
}
const F = (nimi) => olek.vilj.valjad.indexOf(nimi);

function kohaSobivus(i) {
  return olek.klassid.reduce((s, c) => s + olek.kiht["S" + c][i], 0) / 255;
}

// [Koht, Aeg] of a cell: Koht = neighbourhood suitability, Aeg = suitability-weighted fruiting index
function hinnang(i, d = olek.paev) {
  const p = olek.kiht.ilmapunkt[i];
  if (p === 255) return null;
  const koht = kohaSobivus(i);
  if (koht <= 0) return [0, 0];
  const fi = F("indeks");
  const kaal = olek.klassid.reduce((s, c, j) => s + T(d, p, j, fi) * olek.kiht["S" + c][i] / 255, 0);
  return [koht, kaal / koht];
}

function vaartus(i, d = olek.paev) {
  const h = hinnang(i, d);
  if (!h) return null;
  return olek.reziim === "koht" ? h[0] : h[0] * h[1];
}

const aste = (x, piirid) => piirid.findIndex((piir) => x >= piir);

// class index 0 green, 1 orange, 2 yellow, -1 none
function klassKA(koht, aeg) {
  const A = olek.meta.astmed;
  const k = aste(koht, A.koht);
  if (olek.reziim === "koht") return k;
  const a = aste(aeg, A.aeg);
  return k < 0 || a < 0 || k + a > 2 ? -1 : k + a;
}

// ---------- map drawing ----------

function joonista() {
  const { meta, n } = olek;
  canvas.width = meta.laius;
  canvas.height = meta.korgus;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(meta.laius, meta.korgus);
  const varvid = KLASSID[olek.reziim].map(([, c]) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16)));
  const kl = new Int8Array(n).fill(-1);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const h = hinnang(i);
    if (h === null) continue;
    v[i] = olek.reziim === "koht" ? h[0] : h[0] * h[1];
    kl[i] = klassKA(h[0], h[1]);
    if (kl[i] >= 0) img.data.set([...varvid[kl[i]], 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL();
  if (map.getSource("hinnang")) uuendaPilt(url);
  else {
    map.addSource("hinnang", { type: "image", url, coordinates: meta.nurgad });
    map.addLayer({ id: "hinnang", type: "raster", source: "hinnang",
                   layout: { visibility: olek.kihtNahtav ? "visible" : "none" },
                   paint: { "raster-opacity": KIHI_TUGEVUS, "raster-resampling": "nearest", "raster-fade-duration": 0 } },
                 olek.siltideAlt);
  }
  const kohad = parimadKohad(v, kl);
  uuendaPaneel(kl, kohad);
  uuendaMarkerid(kohad);
}

// one image load at a time: a new updateImage while the previous one is still decoding aborts it
// (AbortError in the console), so keep only the latest pending frame and send it when done
const pilt = { laeb: false, ootel: null };
function uuendaPilt(url) {
  if (pilt.laeb) { pilt.ootel = url; return; }
  pilt.laeb = true;
  map.getSource("hinnang").updateImage({ url, coordinates: olek.meta.nurgad });
  const valmis = () => {
    clearTimeout(pilt.taimer);
    map.off("sourcedata", kuula);
    pilt.laeb = false;
    if (pilt.ootel) { const u = pilt.ootel; pilt.ootel = null; uuendaPilt(u); }
  };
  const kuula = (e) => { if (e.sourceId === "hinnang" && map.isSourceLoaded("hinnang")) valmis(); };
  map.on("sourcedata", kuula);
  pilt.taimer = setTimeout(valmis, 1500);   // safety net if the event never comes
}

// best spots: highest cells of class "hea" or better, at least VAHE apart; each with the area
// of good forest within YMBER cells around it (a point to walk to, not one giant blob)
function parimadKohad(v, kl) {
  const { laius: W } = olek.meta;
  const vahe = Math.round(PARIM_VAHE_M / olek.meta.ruut_m), ymber = Math.round(PARIM_YMBER_M / olek.meta.ruut_m);
  const kandidaadid = [];
  for (let i = 0; i < kl.length; i++) if (kl[i] >= 0 && kl[i] <= 1) kandidaadid.push(i);
  kandidaadid.sort((a, b) => v[b] - v[a]);
  const valitud = [];
  for (const i of kandidaadid) {
    const x = i % W, y = (i / W) | 0;
    if (valitud.some((k) => (k.x - x) ** 2 + (k.y - y) ** 2 < vahe * vahe)) continue;
    let rakke = 0;
    for (let dy = -ymber; dy <= ymber; dy++) for (let dx = -ymber; dx <= ymber; dx++) {
      const xx = x + dx, yy = y + dy, j = yy * W + xx;
      if (dx * dx + dy * dy <= ymber * ymber && xx >= 0 && xx < W && j >= 0 && j < kl.length && kl[j] >= 0 && kl[j] <= 1) rakke++;
    }
    if (rakke < MIN_RAKKE) continue;
    valitud.push({ x, y, parim: v[i], h: hinnang(i), kl: kl[i], ha: rakke * olek.meta.ruut_m ** 2 / 1e4, lnglat: rakkLngLat(x + 0.5, y + 0.5) });
    if (valitud.length === PARIMAID) break;
  }
  return valitud;
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
  if (map.getLayer("hinnang")) map.setLayoutProperty("hinnang", "visibility", nahtav ? "visible" : "none");
  olek.markerid.forEach((m) => (m.getElement().hidden = !nahtav));
  document.getElementById("kiht-nupp").setAttribute("aria-pressed", String(nahtav));
}

// ---------- panel ----------

function uuendaPaneel(kl, kohad) {
  const { vilj, paev, p0, meta } = olek;
  const tana = olek.reziim === "tana";
  document.getElementById("paeva-osa").style.visibility = tana ? "" : "hidden";
  document.getElementById("kuupaev").value = vilj.kuupaevad[paev];
  document.getElementById("eelmine").disabled = paev === 0;
  document.getElementById("jargmine").disabled = paev === vilj.kuupaevad.length - 1;

  // timeline: a week back and the forecast ahead of the anchor day (today, or a picked date)
  const nupud = document.getElementById("paevad");
  nupud.innerHTML = "";
  const aasta = vilj.kuupaevad[p0].slice(0, 4);
  for (let i = p0 - AJATELG_TAGASI; i <= p0 + AJATELG_EDASI; i++) {
    const d = vilj.kuupaevad[i];
    if (!d || d.slice(0, 4) !== aasta) continue;
    const b = document.createElement("button");
    const prog = vilj.paeva_allikas[i] === "prognoos";
    b.className = "paev" + (prog ? " prognoos" : "") + (d === vilj.tana ? " tana" : "") + (i === paev ? " aktiivne" : "");
    b.innerHTML = `<span class="nadal">${d === vilj.tana ? "täna" : NADALAPAEV[new Date(d + "T12:00").getDay()]}</span><span class="kp">${+d.slice(8)}</span>`;
    b.title = `${NADALAPAEV_PIKK[new Date(d + "T12:00").getDay()]} ${+d.slice(8)}.${d.slice(5, 7)}${prog ? " · prognoos" : ""}`;
    b.onclick = () => { olek.paev = i; joonista(); };
    nupud.append(b);
  }
  const valitud = nupud.querySelector(".aktiivne");
  if (valitud && nupud.scrollWidth > nupud.clientWidth) nupud.scrollLeft = valitud.offsetLeft - nupud.clientWidth / 2 + valitud.clientWidth / 2;

  // area per class
  const ha = KLASSID[olek.reziim].map(() => 0);
  for (let i = 0; i < kl.length; i++) if (kl[i] >= 0) ha[kl[i]] += meta.ruut_m ** 2 / 1e4;
  const legend = document.getElementById("legend");
  legend.innerHTML = KLASSID[olek.reziim].map(([nimi, c], j) =>
    `<li><span class="lapp" style="background:${c}"></span><span>${nimi}</span><span class="arv">${Math.round(ha[j])} ha</span></li>`).join("");

  const kv = document.getElementById("kokkuvote");
  const allikas = vilj.paeva_allikas[paev];
  const dv = vilj.kuupaevad[paev], nadal = NADALAPAEV_PIKK[new Date(dv + "T12:00").getDay()];
  const paevaMarkus = `<span class="pp-markus">${dv === vilj.tana ? "Täna" : `${nadal} ${+dv.slice(8)}.${dv.slice(5, 7)}`}${allikas === "prognoos" ? " · prognoos" : ""}</span> `;
  if (!tana) kv.textContent = "Metsad, kus kasvukoht sobib kukeseenele – ilmast sõltumata.";
  else if (ha[0] + ha[1] < 5 && ha[2] >= 50) kv.innerHTML = `${paevaMarkus}<b>Tagasihoidlik aeg.</b> Kõrge hindega kohti pole, võimalikke ${Math.round(ha[2])} ha. ${aegPohjus(paev)}`;
  else if (ha[0] + ha[1] < 5) kv.innerHTML = `${paevaMarkus}<b>Kehv aeg.</b> ${aegPohjus(paev)}`;
  else if (ha[0] + ha[1] < 100) kv.innerHTML = `${paevaMarkus}<b>Leidub üksikuid häid kohti</b> – kokku ${Math.round(ha[0] + ha[1])} ha. ${aegPohjus(paev)}`;
  else kv.innerHTML = `${paevaMarkus}<b>Hea aeg – tasub minna.</b> Väga häid ja häid metsi kokku ${Math.round(ha[0] + ha[1])} ha.`;

  const ol = document.getElementById("parimad");
  ol.innerHTML = kohad.length ? "" : `<li class="tuhi">Häid kohti selle päeva kohta ei ole.</li>`;
  kohad.forEach((k, i) => {
    const li = document.createElement("li");
    const A = olek.meta.astmed, ms = ASTE_KOHT[aste(k.h[0], A.koht)] || "nõrk", as = ASTE_AEG[aste(k.h[1], A.aeg)] || "seeni pole";
    li.innerHTML = `<button><span class="nr" style="background:${KLASSID[olek.reziim][k.kl][1]};color:${k.kl ? "#1c1c1a" : "#fff"}">${i + 1}</span><span>${KLASSID[olek.reziim][k.kl][0]}<small>mets ${ms}${olek.reziim === "tana" ? ` · seeneaeg ${as}` : ""} · head metsa ümber ${Math.round(k.ha)} ha</small></span><span class="arv">›</span></button>`;
    li.querySelector("button").onclick = () => {
      // keep the spot visible beside the drawer (right) or above the bottom sheet (phones)
      const nihe = innerWidth <= 760 ? [0, -innerHeight * 0.3] : [-200, 0];
      map.flyTo({ center: k.lnglat, zoom: Math.max(map.getZoom(), 14), offset: nihe });
      naitaSelgitust(k.lnglat);
    };
    ol.append(li);
  });
}

// why is the whole day poor: look at the most common forest class (fresh) at the centre point
function aegPohjus(d) {
  const p = Math.floor(olek.vilj.ilmapunktid.length / 2), j = olek.klassid.indexOf(2);
  const a = ajaSelgitus(d, p, j);
  return a.indeks < 0.3 ? a.kokku : "";
}

const hinne = (v) => Math.round(v * 100);

// ---------- explanation ----------

function rakk(lng, lat) {
  const { nurgad, laius, korgus } = olek.meta;
  const [nw, ne, , sw] = nurgad;
  const ax = ne[0] - nw[0], ay = ne[1] - nw[1], bx = sw[0] - nw[0], by = sw[1] - nw[1];
  const dx = lng - nw[0], dy = lat - nw[1], det = ax * by - ay * bx;
  const u = (dx * by - dy * bx) / det, v = (ax * dy - ay * dx) / det;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return -1;
  return Math.floor(v * korgus) * laius + Math.floor(u * laius);
}

function rakkLngLat(x, y) {
  const { nurgad, laius, korgus } = olek.meta;
  const [nw, ne, , sw] = nurgad, u = x / laius, v = y / korgus;
  return [nw[0] + u * (ne[0] - nw[0]) + v * (sw[0] - nw[0]), nw[1] + u * (ne[1] - nw[1]) + v * (sw[1] - nw[1])];
}

function puud(koosseis) {
  const osad = [...(koosseis || "").matchAll(/(\d+)([A-Z]+)/g)];
  if (!osad.length) return koosseis ? PUUD[koosseis] || koosseis : "puistu andmed puuduvad";
  return osad.map(([, k, s]) => `${PUUD[s] || s} ${k * 10}%`).join(", ");
}

function tegurid(i) {
  const k = olek.kiht;
  const t = (nimi) => k["t_" + nimi][i] / 255;
  const er = olek.eraldised[(k.eraldis_hi[i] << 8 | k.eraldis_lo[i]) - 1];
  const mu = olek.mullad[(k.muld_hi[i] << 8 | k.muld_lo[i]) - 1];
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
  const astmed = window.SIIL.juhend.piiravad;
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

const pk = (x) => String(Math.round(x));
const kord = (x) => "×" + x.toFixed(2).replace(".", ",");
const kvaliteet = (q) => (q >= 0.85 ? "hea" : q >= 0.6 ? "keskmine" : "nork");
const IKOON = {
  mets: '<svg viewBox="0 0 24 24"><path d="M12 3l-5 7h3l-4 6h12l-4-6h3z"/><path d="M12 16v5"/></svg>',
  aeg: '<svg viewBox="0 0 24 24"><path d="M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5A3.5 3.5 0 0 1 17 18z"/><path d="M9 21l.5-1M13 21l.5-1"/></svg>',
};

// step bar: four equal segments (below, then the three steps) in the class colours; segments
// above the current step are faded, the marker sits inside its segment
function astmeriba(x, piirid) {
  const lo = [0, piirid[2], piirid[1], piirid[0]], hi = [piirid[2], piirid[1], piirid[0], 1];
  const varv = ["var(--pind-3)", KLASSID.tana[2][1], KLASSID.tana[1][1], KLASSID.tana[0][1]];
  const k = Math.max(0, lo.findLastIndex((a) => x >= a));
  const asend = (k + Math.min(1, (Math.min(x, 1) - lo[k]) / (hi[k] - lo[k]))) / 4;
  const segs = varv.map((c, kk) => `<span class="aste-seg${kk > k ? " tuhm" : ""}" style="background:${c}"></span>`).join("");
  return `<div class="astmeriba"><div class="aste-segmendid">${segs}<span class="aste-marker" style="left:${asend * 100}%"></span></div></div>`;
}

// mushroom time: one week back and the forecast ahead; below it, day by day, how well new
// mushrooms can start (they are ready to pick 1-3 weeks later)
function graafik(i, d, p, j) {
  const v = olek.vilj, aasta = v.kuupaevad[d].slice(0, 4);
  let a = d, b = d;
  while (a > 0 && d - a < 7 && v.kuupaevad[a - 1].slice(0, 4) === aasta) a--;
  while (b < v.kuupaevad.length - 1 && b - d < 10 && v.kuupaevad[b + 1].slice(0, 4) === aasta) b++;
  const W = 320, H = 92, pad = 6, n = Math.max(1, b - a), riba = 10, alus = H - 30;
  const xs = (k) => pad + (k - a) / n * (W - 2 * pad), ys = (val) => alus - val * (alus - 8);
  const pts = [];
  for (let k = a; k <= b; k++) pts.push([xs(k), ys(Math.min(1, hinnang(i, k)[1])), v.paeva_allikas[k] === "prognoos"]);
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
    const c = q >= 0.8 ? "#9a3412" : q >= 0.4 ? "#f6cf3c" : "var(--pind-3)";
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
  <div class="g-legend"><span><i class="g-l-joon"></i>seeni metsas</span><span><i style="background:#9a3412"></i>uued seened tekivad</span><span><i style="background:#f6cf3c"></i>vähe</span><span><i style="background:var(--pind-3)"></i>ei teki</span></div>`;
}

function naitaSelgitust(lnglat) {
  const i = rakk(lnglat[0] ?? lnglat.lng, lnglat[1] ?? lnglat.lat);
  if (i < 0 || olek.kiht.ilmapunkt[i] === 255) return;
  const p = olek.kiht.ilmapunkt[i], d = olek.paev, A = olek.meta.astmed;
  const tana = olek.reziim === "tana";
  // headline: the same numbers the map colour comes from (100 m neighbourhood)
  const [koht, aegV] = hinnang(i);
  const kl = klassKA(koht, aegV);
  // conditions for new mushrooms: the water regime class that dominates this place
  const j = olek.klassid.map((c) => olek.kiht["S" + c][i]).reduce((b, x, jj, a) => (x > a[b] ? jj : b), 0);
  const aeg = ajaSelgitus(d, p, j);
  const { kordajad, punktid } = tegurid(i);
  const kAste = aste(koht, A.koht), aAste = aste(aegV, A.aeg);

  // all forest properties as bars: host trees, age and light first, then the rest
  const ribad = [...kordajad.map((r) => ({ nimi: r.nimi, q: r.x, pohjus: r.pohjus })),
                 ...punktid.map((r) => ({ nimi: r.nimi, q: r.p / r.max, pohjus: r.pohjus }))];
  const omadus = (r) => `<li><span class="tegur">${TEGUR_NIMI[r.nimi]}</span><span class="riba q-${kvaliteet(r.q)}"><span style="width:${Math.round(r.q * 100)}%"></span></span><span class="pohjus">${r.pohjus}</span></li>`;

  // where the forecast is heading, and when today's new mushrooms are ready
  const v = olek.vilj;
  let lopp = d;
  while (lopp < v.kuupaevad.length - 1 && lopp - d < 10 && v.kuupaevad[lopp + 1].slice(0, 4) === v.kuupaevad[d].slice(0, 4)) lopp++;
  const muutus = hinnang(i, lopp)[1] - aegV;
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

  const html = `
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

    <ul class="omadused">${ribad.map(omadus).join("")}</ul>

    ${tana ? `<h3 class="sel-h">Seeneaeg ees ootamas</h3>
    ${graafik(i, d, p, j)}
    <p class="kypseb">${suund ? suund + " " : ""}${korjatav}</p>` : ""}

    <button class="vaike-nupp" onclick="avaGiid()"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/></svg> Kuidas hinne tekib</button>`;
  // explanation in a side drawer (bottom sheet on phones), the spot marked with a dot
  peidaSelgitus();
  const silt = document.getElementById("sahtel-silt");
  silt.textContent = kl >= 0 ? KLASSID[olek.reziim][kl][0] : "Kaardil ei näidata";
  silt.className = "otsus-silt" + (kl >= 0 ? " k" + kl : "");
  // the score: forest x mushroom time (forest only in "Head metsad" mode), shown next to the label
  const skoor = document.getElementById("sahtel-hinne");
  skoor.innerHTML = `<span class="hinne-arv">${hinne(tana ? koht * Math.min(1, aegV) : koht)}</span><span class="hinne-silt">hinne</span>`;
  const sisu = document.getElementById("selgitus");
  sisu.innerHTML = html;
  sisu.scrollTop = 0;
  document.getElementById("sahtel").hidden = false;
  document.getElementById("parimad-kaart").style.visibility = "hidden";
  const tapp = document.createElement("div");
  tapp.className = "tapp";
  olek.tapp = new maplibregl.Marker({ element: tapp }).setLngLat(lnglat).addTo(map);
}

function peidaSelgitus() {
  if (olek.tapp) olek.tapp.remove();
  olek.tapp = null;
  document.getElementById("sahtel").hidden = true;
  document.getElementById("parimad-kaart").style.visibility = "";
}

// ---------- guide (built from the model's own parameters in window.SIIL.juhend) ----------

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
  const J = window.SIIL.juhend, A = J.aeg, AST = olek.meta.astmed;
  const lahter = (ki, ai) => {
    const c = ki + ai;
    return c <= 2 ? `<td style="background:${KLASSID.tana[c][1]}${c === 0 ? ";color:#fff" : ""}">${KLASSID.tana[c][0]}</td>` : `<td class="tyhi">–</td>`;
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
  <p><b>Kaardi värv</b> tuleb kahest astmest: kui hea on mets ja kui hea on seeneaeg. Nii ei muuda väike päevane kõikumine värvi – roheline jääb roheliseks, kuni seeneaeg päriselt muutub.</p>
  ${maatriks}
  <p class="vaike">„Head metsad“ režiimis on värv ainult metsa järgi: väga hea / hea / keskmine.</p>
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
  ${osa("Hooaeg", `<p>Suvi peab olema piisavalt soe: kraadipäevad üle ${nr(A.kp_alus)} °C alates 1. jaanuarist. Arvesse läheb ka 6–13 nädala tagune niiskus.</p>${tabel(kover(A.hooaeg_kp, "", (y) => y + "%"), ["kraadipäevi", "tingimus täidetud"])}`)}
  ${osa("Soojus", `${tabel(kover(A.algus_temp, " °C", (y) => y + "%"), ["õhu keskmine temperatuur", "tingimus täidetud"])}${tabel(kover(A.mulla_temp, " °C", (y) => y + "%"), [`mulla temperatuur (${A.mulla_temp_aken} p keskmine)`, "tingimus täidetud"])}<p class="vaike">Sügisel jaheneva mullaga uusi seeni enam ei teki – nii lõpeb hooaeg.</p>`)}
  ${osa("Viivitus ja säilimine", `<ul class="giid-loend"><li>Seened on korjatavad ${A.viivitus_kp} kraadipäeva (üle ${nr(A.viivitus_alus)} °C) pärast vihma: soojaga ~12 päeva, jahedaga ~4 nädalat.</li><li>Valmis seentest kaob iga päev ~${A.elu}%, jahedaga ~${A.elu_jahe}%, öökülmaga pooled.</li><li>Seetõttu määrab ka 3 päeva prognoosi peamiselt juba möödunud ilm.</li></ul>`)}

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
  const mets = [0, 0, 0];
  let rakke = 0;
  for (let i = 0; i < olek.n; i++) {
    if (olek.kiht.ilmapunkt[i] === 255) continue;
    rakke++;
    const x = kohaSobivus(i);
    A.koht.forEach((b, j) => { if (x >= b) mets[j]++; });
  }
  // mushroom time: fresh forest at the middle weather point, July-September
  const p = Math.floor(v.ilmapunktid.length / 2), j2 = olek.klassid.indexOf(2), fi = F("indeks");
  const aeg = [0, 0, 0], aastad = new Set();
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
  return `<p><b>Läved ei ole mõõdetud tõenäosused.</b> Mudelit pole veel piisavalt leidudega kontrollitud, et öelda „roheline = nii mitu protsenti tõenäosusega seeni“. Läved on valitud nii, et kaart saadaks inimesed vähestesse, tõeliselt headesse kohtadesse.</p>
    ${tabel(ASTE_KOHT.map((n, j) => [`Mets ${n} (Koht ${Math.round(A.koht[j] * 100)}+)`, `parim ${pr(mets[j], rakke)}`]), ["metsa aste", "osa kaardi metsast"])}
    <p class="vaike">Metsa astmed on seatud testala metsa jaotuse järgi: „väga hea“ on ainult parim ~6%.</p>
    ${tabel(ASTE_AEG.map((n, jj) => [`Seeneaeg ${n} (Aeg ${Math.round(A.aeg[jj] * 100)}%+)`, pr(aeg[jj], paevi)]), ["seeneaja aste", `osa juuli–septembri päevadest ${ay[0]}–${ay.at(-1)}`])}
    <p class="vaike">Seeneaja indeks on skaleeritud nii, et tavalise hea hooaja tipp on umbes 75%. „Hea“ (50%+) tähendab umbes kaht kolmandikku sellest tipust.</p>
    <p class="vaike">Päris tõenäosuseks saab hinde muuta alles siis, kui leide ja tühje käike on palju – siis saab kontrollida, kui tihti rohelisel alal tegelikult seeni leitakse.</p>`;
}

function avaGiid() {
  const sisu = document.getElementById("giid-sisu");
  if (!sisu.innerHTML && window.SIIL) sisu.innerHTML = giidHtml();
  document.getElementById("giid").showModal();
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

// data comes from andmed/testala_5458.js (window.SIIL), a plain script so file:// works too;
// only wait for the style, not for all basemap tiles ("load")
map.once("style.load", () => {
  lisaAluskaardid();
  if (!window.SIIL) {
    document.getElementById("kokkuvote").textContent = "Andmefail puudub: käivita skriptid/eksport.py.";
    return;
  }
  lae();
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

map.on("mousemove", (e) => {
  if (!olek.meta) return;
  const i = rakk(e.lngLat.lng, e.lngLat.lat);
  map.getCanvas().style.cursor = i >= 0 && olek.kiht.ilmapunkt[i] !== 255 ? "pointer" : "";
});
map.on("click", (e) => olek.meta && naitaSelgitust(e.lngLat));

document.getElementById("kuupaev").addEventListener("change", (e) => {
  if (!olek.vilj) return;
  const i = olek.vilj.kuupaevad.indexOf(e.target.value);
  if (i >= 0) valiKuupaev(i);
  else e.target.value = olek.vilj.kuupaevad[olek.paev];  // outside the season: snap back
});
document.getElementById("eelmine").onclick = () => valiKuupaev(olek.paev - 1);
document.getElementById("jargmine").onclick = () => valiKuupaev(olek.paev + 1);
document.querySelectorAll("#reziim button").forEach((b) => b.onclick = () => {
  document.querySelectorAll("#reziim button").forEach((x) => x.classList.toggle("aktiivne", x === b));
  olek.reziim = b.dataset.reziim;
  peidaSelgitus();
  if (olek.meta) joonista();
});
document.querySelectorAll("#aluskaart button").forEach((b) => b.onclick = () => {
  document.querySelectorAll("#aluskaart button").forEach((x) => x.classList.toggle("aktiivne", x === b));
  valiAluskaart(b.dataset.kiht);
});
document.getElementById("kiht-nupp").onclick = () => lulitaKiht(!olek.kihtNahtav);
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
document.getElementById("giid-nupp").onclick = avaGiid;
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
