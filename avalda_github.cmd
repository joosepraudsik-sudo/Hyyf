@echo off
rem Huuf: saadab projekti GitHubi (main haru).
cd /d "%~dp0"

findstr /x /c:"*.pdf" .gitignore >nul 2>&1 || echo *.pdf>>.gitignore

echo.
echo === 1/4 Commit ===
git add -A
git commit -m "Valmis avaldamiseks"

echo.
echo === 2/4 Uus too main harusse ===
git checkout main || goto viga
git merge --ff-only eesti-andmed || goto viga

echo.
echo === 3/4 GitHubi uhendus ===
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  set /p KASUTAJA=Kirjuta oma GitHubi kasutajanimi ja vajuta Enter: 
  call git remote add origin https://github.com/%%KASUTAJA%%/hyyf.git
)
git remote -v

echo.
echo === 4/4 Saadan GitHubi (brauseris voib avaneda sisselogimine) ===
git push -u origin main || goto viga

echo.
echo VALMIS! Varskenda GitHubis repo lehte.
pause
exit /b 0

:viga
echo.
echo Midagi laks valesti. Tee sellest aknast kuvatommis ja saada Claudele.
pause
exit /b 1
