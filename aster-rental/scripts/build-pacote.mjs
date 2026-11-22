// Monta o pacote de apresentação em dist-apresentacao/ (e o .zip):
//   - "Aster Rental.html": o sistema inteiro num arquivo só (tela + regras + base de apresentação), roda sem internet e sem instalar nada;
//   - "Abrir Aster Rental.cmd" + servidor.ps1: publica o arquivo em http://localhost:8080 no Windows (PowerShell, já vem no sistema);
//   - "Abrir Aster Rental (Mac).command": o mesmo no Mac;
//   - roteiro da apresentação e LEIA-ME.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const out = join(root, 'dist-apresentacao');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1) Junta todos os módulos (tela, backend de demonstração e regras do servidor) num script só.
const js = await build({
  entryPoints: [join(web, 'js', 'main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
  // Os módulos do servidor ficam em ../../server a partir de web/js/demo (no pacote, ao lado de web).
  plugins: [{
    name: 'server-path',
    setup(b) {
      b.onResolve({ filter: /server\/src\// }, (a) => ({ path: resolve(a.resolveDir, a.path).replace(join(web, 'server'), join(root, 'server')) }));
    },
  }],
});
const script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

// 2) Página com CSS e logotipos embutidos.
const svg = (f) => `data:image/svg+xml;base64,${readFileSync(join(web, 'img', f)).toString('base64')}`;
let html = readFileSync(join(web, 'index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="css/app.css">', () => `<style>${readFileSync(join(web, 'css', 'app.css'), 'utf8')}</style>`)
  .replace(/img\/logo-menu\.svg/g, svg('logo-menu.svg'))
  .replace(/img\/logo\.svg/g, svg('logo.svg'))
  .replace(/<title>[^<]*<\/title>/, '<title>Áster Rental</title>')
  .replace('<script type="module" src="js/main.js"></script>', () => `<script>${script}</script>`);
if (/src="js\/|href="css\//.test(html)) throw new Error('Sobrou referência a arquivo externo na página.');
writeFileSync(join(out, 'Aster Rental.html'), html);

// 3) Abrir em http://localhost — Windows (PowerShell, sem instalar nada) e Mac.
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
writeFileSync(join(out, 'Abrir Aster Rental.cmd'), crlf(`@echo off
title Aster Rental - apresentacao
cd /d "%~dp0"
echo.
echo  Iniciando o Aster Rental em http://localhost ...
echo  Deixe esta janela aberta durante a apresentacao. Para encerrar, feche a janela.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1"
if errorlevel 1 (
  echo.
  echo  Nao foi possivel abrir o endereco local. Abrindo o arquivo direto no navegador...
  start "" "%~dp0Aster Rental.html"
  pause
)
`));
// PowerShell 5 lê .ps1 sem BOM como ANSI: grava com BOM e sem acentos nas mensagens.
writeFileSync(join(out, 'servidor.ps1'), `﻿${crlf(`# Servidor local do Aster Rental para apresentacao: publica "Aster Rental.html" em http://localhost:PORTA/
$ErrorActionPreference = 'Stop'
$pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
$pagina = [System.IO.File]::ReadAllBytes((Join-Path $pasta 'Aster Rental.html'))
$listener = $null
foreach ($p in 8080..8090) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l
    $porta = $p
    break
  } catch { }
}
if (-not $listener) { Write-Host 'Nenhuma porta livre entre 8080 e 8090.'; exit 1 }
$url = "http://localhost:$porta/"
Write-Host ''
Write-Host "  Aster Rental no ar: $url" -ForegroundColor Green
Write-Host '  Usuario: admin   Senha: Demo2026senha'
Write-Host ''
Start-Process $url
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $caminho = $ctx.Request.Url.AbsolutePath
    if ($caminho -eq '/' -or $caminho -eq '/index.html') {
      $res.ContentType = 'text/html; charset=utf-8'
      $res.Headers.Add('Cache-Control', 'no-store')
      $res.ContentLength64 = $pagina.Length
      $res.OutputStream.Write($pagina, 0, $pagina.Length)
    } else {
      $res.StatusCode = 404
    }
  } catch { } finally { $res.Close() }
}
`)}`);
const mac = join(out, 'Abrir Aster Rental (Mac).command');
writeFileSync(mac, `#!/bin/sh
# Abre o Aster Rental em http://localhost:8080 (usa o Python que vem no Mac; sem ele, abre o arquivo direto).
cd "$(dirname "$0")"
mkdir -p .servidor && cp "Aster Rental.html" .servidor/index.html
if command -v python3 >/dev/null 2>&1; then
  (sleep 1; open "http://localhost:8080/") &
  echo "Aster Rental em http://localhost:8080  (usuario admin / senha Demo2026senha). Feche esta janela para encerrar."
  cd .servidor && python3 -m http.server 8080 --bind 127.0.0.1
else
  open "Aster Rental.html"
fi
`);
chmodSync(mac, 0o755);

// 4) Roteiro e LEIA-ME.
copyFileSync(join(root, 'apresentacao', 'roteiro.html'), join(out, 'Roteiro da apresentacao.html'));
writeFileSync(join(out, 'LEIA-ME.txt'), crlf(`ÁSTER RENTAL — PACOTE DE APRESENTAÇÃO

Como abrir (escolha um):
  1) Windows: dois cliques em "Abrir Aster Rental.cmd".
     Abre o navegador em http://localhost:8080. Deixe a janela preta aberta durante a apresentação.
     Na primeira vez o Windows pode mostrar "O Windows protegeu o computador": clique em "Mais informações" e "Executar assim mesmo".
  2) Mac: dois cliques em "Abrir Aster Rental (Mac).command" (se o Mac bloquear: botão direito > Abrir).
  3) Qualquer computador: dois cliques em "Aster Rental.html". Funciona sem internet.

Entrar: usuário admin, senha Demo2026senha.

Os dados de demonstração são montados na primeira vez que o sistema abre e ficam guardados no navegador.
Para voltar ao começo antes da reunião: Administração > SAP B1 > "Restaurar dados de demonstração".

Roteiro passo a passo: "Roteiro da apresentacao.html".
`));

// 5) Zip para enviar.
const zip = join(root, 'Aster-Rental-apresentacao.zip');
rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-q', '-X', zip, '.'], { cwd: out });
console.log(`Pacote pronto: ${out}\nZip: ${zip} (${(readFileSync(zip).length / 1024).toFixed(0)} KB)`);
