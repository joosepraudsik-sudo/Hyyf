// Siil – browser side: value = sum_c fruiting_index(point, class, day) * S_c(cell)
"use strict";

const MAA = "https://tiles.maaamet.ee/tm/tms/1.0.0";
const RAMP = [[0, "#fbe3d3"], [0.25, "#f4a77f"], [0.5, "#eb6834"], [0.75, "#b8461b"], [1, "#6e2508"]];
const SKAALA = 0.8;   // value mapped to the darkest colour; real values rarely exceed it

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const RAMP_RGB = RAMP.map(([t, c]) => [t, hex(c)]);
function color(v) {
  v = Math.min(1, Math.max(0, v / SKAALA));
  for (let i = 1; i < RAMP_RGB.length; i++) {
    const [t1, c1] = RAMP_RGB[i], [t0, c0] = RAMP_RGB[i - 1];
    if (v <= t1) {
      const f = (v - t0) / (t1 - t0);
      return c0.map((a, k) => Math.round(a + f * (c1[k] - a)));
    }
  }
  return RAMP_RGB[RAMP_RGB.length - 1][1];
}

const olek = { meta: null, rakud: null, vilj: null, paev: 0, p0: 0 };
const canvas = document.createElement("canvas");

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

function joonista() {
  const { meta, rakud, vilj, paev } = olek;
  const n = meta.laius * meta.korgus;
  const idx = vilj.indeks[paev];
  canvas.width = meta.laius;
  canvas.height = meta.korgus;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(meta.laius, meta.korgus);
  const K = meta.kihid.length - 1;
  for (let i = 0; i < n; i++) {
    const p = rakud[K * n + i];
    if (p === 255) continue;
    let v = 0;
    for (let c = 0; c < K; c++) v += idx[p][c] * rakud[c * n + i];
    const [r, g, b] = color(v / 65025);
    img.data.set([r, g, b, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const src = map.getSource("hinnang");
  const url = canvas.toDataURL();
  if (src) src.updateImage({ url, coordinates: meta.nurgad });
  else {
    map.addSource("hinnang", { type: "image", url, coordinates: meta.nurgad });
    map.addLayer({ id: "hinnang", type: "raster", source: "hinnang",
                   paint: { "raster-opacity": 0.8, "raster-resampling": "nearest", "raster-fade-duration": 0 } });
  }
  uuendaPaneel();
}

function uuendaPaneel() {
  const { vilj, paev, p0, meta } = olek;
  const kp = vilj.kuupaevad[paev];
  document.getElementById("kuupaev").value = kp;
  document.getElementById("eelmine").disabled = paev === 0;
  document.getElementById("jargmine").disabled = paev === vilj.kuupaevad.length - 1;

  const nupud = document.getElementById("paevad");
  nupud.innerHTML = "";
  for (let k = 0; k < 4; k++) {
    const i = p0 + k;
    const b = document.createElement("button");
    const d = vilj.kuupaevad[i];
    b.innerHTML = `${k === 0 ? "P" : "P+" + k}<small>${d ? d.slice(8) + "." + d.slice(5, 7) : "–"}</small>`;
    b.disabled = !d || !sama_hooaeg(p0, i);
    b.classList.toggle("aktiivne", i === paev);
    b.onclick = () => { olek.paev = i; joonista(); };
    nupud.append(b);
  }

  const ul = document.getElementById("klassid");
  ul.innerHTML = "";
  vilj.klassid.forEach((c, j) => {
    const keskm = vilj.indeks[paev].reduce((s, p) => s + p[j], 0) / vilj.indeks[paev].length / 255;
    const li = document.createElement("li");
    li.innerHTML = `<span>${c} ${meta.klassid[c]}</span><span class="riba"><span style="width:${keskm * 100}%"></span></span><span class="arv">${keskm.toFixed(2)}</span>`;
    ul.append(li);
  });
}

const sama_hooaeg = (a, b) => olek.vilj.kuupaevad[a]?.slice(0, 4) === olek.vilj.kuupaevad[b]?.slice(0, 4);

function valiKuupaev(i) {
  olek.paev = olek.p0 = Math.max(0, Math.min(olek.vilj.kuupaevad.length - 1, i));
  joonista();
}

// lon/lat -> grid cell, affine from NW, NE, SW corners (error < 10 m at this scale)
function rakk(lng, lat) {
  const { nurgad, laius, korgus } = olek.meta;
  const [nw, ne, , sw] = nurgad;
  const ax = ne[0] - nw[0], ay = ne[1] - nw[1], bx = sw[0] - nw[0], by = sw[1] - nw[1];
  const dx = lng - nw[0], dy = lat - nw[1], det = ax * by - ay * bx;
  const u = (dx * by - dy * bx) / det, v = (ax * dy - ay * dx) / det;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return -1;
  return Math.floor(v * korgus) * laius + Math.floor(u * laius);
}

function vaartus(i) {
  const { meta, rakud, vilj, paev } = olek;
  const n = meta.laius * meta.korgus, K = meta.kihid.length - 1;
  const p = rakud[K * n + i];
  if (i < 0 || p === 255) return null;
  const osad = vilj.klassid.map((c, j) => vilj.indeks[paev][p][j] * rakud[j * n + i] / 65025);
  return { v: osad.reduce((a, b) => a + b, 0), osad, punkt: meta.ilmapunktid[p] };
}

const sonad = (v) => v < 0.15 ? "vähe tõenäoline" : v < 0.35 ? "võimalik" : v < 0.55 ? "tõenäoline" : "väga tõenäoline";

const map = new maplibregl.Map({ container: "kaart", style: kaardiStiil(), center: [27.147, 58.197], zoom: 11.5, maxZoom: 17 });
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "top-right");

// data comes from andmed/testala_5458.js (window.SIIL), a plain script so file:// works too;
// only wait for the style, not for all basemap tiles ("load")
map.once("style.load", () => {
  if (!window.SIIL) {
    document.getElementById("hover").textContent = "Andmefail puudub: käivita skriptid/eksport.py.";
    return;
  }
  const { meta, rakud, viljumine: vilj } = window.SIIL;
  Object.assign(olek, { meta, rakud: Uint8Array.from(atob(rakud), (c) => c.charCodeAt(0)), vilj });
  const kp = document.getElementById("kuupaev");
  kp.min = vilj.kuupaevad[0];
  kp.max = vilj.kuupaevad.at(-1);
  const lai = innerWidth > 640;
  map.fitBounds([meta.nurgad[3], meta.nurgad[1]], {
    padding: { top: 40, right: 40, left: lai ? 340 : 20, bottom: lai ? 40 : innerHeight * 0.45 + 20 }, duration: 0,
  });
  valiKuupaev(vilj.kuupaevad.length - 4);   // demo: "today" = 3 days before the last date
});

map.on("mousemove", (e) => {
  if (!olek.meta) return;
  const r = vaartus(rakk(e.lngLat.lng, e.lngLat.lat));
  document.getElementById("hover").textContent =
    r ? `Siin: ${r.v.toFixed(2)} – ${sonad(r.v)}` : "Liigu kaardil või klõpsa metsal.";
  map.getCanvas().style.cursor = r ? "pointer" : "";
});

map.on("click", (e) => {
  if (!olek.meta) return;
  const r = vaartus(rakk(e.lngLat.lng, e.lngLat.lat));
  if (!r) return;
  const read = r.osad.map((o, j) => [o, olek.vilj.klassid[j]]).filter(([o]) => o > 0.005)
    .sort((a, b) => b[0] - a[0])
    .map(([o, c]) => `<div class="popup-rida">${olek.meta.klassid[c]} mets: ${o.toFixed(2)}</div>`).join("");
  new maplibregl.Popup({ maxWidth: "240px" }).setLngLat(e.lngLat)
    .setHTML(`<div class="popup-arv">${r.v.toFixed(2)}</div><div>${sonad(r.v)}</div>${read}<div class="popup-rida">ümbrus 100 m · ilmapunkt ${r.punkt}</div>`)
    .addTo(map);
});

document.getElementById("kuupaev").addEventListener("change", (e) => {
  const i = olek.vilj.kuupaevad.indexOf(e.target.value);
  if (i >= 0) valiKuupaev(i);
  else uuendaPaneel();  // outside the season: snap back
});
document.getElementById("eelmine").onclick = () => valiKuupaev(olek.paev - 1);
document.getElementById("jargmine").onclick = () => valiKuupaev(olek.paev + 1);
document.getElementById("labipaistvus").oninput = (e) =>
  map.getLayer("hinnang") && map.setPaintProperty("hinnang", "raster-opacity", e.target.value / 100);
document.querySelectorAll("#aluskaart button").forEach((b) => b.onclick = () => {
  document.querySelectorAll("#aluskaart button").forEach((x) => {
    x.classList.toggle("aktiivne", x === b);
    map.setLayoutProperty(x.dataset.kiht, "visibility", x === b ? "visible" : "none");
  });
});
document.getElementById("ahenda").onclick = (e) => {
  const p = document.getElementById("paneel");
  const kinni = p.classList.toggle("ahendatud");
  e.target.textContent = kinni ? "+" : "–";
  e.target.setAttribute("aria-expanded", String(!kinni));
};
