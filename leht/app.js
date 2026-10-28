// Siil – browser side.
// "Kus täna otsida": value = sum_c fruiting_index(point, class, day) * S_c(cell)
// "Head metsad":     value = sum_c S_c(cell)  (site suitability in the 100 m neighbourhood)
"use strict";

const MAA = "https://tiles.maaamet.ee/tm/tms/1.0.0";

// Display classes per mode: [lower bound, label, colour]; below the last bound nothing is drawn
const KLASSID = {
  tana: [[0.45, "Väga hea", "#8f3312"], [0.30, "Hea", "#eb6834"], [0.18, "Võimalik", "#f6b48f"]],
  koht: [[0.70, "Väga hea mets", "#8f3312"], [0.50, "Hea mets", "#eb6834"], [0.30, "Keskmine mets", "#f6b48f"]],
};
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

const olek = { reziim: "tana", paev: 0, p0: 0, markerid: [] };
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

function vaartus(i, d = olek.paev) {
  const p = olek.kiht.ilmapunkt[i];
  if (p === 255) return null;
  if (olek.reziim === "koht") return kohaSobivus(i);
  const fi = F("indeks");
  return olek.klassid.reduce((s, c, j) => s + T(d, p, j, fi) * olek.kiht["S" + c][i] / 255, 0);
}

function klass(v) {
  const k = KLASSID[olek.reziim];
  for (let j = 0; j < k.length; j++) if (v >= k[j][0]) return j;
  return -1;
}

// ---------- map drawing ----------

function joonista() {
  const { meta, n } = olek;
  canvas.width = meta.laius;
  canvas.height = meta.korgus;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(meta.laius, meta.korgus);
  const varvid = KLASSID[olek.reziim].map(([, , c]) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16)));
  const kl = new Int8Array(n).fill(-1);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = vaartus(i);
    if (x === null) continue;
    v[i] = x;
    kl[i] = klass(x);
    if (kl[i] >= 0) img.data.set([...varvid[kl[i]], 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL();
  const src = map.getSource("hinnang");
  if (src) src.updateImage({ url, coordinates: meta.nurgad });
  else {
    map.addSource("hinnang", { type: "image", url, coordinates: meta.nurgad });
    map.addLayer({ id: "hinnang", type: "raster", source: "hinnang",
                   paint: { "raster-opacity": 0.78, "raster-resampling": "nearest", "raster-fade-duration": 0 } });
  }
  const kohad = parimadKohad(v, kl);
  uuendaPaneel(kl, kohad);
  uuendaMarkerid(kohad);
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
    valitud.push({ x, y, parim: v[i], ha: rakke * olek.meta.ruut_m ** 2 / 1e4, lnglat: rakkLngLat(x + 0.5, y + 0.5) });
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
    el.title = `${i + 1}. koht – hinne ${hinne(k.parim)}`;
    el.onclick = (e) => { e.stopPropagation(); naitaSelgitust(k.lnglat); };
    return new maplibregl.Marker({ element: el }).setLngLat(k.lnglat).addTo(map);
  });
}

// ---------- panel ----------

