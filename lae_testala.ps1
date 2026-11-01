# HÜÜF - testala andmete allalaadimine
# Testala: 1:20 000 kaardileht 5458 (L-EST97: E 680-690 km, N 6450-6460 km), Polvamaa
# Kaivitamine: parem klikk -> "Run with PowerShell", voi PowerShellis:
#   powershell -ExecutionPolicy Bypass -File .\lae_testala.ps1

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = "SilentlyContinue"   # teeb Invoke-WebRequest palju kiiremaks

$root = Join-Path $PSScriptRoot "andmed\testala_5458"
$dirs = @("korgus", "metsaregister", "muld", "ilm")
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path (Join-Path $root $d) | Out-Null }

function Lae($url, $fail) {
    if (Test-Path $fail) { Write-Host "  olemas: $(Split-Path $fail -Leaf)"; return }
    Write-Host "  laen: $(Split-Path $fail -Leaf)"
    Invoke-WebRequest -Uri $url -OutFile $fail -UseBasicParsing -TimeoutSec 600
}

# ---------- 1. Korgusandmed Maa- ja Ruumiameti geoportaalist ----------
$geo = "https://geoportaal.maaruum.ee/index.php?lang_id=2&plugin_act=otsing&page_id=664"

function Geoportaal($kaardileht, $tyyp, $mustrid) {
    $html = (Invoke-WebRequest -Uri "$geo&kaardiruut=$kaardileht&andmetyyp=$tyyp" -UseBasicParsing).Content
    $lingid = [regex]::Matches($html, 'href="(index\.php\?[^"]+?f=([^&"]+)[^"]*)"')
    foreach ($m in $lingid) {
        $nimi = $m.Groups[2].Value
        foreach ($muster in $mustrid) {
            if ($nimi -like $muster) {
                $url = "https://geoportaal.maaruum.ee/" + ($m.Groups[1].Value -replace '&amp;', '&')
                Lae $url (Join-Path $root "korgus\$nimi")
            }
        }
    }
}

Write-Host "1/4 Korgusandmed (DTM 1 m, vorastiku korgus CHM)"
foreach ($q in 1..4) { Geoportaal "5458$q" "dem_1m_geotiff" @("*_dtm_1m.tif") }
Geoportaal "5458" "chm_geotiff" @("*kevad_2023.tif", "*suvi_2021.tif")

# ---------- 2. Metsaregister (WFS) ----------
Write-Host "2/4 Metsaregister"
$bbox = "680000,6450000,690000,6460000"
$mr = "https://gsavalik.envir.ee/geoserver/metsaregister/ows?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:3301"
$eraldisFail = Join-Path $root "metsaregister\eraldis.geojson"
Lae "$mr&typeName=metsaregister:eraldis&bbox=$bbox" $eraldisFail

$elFail = Join-Path $root "metsaregister\eraldis_element.json"
if (-not (Test-Path $elFail)) {
    $ids = (Get-Content $eraldisFail -Raw | ConvertFrom-Json).features | ForEach-Object { $_.properties.id }
    Write-Host "  eraldisi: $($ids.Count), laen puistu koosseisu"
    $koik = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $ids.Count; $i += 200) {
        $tykk = $ids[$i..([Math]::Min($i + 199, $ids.Count - 1))] -join ","
        $filter = [uri]::EscapeDataString("eraldis_id IN ($tykk)")
        $vastus = Invoke-RestMethod -Uri "$mr&typeName=metsaregister:eraldis_element&CQL_FILTER=$filter" -UseBasicParsing
        foreach ($f in $vastus.features) { [void]$koik.Add($f.properties) }
    }
    $koik | ConvertTo-Json -Depth 4 -Compress | Set-Content -Path $elFail -Encoding UTF8
}
foreach ($kl in @("kl_kasvukoht", "kl_puuliik", "kl_rinne")) {
    Lae "$mr&typeName=metsaregister:$kl" (Join-Path $root "metsaregister\$kl.json")
}

# ---------- 3. Mullakaart (WFS) ----------
Write-Host "3/4 Mullakaart"
$muld = "https://teenus.maaamet.ee/ows/mullakaart?service=WFS&version=1.0.0&request=GetFeature&bbox=$bbox"
foreach ($kiht in @("MULD_VEK_0", "MULD_VEK_1", "MULD_VEK_2")) {
    Lae "$muld&typeName=ms:$kiht" (Join-Path $root "muld\$kiht.gml")
}

# ---------- 4. Ilm: ERA5-Land paevased andmed (arenduseks, Open-Meteo) ----------
Write-Host "4/4 Ilm (ERA5-Land 2023-2026)"
$punktid = @(
    @{ n = "lounalaane"; lat = 58.172; lon = 27.075 },
    @{ n = "loodenurk";  lat = 58.262; lon = 27.075 },
    @{ n = "keskel";     lat = 58.217; lon = 27.160 },
    @{ n = "kirdenurk";  lat = 58.262; lon = 27.245 },
    @{ n = "kagunurk";   lat = 58.172; lon = 27.245 }
)
$muutujad = "temperature_2m_mean,temperature_2m_min,temperature_2m_max,precipitation_sum,et0_fao_evapotranspiration,soil_moisture_0_to_7cm_mean,soil_moisture_7_to_28cm_mean,soil_temperature_0_to_7cm_mean"
foreach ($p in $punktid) {
    $url = "https://archive-api.open-meteo.com/v1/archive?latitude=$($p.lat)&longitude=$($p.lon)&start_date=2023-04-01&end_date=2026-10-20&daily=$muutujad&models=era5_land&timezone=Europe%2FTallinn"
    Lae $url (Join-Path $root "ilm\era5land_$($p.n).json")
    Start-Sleep -Seconds 1
}

Write-Host ""
Write-Host "Valmis. Andmed asuvad: $root"
Read-Host "Vajuta Enter, et aken sulgeda"
