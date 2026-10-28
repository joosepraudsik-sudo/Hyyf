# SIIL – Korilase kompass

Tasuta veebikaart (hostitud Cloudflare'is), mis näitab kogu Eesti metsamaal, kus on täna ja järgmisel kolmel päeval kõige tõenäolisem leida seeni. Esimene liik: **harilik kukeseen** (*Cantharellus cibarius*). Hiljem teised seened ja marjad sama raamistikuga.

Projekti kontseptsioon, tegurid, allikad ja otsused on dokumendis:
https://claude.ai/artifact/Bz3zoyjNhsW4KDF9WKyrEN

Suhtluskeel kasutajaga: **eesti keel**. Kood ja koodikommentaarid võivad olla inglise keeles.

## Kokkulepitud otsused

- **Ala:** kogu Eesti. Arendus käib esmalt testalal (kaardileht 5458, vt allpool), siis laiendus.
- **Ajatelg:** päev on mudeli argument; väljund päevadele P, P+1, P+2, P+3.
- **Lähenemine:** ekspertteadmistel põhinev mudel. Kasutajal on oma leiud, tühjad käigud ja kuupäevad, aga neid kasutatakse **ainult hilisemaks valideerimiseks** – mudeli parameetrite seadmisel neid ei vaadata.
- **Erametsad:** kui metsaregistris andmed puuduvad, jääb mets kaardilt välja. Keerulisi kompensatsioone ei tehta.
- **Hostimine:** tasuta. Cloudflare Pages (leht + igapäevased väikesed failid) ja Cloudflare R2 (staatilised kaardiruudud PMTiles failina). Aluskaart ja ortofoto otse Maa- ja Ruumiameti teenustest.
- **Kood:** avalik GitHubi repo. Igapäevane ilmaarvutus GitHub Actionsis.
- **Andmekaust:** kohapeal kuni 20–30 GB.
- **Täpsus ja kuvamine:** arvutus käib 10 m ruudustikul, aga tegelik detailsus on eraldise tasemel (1–5 ha) ja ilm 2,5 km. Kasutajale näidatakse ümbruse hinnangut (u 100 m raadius, metsa lahtrite keskmine), avaldatakse u 50 m ruudustikuna. Arvutused peavad jääma kergeks: tulemus peab mahtuma Cloudflare'i tasuta paketti.

## Mudeli ülesehitus

Kaks osa, mida brauser kasutaja ekraanil kokku liidab:

1. **Kasvukoha mudel (staatiline, 10 m ruudustik, EPSG:3301).** Igal lahtril: kasvukoha sobivus 0–1, veerežiimi klass, ilmaruudu number. Arvutatakse kord, uuendatakse 1–2 korda aastas.
2. **Niiskuse ja viljumise mudel (dünaamiline).** Iga ilmaruudu (u 2,5 km) ja iga veerežiimi klassi kohta: veebilanss, hooaja kraadipäevad, vihmajärgne viivitus, viljakeha kasv ja säilimine. Väljund: väike igapäevane fail viljumisindeksiga päevadeks P…P+3.

Põhiidee: sama vihm mõjub eri kasvukohtades erinevalt (kuiv liivamännik vajab rohkem vihma, liigniiske mets võib suurest vihmast hoopis halveneda). Seetõttu ei korrutata lihtsalt "sobivus × ilm".

Kolm ajaskaalat:
- hooaeg: kevadsuve soojussumma ja kumulatiivne niiskus, 6–13 nädalat enne viljumist;
- hoovõtt: märkimisväärne vihm käivitab viljumise u 1–3 nädalaga, jahedama ilmaga viivitus pikem;
- viljakeha: kasvab aeglaselt, säilib päevi kuni nädalaid, talub mõõdukat põuda.

Kuna viivitus vihmast seenteni on pikem kui 3-päevane horisont, määrab P+3 seisu peamiselt juba mõõdetud ilm.

## Tegurid (hüpoteesid, kõigil optimum)

Peremeespuu (mänd parim, kuusk ja kask segus head), metsa vanus (noor kuni valmiv), puistu koosseis, valgus (hõre kuni keskmine liitus), muld (hästi dreenitud, happeline pH u 4–5,5, vähe lämmastikku), liigniiskus ja tihendatus (halb), alustaimestik (sammal soodne, tihe varvukiht ebasoodne), mikroniiskus, häiringud (lageraie, teede ja põllu ääred). Täielik tabel koos allikatega on projekti dokumendis.

## Kontrollitud andmeallikad (28.10.2026)

### Metsaregister – WFS
- `https://gsavalik.envir.ee/geoserver/metsaregister/ows`, CC BY 4.0.
- Kiht `metsaregister:eraldis`: 1 770 344 kehtivat eraldist. Väljad muu hulgas: `id`, `peapuuliik_kood`, `keskm_vanus`, `kasvukoht_kood`, `boniteedi_kood`, `taius_1`, `korgus`, `kuivendatud`, `liitus_a` (täidetud vaid 281 130 eraldisel), `invent_kp`, `omandivorm_kood`.
- Kiht `metsaregister:eraldis_element` (ilma geomeetriata): koosseis rinde ja puuliigi kaupa – `eraldis_id`, `rinne_kood`, `puuliik_kood`, `osakaal`, `vanus`, `korgus`, `diameeter`.
- Klassifikaatorid: `kl_kasvukoht`, `kl_puuliik`, `kl_rinne`, `kl_omandivorm`.
- Toimiv päring (WFS 1.0.0, bbox järjekorras E,N): `...&version=1.0.0&request=GetFeature&typeName=metsaregister:eraldis&outputFormat=application/json&srsName=EPSG:3301&bbox=680000,6450000,690000,6460000` → 4119 eraldist, 5,4 MB.
- `CQL_FILTER` töötab (nt `eraldis_id IN (...)`, `resultType=hits`).

### Mullakaart
- WFS (`https://teenus.maaamet.ee/ows/mullakaart`, kiht `ms:MULD_VEK_1`) annab **ainult geomeetria, atribuute pole** – mudeliks ei sobi.
- Kasutame kogu Eesti faili: `https://geoportaal.maaruum.ee/docs/muld/Mullakaart_GDB.zip` (562 MB, kiht `Mullakaart`, EPSG:3301, 766 627 polügooni). Väljad: `Siffer`, `Sif1..4` + `Osa1..4` (mullaliik ja osakaal kompleksis), `Lihtloimis`, `Loimis1/2`, `Boniteet`, `Huumus`, `Kivisus`. Legend: `docs/muld/mullalegend.pdf`.
- Lõimis: `l` liiv, `sl` saviliiv, `ls` liivsavi, `s` savi, `t` turvas; kores `v r k p pk lu +` on karbonaatne, `v° k°` raudkivi.

### Kõrgusandmed – Maa- ja Ruumiamet geoportaal
- Avaandmed. Allalaadimine: `https://geoportaal.maaruum.ee/index.php?lang_id=2&plugin_act=otsing&page_id=664&kaardiruut=<NR>&andmetyyp=<TYYP>` tagastab HTML-i failide linkidega (`...&dl=1&f=<fail>`).
- Tüübid ja kaardilehe skaala:
  - 1:2000 (1 km², nt `450680`): `lidar_laz_tava`, `lidar_laz_mets`, `ndsm_rel_1m_geotiff`, `ndsm_abs_1m_geotiff`, `ndsm_rel_5m_geotiff`, `ndsm_abs_5m_geotiff`
  - 1:10 000 (5 km, nt `54581`): `dem_1m_geotiff`, `dem_5m_geotiff` (DTM)
  - 1:20 000 (10 km, nt `5458`): `chm_geotiff`, `dem_10m_geotiff`
- **Kaardilehtede numeratsioon (tuletatud ja kontrollitud):**
  - 1:2000: `(N_km − 6000)` kolm kohta + `E_km` kolm kohta. Näide: N 6450 km, E 680 km → `450680`.
  - 1:20 000: `r c t u`, kus `r = (N_km − 6000) div 100 + 1`, `c = E_km div 100 − 2`, `t` = sajakilomeetrise ruudu sees 10 km rida (põhjasuunas), `u` = 10 km veerg (idasuunas). N 6450–6460, E 680–690 → `5458`.
  - 1:10 000: 1:20 000 number + veerand `1..4` (veerandite järjekord veel kinnitamata – kontrolli GeoTIFF-i piiridest).
- Kogu Eesti failid: `ndsm_5m_2020-2023_kogu_Eesti.zip` (3,8 GB), `DTM_25m_eesti.zip` (298 MB).
- Mahud testalal: DTM 1 m u 75 MB / 5 km leht; CHM 9 MB / 10 km leht; LAZ u 45 MB (kevad 2023) ja 19 MB (suvi 2021) / km².
- Risk: juulis 2026 kooskõlastusele saadetud eelnõu järgi ei kuvata 3D-punktipilvi avalikkusele. Kõrgusmudeleid eelnõu ei maini. Valgus ja võrastik tulevad CHM/nDSM rastritest; punktipilve on vaja ainult alusvõsa jaoks.

### Ilm
| Ajaaken | Allikas |
| --- | --- |
| Ajalugu (kalibreerimine, valideerimine) | ERA5-Land (Copernicus, u 9 km, tunnine, 1950–, u 5 päeva viivitus); Keskkonnaagentuuri jaamade päevaandmed alates 1961 |
| Lähiminevik kuni täna | Keskkonnaagentuuri jaamad reaalajas: `https://www.ilmateenistus.ee/ilma_andmed/xml/observations.php` (u 100 jaama, sademed ja temperatuur); radarisademed KAIA failirepositooriumis |
| Prognoos P+1…P+3 | MEPS 2,5 km (MET Norway, kuni 66 h, ansambel, katab Eesti); ECMWF IFS täislahutusega avaandmed CC BY 4.0 alates 1.10.2025 |

- Sademete tänase seisu arvutame ise: radar, korrigeeritud jaamadega.
- Arenduseks sobib Open-Meteo archive API (`models=era5_land`), aga see on tasuta ainult mitteäriliseks kasutuseks; tootmises otseallikad.
- Open-Meteo `era5_land` **ei anna sademeid ega ET0** (kõik tühjad). Arenduses võetakse need `models=era5` (u 31 km) pealt, temperatuur ERA5-Landist.

### Valideerimine
- eElurikkus / PlutoF, GBIF: harilikku kukeseent väga vähe.
- Kasutaja enda leiud, tühjad käigud, kuupäevad – hoitakse eraldi ja kasutatakse alles valideerimisetapis.

## Testala

- 1:20 000 kaardileht **5458**, L-EST97 E 680–690 km, N 6450–6460 km (Põlvamaa).
- WGS84 nurgad: SW 58.1541, 27.0583; NW 58.2438, 27.0660; NE 58.2396, 27.2361; SE 58.1499, 27.2279; kese 58.1968, 27.1471.
- Allalaadimisskript: `lae_testala.ps1` (DTM 1 m ×4, CHM kevad 2023 + suvi 2021, metsaregister + koosseis + klassifikaatorid, mullakaart, ERA5-Land 5 punkti 2023–2026). Pythoni versioon `skriptid/lae_testala.py` laeb mullakaardi kogu Eesti GDB-na.

## Töövoog (Python, `uv`)

```
uv sync
uv run python -I skriptid/lae_testala.py   # andmed/ (u 1 GB)
uv run python -I skriptid/ruudustik.py     # andmed/testala_5458/ruudustik/*.tif, 10 m
uv run python -I skriptid/kasvukoht.py     # valjund/sobivus, veereziim, ilmaruut, tegurid
uv run python -I skriptid/kaart.py         # valjund/*.png
uv run python -I skriptid/viljumine.py     # valjund/viljumine_5458.csv (punkt x klass x päev)
uv run python -I skriptid/graafik.py       # valjund/hooajad_5458.png
uv run python -I skriptid/soojuskaart.py 2023-08-15 2025-09-13   # valjund/soojuskaart_5458.png
```

Viljumismudel (`viljumine.py`): veerežiimi klassi kaupa mullavee ämber (P − vahetus − KC·ET0·stress, põhjavee põhi märgadel klassidel) → niiskuse skoor; hooaeg = kraadipäevad > 5 °C × 6–13 nädala tagune niiskus; algus = märgumise tõuge või püsiv niiskus × temperatuur; küpsemine 170 kraadipäeva > 4 °C (max 45 päeva); viljakehade säilimine 0,95/päev, põud 0,88, külm 0,5. Lõpphinnang = sobivus × viljumisindeks(klass, ilmapunkt, päev).

Mudeli parameetrid (sobivuskõverad, kaalud) on `skriptid/parameetrid.py`. Sobivus = tegurite kaalutud geomeetriline keskmine.

## Järgmised sammud

1. Arenduskeskkond: Git, Python (soovitatavalt `uv`), geopaketid (GDAL/rasterio, geopandas, pyproj, numpy, scipy), Node (lehe jaoks). Avalik GitHubi repo.
2. Testala andmed alla (`lae_testala.ps1` või sama Pythonis).
3. Ühine 10 m ruudustik (EPSG:3301): puistu, muld, DTM-ist TWI ja kalle, CHM-ist võrastiku kõrgus ja katvus, kuivendus.
4. Kasvukoha mudel v0: iga teguri sobivuskõver ja kaal, väljund sobivus 0–1 + veerežiimi klass.
5. Veebilanss ja viljumisindeks viimase kahe hooaja ilmaga; soojuskaart ühe mineviku kuupäeva kohta.
6. Lihtne kaardileht (MapLibre GL, Maa- ja Ruumiameti aluskaart ja ortofoto, PMTiles) testala andmetega.
7. Alles siis: kogu Eesti, igapäevane GitHub Actions töövoog, Cloudflare'i avaldamine, valideerimine kasutaja leidudega.
