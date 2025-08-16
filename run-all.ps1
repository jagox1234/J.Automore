# PowerShell wrapper script: ejecutar cadena completa sin prompts
# Ajusta los comandos a tus necesidades. Usa flags no interactivos (-y, --yes, --no-audit, etc.)
# Para abortar en el primer error, habilita $ErrorActionPreference = 'Stop'
$ErrorActionPreference = 'Stop'

Write-Host '== Step 1: Pull (rebase/autostash) =='
git pull --rebase --autostash

Write-Host '== Step 2: Instalar dependencias sin auditorías ni fondos =='
npm install --no-audit --no-fund

Write-Host '== Step 3: Tests en modo silencioso =='
npm test --silent

Write-Host '== Step 4: Empaquetar extensión (si vsce instalado) =='
if (Get-Command vsce -ErrorAction SilentlyContinue) {
  npm run package
} else {
  Write-Host 'vsce no encontrado, omitiendo package'
}

Write-Host '== Step 5: Mostrar estado git =='
git status --short

Write-Host 'Pipeline local finalizado.'
