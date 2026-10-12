#!/bin/sh
# Áster Rental — inicia em modo demonstração no Linux/Mac: sh iniciar-demo.sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Instale o Node.js 22 LTS em https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install || exit 1
node server/src/start.js
