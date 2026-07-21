@echo off
setlocal
cd /d "%~dp0"
echo RuSamaraWave — http://localhost:8080
go run ./cmd/server
endlocal
