@echo off
setlocal
cd /d "%~dp0"
if not exist bin mkdir bin
go build -ldflags="-s -w" -o bin\RuSamaraWave.exe .\cmd\server
if errorlevel 1 exit /b 1
echo Built: bin\RuSamaraWave.exe
echo Run:   bin\RuSamaraWave.exe
echo Open:  http://localhost:8080
endlocal
