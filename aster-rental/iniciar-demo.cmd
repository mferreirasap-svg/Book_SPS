@echo off
rem Áster Rental — inicia em modo demonstração no Windows (dois cliques neste arquivo).
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale o Node.js 22 LTS em https://nodejs.org e rode de novo. & pause & exit /b 1)
if not exist node_modules (echo Instalando dependencias, aguarde... & call npm install || (pause & exit /b 1))
start "" http://localhost:3000
node server\src\start.js
pause