function uuendaPaneel(kl, kohad) {
  const { vilj, paev, p0, meta } = olek;
  const tana = olek.reziim === "tana";
  document.getElementById("paeva-osa").hidden = !tana;
  document.getElementById("kuupaev").value = vilj.kuupaevad[paev];
  document.getElementById("eelmine").disabled = paev === 0;
  document.getElementById("jargmine").disabled = paev === vilj.kuupaevad.length - 1;

  const nupud = document.getElementById("paevad");
  nupud.innerHTML = "";
  for (let k = 0; k < 4; k++) {
    const i = p0 + k, d = vilj.kuupaevad[i];
    const b = document.createElement("button");
    b.innerHTML = `${k === 0 ? "P" : "P+" + k}<small>${d ? d.slice(8) + "." + d.slice(5, 7) : "–"}</small>`;
    b.disabled = !d || d.slice(0, 4) !== vilj.kuupaevad[p0].slice(0, 4);
    b.classList.toggle("aktiivne", i === paev);
    b.onclick = () => { olek.paev = i; joonista(); };
    nupud.append(b);
  }

  // area per class
  const ha = KLASSID[olek.reziim].map(() => 0);
  for (let i = 0; i < kl.length; i++) if (kl[i] >= 0) ha[kl[i]] += meta.ruut_m ** 2 / 1e4;
  const legend = document.getElementById("legend");
  legend.innerHTML = KLASSID[olek.reziim].map(([, nimi, c], j) =>
    `<li><span class="lapp" style="background:${c}"></span><span>${nimi}</span><span class="arv">${Math.round(ha[j])} ha</span></li>`).join("");

  const kv = document.getElementById("kokkuvote");
  if (!tana) kv.textContent = "Metsad, kus kasvukoht sobib kukeseenele – ilmast sõltumata.";
  else if (ha[0] + ha[1] < 5) kv.innerHTML = `<b>Kehv aeg.</b> ${aegPohjus(paev)}`;
  else if (ha[0] + ha[1] < 100) kv.innerHTML = `<b>Leidub üksikuid häid kohti</b> – kokku ${Math.round(ha[0] + ha[1])} ha. ${aegPohjus(paev)}`;
  else kv.innerHTML = `<b>Hea aeg – tasub minna.</b> Väga häid ja häid metsi kokku ${Math.round(ha[0] + ha[1])} ha.`;

  const ol = document.getElementById("parimad");
  ol.innerHTML = kohad.length ? "" : `<li class="tuhi">Häid kohti selle päeva kohta ei ole.</li>`;
  kohad.forEach((k, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<button><span class="nr">${i + 1}</span><span>hinne ${hinne(k.parim)}<small>head metsa ümber ${Math.round(k.ha)} ha</small></span><span class="arv">›</span></button>`;
    li.querySelector("button").onclick = () => {
      map.flyTo({ center: k.lnglat, zoom: Math.max(map.getZoom(), 14) });
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
  const piiravad = olek.meta.piiravad.map((nimi) => ({ nimi, v: t(nimi), pohjus: pohjus[nimi], piirav: true }));
  const kaalutud = Object.keys(olek.meta.kaalud).map((nimi) => ({ nimi, v: t(nimi), pohjus: pohjus[nimi], kaal: olek.meta.kaalud[nimi] }));
  return [...piiravad, ...kaalutud];
}

// time part for day d, point p, class position j
function ajaSelgitus(d, p, j) {
  const g = (nimi) => T(d, p, j, F(nimi));
  const indeks = g("indeks"), w = g("w"), niiskus = g("niiskus"), hooaeg = g("hooaeg"), temp = g("temperatuur");
  const enne = d >= 3 && olek.vilj.kuupaevad[d - 3].slice(0, 4) === olek.vilj.kuupaevad[d].slice(0, 4) ? T(d - 3, p, j, F("indeks")) : indeks;
  const trend = indeks - enne > 0.05 ? "↑ kasvab" : enne - indeks > 0.05 ? "↓ väheneb" : "→ püsib";
  const read = [
    { nimi: "Mulla niiskus", v: niiskus, pohjus: w < 0.2 ? "kuiv – seened ei kasva" : w < 0.45 ? "pigem kuiv" : w <= 0.9 ? "parasniiske" : niiskus < 0.8 ? "liiga märg" : "väga niiske" },
    { nimi: "Hooaeg", v: hooaeg, pohjus: hooaeg < 0.2 ? "liiga vara – suvi pole veel piisavalt soe olnud" : hooaeg < 0.8 ? "hooaeg alles algab või eelnev periood oli kuiv" : "hooaeg käib" },
    { nimi: "Soojus uute seente tekkeks", v: temp, pohjus: temp < 0.2 ? "liiga jahe – uusi seeni ei teki" : temp < 0.8 ? "jahedavõitu" : "piisavalt soe" },
  ];
  let kokku;
  if (indeks >= 0.3) kokku = "Seeni on metsas praegu.";
  else {
    const nork = read.reduce((a, b) => (b.v < a.v ? b : a));
    kokku = nork.v < 0.5 ? `${nork.nimi}: ${nork.pohjus}.` : "Viimane vihm oli liiga ammu või liiga hiljuti – seened tekivad 1–3 nädalat pärast vihma.";
  }
  return { indeks, trend, read, kokku };
}

function riba(v, vihje) {
  return `<span class="riba${vihje ? " nork" : ""}"><span style="width:${Math.round(v * 100)}%"></span></span><span class="arv">${hinne(v)}</span>`;
}

function naitaSelgitust(lnglat) {
  const i = rakk(lnglat[0] ?? lnglat.lng, lnglat[1] ?? lnglat.lat);
  if (i < 0 || olek.kiht.ilmapunkt[i] === 255) return;
  const p = olek.kiht.ilmapunkt[i];
  const koht = kohaSobivus(i);
  // class that contributes most to this cell
  const j = olek.klassid.map((c) => olek.kiht["S" + c][i]).reduce((b, x, jj, a) => (x > a[b] ? jj : b), 0);
  const aeg = ajaSelgitus(olek.paev, p, j);
  const tana = olek.reziim === "tana";
  const kokku = tana ? vaartus(i) : koht;

  const tg = tegurid(i);
  const nork = tg.reduce((a, b) => (b.v < a.v ? b : a));
  let lause;
  if (koht < 0.3) lause = `Mets ei sobi hästi: ${TEGUR_NIMI[nork.nimi].toLowerCase()} – ${nork.pohjus}.`;
  else if (!tana) lause = koht >= 0.7 ? "Väga hea kukeseene mets." : `Hea mets, kuid ${TEGUR_NIMI[nork.nimi].toLowerCase()} alandab hinnet.`;
  else if (aeg.indeks < 0.2) lause = `Mets on ${koht >= 0.6 ? "hea" : "keskmine"}, aga aeg on vale. ${aeg.kokku}`;
  else if (kokku >= 0.3) lause = "Hea mets ja hea aeg – tasub otsida.";
  else lause = `Keskmine: ${koht < 0.6 ? "mets on keskpärane" : "seeni on veel vähe"}.`;

  const rida = (r) => `<li><span class="tegur">${TEGUR_NIMI[r.nimi] || r.nimi}${r.piirav ? ' <span class="mark" title="Piirav tegur: korrutab kogu hinnet">×</span>' : ` <span class="mark" title="Kaal">${Math.round(r.kaal * 100)}%</span>`}</span>${riba(r.v, r === nork && r.v < 0.9)}<span class="pohjus">${r.pohjus}</span></li>`;
  const html = `
    <div class="sel-pea"><span class="sel-arv">${hinne(kokku)}</span><span>${lause}</span></div>
    ${tana ? `<div class="valem">Koht ${hinne(koht)} × Aeg ${hinne(aeg.indeks)}</div>` : ""}
    <div class="sel-osa">Koht <span class="arv">${hinne(koht)}</span><small>100 m ümbruse keskmine; tegurid selle 50 m ruudu kohta</small></div>
    <ul class="sel-read">${tg.map(rida).join("")}</ul>
    ${tana ? `<div class="sel-osa">Aeg <span class="arv">${hinne(aeg.indeks)}</span><small>${olek.meta.klassid[olek.klassid[j]]} mets · seeni ${aeg.trend}</small></div>
    <ul class="sel-read">${aeg.read.map((r) => `<li><span class="tegur">${r.nimi}</span>${riba(r.v, r.v < 0.5)}<span class="pohjus">${r.pohjus}</span></li>`).join("")}</ul>
    <p class="sel-markus">Seened tekivad 1–3 nädalat pärast vihma. „Aeg“ näitab, kui palju neid praegu metsas on.</p>` : ""}
    <p class="sel-markus">× piirav tegur (korrutab kogu hinnet) · % kaal ülejäänud tegurite keskmises</p>
    <button class="giid-nupp vaike-nupp" onclick="avaGiid()"><span class="ikoon-ring">?</span> Kuidas hinne tekib?</button>`;
  peidaSelgitus();
  if (innerWidth > 640) {
    olek.popup = new maplibregl.Popup({ maxWidth: "340px", className: "selgitus" })
      .setLngLat(lnglat).setHTML(html).addTo(map);
    return;
  }
  // narrow screens: a popup would hide behind the bottom panel, so explain inside the panel
  const sel = document.getElementById("selgitus");
  sel.innerHTML = `<button class="tagasi">‹ Tagasi</button>${html}`;
  sel.hidden = false;
  sel.querySelector(".tagasi").onclick = peidaSelgitus;
  const paneel = document.getElementById("paneel");
  if (paneel.classList.contains("ahendatud")) document.getElementById("ahenda").click();
  paneel.scrollTop = 0;
  const tapp = document.createElement("div");
  tapp.className = "tapp";
  olek.popup = new maplibregl.Marker({ element: tapp }).setLngLat(lnglat).addTo(map);
}

function peidaSelgitus() {
  if (olek.popup) olek.popup.remove();
  olek.popup = null;
  document.getElementById("selgitus").hidden = true;
}

// ---------- guide (built from the model's own parameters in window.SIIL.juhend) ----------

const nr = (x) => String(x).replace(".", ",");

// piecewise-linear curve [[x, points], ...] -> readable rows
function kover(punktid, yhik = "") {
  const read = [];
  for (let i = 0; i + 1 < punktid.length; i++) {
    const [x0, y0] = punktid[i], [x1, y1] = punktid[i + 1];
    if (x1 === x0) continue;
    const vahemik = i === 0 && x0 <= 0 ? `alla ${nr(x1)}${yhik}` : x1 >= 10000 || i === punktid.length - 2 && y0 === y1 ? `üle ${nr(x0)}${yhik}` : `${nr(x0)}–${nr(x1)}${yhik}`;
    read.push([vahemik, y0 === y1 ? `${y0}` : `${y0} → ${y1}`]);
  }
  return read;
}

const tabel = (read, pais = ["", "punkte"]) =>
  `<table><thead><tr><th>${pais[0]}</th><th>${pais[1]}</th></tr></thead><tbody>${read.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</tbody></table>`;

const osa = (pealkiri, sisu, lahti = false) => `<details${lahti ? " open" : ""}><summary>${pealkiri}</summary>${sisu}</details>`;

function giidHtml() {
  const J = window.SIIL.juhend, A = J.aeg, k = KLASSID.tana;
  const kaalud = Object.entries(J.kaalud).map(([n, w]) =>
    `<li><span>${TEGUR_NIMI[n]}</span><span class="riba"><span style="width:${w * 250}%"></span></span><span class="arv">${Math.round(w * 100)}%</span></li>`).join("");
  return `
  <p class="giid-juhis"><b>Hinne (0–100) = Koht × Aeg.</b> „Koht“ ütleb, kas mets sobib kukeseenele, „Aeg“ ütleb, kas ilm on viimastel nädalatel seeni tekitanud. Näide: Koht 80 × Aeg 50 → hinne 40.</p>
  <ul class="giid-klassid">${k.map(([piir, nimi, c]) => `<li><span class="lapp" style="background:${c}"></span>${nimi}: hinne ${Math.round(piir * 100)} või rohkem</li>`).join("")}
    <li><span class="lapp tuhi-lapp"></span>alla ${Math.round(k.at(-1)[0] * 100)} – kaardil ei näidata</li></ul>

  <h3>Koht – kas mets sobib</h3>
  <p><b>1. samm – piiravad tegurid korrutatakse.</b> Kukeseen elab ainult koos elava puuga, seega kui üks neist on null, on ka koht null – olgu muld kui tahes hea:</p>
  <ul class="giid-loend">${Object.keys(J.piiravad).map((n) => `<li><b>${TEGUR_NIMI[n]}</b></li>`).join("")}</ul>
  <p><b>2. samm – ülejäänud tegurid annavad kaalutud keskmise.</b> Kehv tegur tõmbab hinnet alla, head tegurid ei korva seda täielikult.</p>
  <ul class="giid-kaalud">${kaalud}</ul>
  <p class="vaike">Iga tegur annab 0–100 punkti (100 = ideaalne). Allpool on kõigi tegurite punktitabelid.</p>

  ${osa("Puuliigid ×", `${tabel(J.puuliik, ["puuliik", "punkte"])}<p class="vaike">Muud liigid ${J.puuliik_muu}. Punktid kaalutakse liigi osakaaluga ülemises rindes; alumine rinne läheb arvesse ${Math.round(J.teine_rinne * 100)}% kaaluga. Segametsa boonus +${J.segu_boonus}, kui kaks sobivat liiki on kumbki vähemalt 20%. Mõju on veidi pehmendatud: kuusik (75) annab lõpphindele teguri 0,81.</p>`)}
  ${osa("Puistu vanus ×", `${tabel(kover(J.vanus, " a"), ["vanus", "punkte"])}<p class="vaike">Noored puud kulutavad süsiniku oma kasvule; seeneniidistik vajab aastakümneid, et muutuda viljakaks. Vanus arvestatakse metsaregistri inventeerimisest tänasesse.</p>`)}
  ${osa("Valgus (võrastik olemas) ×", `${tabel(kover(J.valgus, "%"), ["võrastiku katvus", "punkte"])}<p class="vaike">Katvus = kui suur osa maast on üle 5 m kõrguste puude all (lidar). Raiesmik ja lage maa ≈ 0.</p>`)}
  ${osa("Metsatüüp", `${tabel(J.kasvukoht, ["kasvukohatüüp", "punkte"])}<p class="vaike">Kõige parem üksiknäitaja: võtab kokku mulla niiskuse, viljakuse ja alustaimestiku. Liiga viljakas (naadi, angervaksa) – lopsakas rohustu; liiga kuiv (sambliku) – porosamblik ja kõrvetav päike.</p>`)}
  ${osa("Muld", `${tabel(J.loimis, ["lõimis", "punkte"])}${tabel(J.muld_niiskus, ["liigniiskus", "punkte"])}${tabel(J.muld_hape, ["happesus", "punkte"])}<p class="vaike">Mulla hinne = niiskus (kaalub kõige rohkem) × lõimis × happesus. Paekivine kores alandab happesust. Allikas: Maa- ja Ruumiameti mullakaart.</p>`)}
  ${osa("Maastiku niiskus", `${tabel(kover(J.twi), ["märgumisindeks (TWI)", "punkte"])}<p class="vaike">TWI näitab kõrgusmudeli järgi, kuhu vesi koguneb: väike = seljak, kuivab kiiresti; suur = lohk või kraav, seisev vesi lämmatab seeneniidistiku. Parim on parasniiske nõlv.</p>`)}
  ${osa("Soo serv (ökotoon)", `${tabel(kover(J.okotoon, " m"), ["kaugus soost/rabast", "punkte"])}<p class="vaike">Liivasel mineraalmullal mets soo või raba lähedal: mänd saab juurtele hapnikku, soo hoiab öise udu ja õhuniiskuse – viljakehad ei kuiva. Soo = metsaregistri soo-kasvukohad ja mullakaardi turvasmullad.</p>`)}
  ${osa("Metsamassiiv", `${tabel(kover(J.sidusus, "%"), [`metsa osakaal ${J.sidusus_raadius} m ümbruses`, "punkte"])}<p class="vaike">Suur katkematu mets hoiab mikrokliimat; väike tukk põllu või tee ääres kuivab kiiresti.</p>`)}
  ${osa("Võra tihedus", `${tabel(kover(J.tihedus, "%"), ["võrastiku katvus", "punkte"])}<p class="vaike">Kõige parem on täpiline valgus (hõre kuni keskmine liitus). Kottpime kuusik on halvem.</p>`)}

  <h3>Aeg – kas seeni on praegu metsas</h3>
  ${osa("Mulla niiskus", `<p>Iga päev arvutatakse mulla veevaru: vihm miinus aurumine. Sama vihm mõjub eri metsades erinevalt, sest „veeämber“ on eri suurusega: ${Object.values(A.reziim).map((r) => `${r.nimi} ${r.kp} mm`).join(", ")}. Märgades metsades hoiab põhjavesi veevaru üleval, kuid liiga märg on halb.</p>${tabel(kover(A.niiskus.map(([x, y]) => [Math.round(x * 100), y]), "%"), ["veevaru täidetus", "punkte"])}`, true)}
  ${osa("Hooaeg", `<p>Suvi peab olema piisavalt soe: kraadipäevad üle ${nr(A.kp_alus)} °C alates 1. jaanuarist.</p>${tabel(kover(A.hooaeg_kp), ["kraadipäevi", "punkte"])}<p class="vaike">Arvesse läheb ka 6–13 nädala tagune niiskus: kuiv kevadsuvi vähendab seeni hiljem.</p>`)}
  ${osa("Soojus uute seente tekkeks", `${tabel(kover(A.algus_temp, " °C"), ["õhu keskmine temperatuur", "punkte"])}${tabel(kover(A.mulla_temp, " °C"), [`mulla temperatuur (${A.mulla_temp_aken} p keskmine)`, "punkte"])}<p class="vaike">Sügisel jaheneva mullaga uusi seeni enam ei teki – nii lõpeb hooaeg.</p>`)}
  ${osa("Viivitus ja säilimine", `<ul class="giid-loend"><li>Vihm käivitab viljumise, aga seened on korjatavad alles ${A.viivitus_kp} kraadipäeva (üle ${nr(A.viivitus_alus)} °C) pärast: soojaga ~12 päeva, jahedaga ~4 nädalat. Kui ${A.viivitus_max} päevaga ei küpse, alged hukkuvad.</li><li>Valmis seentest kaob iga päev ~${A.elu}%, jahedaga (alla ${nr(A.jahe)} °C) ~${A.elu_jahe}%, öökülmaga (alla ${nr(A.kulm)} °C) pooled.</li><li>Seetõttu määrab ka 3 päeva prognoosi peamiselt juba möödunud ilm.</li></ul>`)}

  <p class="markus">Kõik numbrid on ekspertteadmistel põhinevad hüpoteesid. Mudelit ei ole veel päris leidudega kontrollitud.</p>`;
}

function avaGiid() {
  const sisu = document.getElementById("giid-sisu");
  if (!sisu.innerHTML && window.SIIL) sisu.innerHTML = giidHtml();
  document.getElementById("giid").showModal();
}

// ---------- map ----------

function kaardiStiil() {
  const kiht = (id, ext) => ({
    type: "raster", tileSize: 256, scheme: "tms", maxzoom: 18,
    tiles: [`${MAA}/${id}@GMC/{z}/{x}/{y}.${ext}`],
    attribution: '© <a href="https://maaruum.ee">Maa- ja Ruumiamet</a>',
  });
  return {
    version: 8,
    sources: { hallkaart: kiht("hallkaart", "png"), kaart: kiht("kaart", "png"), foto: kiht("foto", "jpg") },
    layers: ["hallkaart", "kaart", "foto"].map((id) => ({
      id, type: "raster", source: id, layout: { visibility: id === "hallkaart" ? "visible" : "none" },
    })),
  };
}

function valiKuupaev(i) {
  olek.paev = olek.p0 = Math.max(0, Math.min(olek.vilj.kuupaevad.length - 1, i));
  joonista();
}

const map = new maplibregl.Map({ container: "kaart", style: kaardiStiil(), center: [27.147, 58.197], zoom: 11.5, maxZoom: 17 });
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "top-right");

// data comes from andmed/testala_5458.js (window.SIIL), a plain script so file:// works too;
// only wait for the style, not for all basemap tiles ("load")
map.once("style.load", () => {
  if (!window.SIIL) {
    document.getElementById("kokkuvote").textContent = "Andmefail puudub: käivita skriptid/eksport.py.";
    return;
  }
  lae();
  const kp = document.getElementById("kuupaev");
  kp.min = olek.vilj.kuupaevad[0];
  kp.max = olek.vilj.kuupaevad.at(-1);
  const lai = innerWidth > 640, m = olek.meta;
  map.fitBounds([m.nurgad[3], m.nurgad[1]], {
    padding: { top: 40, right: 40, left: lai ? 340 : 20, bottom: lai ? 40 : innerHeight * 0.45 + 20 }, duration: 0,
  });
  valiKuupaev(olek.vilj.kuupaevad.length - 4);   // demo: "today" = 3 days before the last date
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
  document.querySelectorAll("#aluskaart button").forEach((x) => {
    x.classList.toggle("aktiivne", x === b);
    map.setLayoutProperty(x.dataset.kiht, "visibility", x === b ? "visible" : "none");
  });
});
document.getElementById("giid-nupp").onclick = avaGiid;
document.getElementById("giid-sulge").onclick = () => document.getElementById("giid").close();
document.getElementById("giid").addEventListener("click", (e) => {
  if (e.target.id === "giid") e.target.close();   // click on the backdrop
});
document.getElementById("ahenda").onclick = (e) => {
  const p = document.getElementById("paneel");
  const kinni = p.classList.toggle("ahendatud");
  e.target.textContent = kinni ? "+" : "–";
  e.target.setAttribute("aria-expanded", String(!kinni));
};
