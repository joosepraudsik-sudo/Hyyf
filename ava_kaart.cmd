@echo off
rem Hüüf: starts a local web server for leht/ and opens all of Estonia in the browser.
rem All of Estonia needs a web server (index.html opened straight from disk shows only the test sheet).
rem Close the server window to stop.
cd /d "%~dp0"
start "Hyyf server (sulge, et peatada)" python -m http.server 8765 --bind 127.0.0.1 --directory leht
timeout /t 2 /nobreak >nul
start "" "http://localhost:8765/?ala=eesti"
