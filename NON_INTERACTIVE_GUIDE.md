# Ejecución No Interactiva (PowerShell / VS Code / Command Bridge)

## 1. Encadenar comandos en una sola invocación PowerShell
Ejemplo rápido (no se detiene en errores intermedios):
```
powershell -NoLogo -NoProfile -Command "git pull --rebase --autostash; npm install --no-audit --no-fund; npm test --silent"
```
Abortar ante el primer error añadiendo:
```
$ErrorActionPreference = 'Stop'
```
O usar `cmd.exe` con `&&`:
```
cmd /c "git pull --rebase --autostash && npm install --no-audit --no-fund && npm test --silent"
```

## 2. Script wrapper (`run-all.ps1`)
Edita `run-all.ps1` para tu pipeline y lánzalo:
```
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\run-all.ps1
```
Evita prompts manuales eliminando líneas: `pause`, `Read-Host`, `Start-Sleep` innecesarios.

## 3. Tareas de VS Code (`.vscode/tasks.json`)
Tarea principal: `Chief: Full Pipeline`. Abre la paleta (Ctrl+Shift+P) → Run Task.
Encadenamiento mediante `dependsOn` ejecuta sin intervención.

## 4. Flags no interactivas recomendadas
- git: `--rebase --autostash`, `-y` en algunas extensiones
- npm: `--no-audit --no-fund --yes` (si script requiere confirmación)
- npm publish: `--access public --yes`

## 5. Forzar respuesta a prompts heredados
Si un comando exige confirmación y no tiene flag:
```
'Y' | someCommand
```
O para múltiples entradas:
```
@("Y","Y") | someCommand
```

## 6. Command Bridge (Copilot Chief)
Añade al whitelist (`copilotChief.allowedCommands`) regex que cubran tus comandos preparados sin interacción. Ejemplo en settings.json:
```
"copilotChief.allowedCommands": [
  "^git pull",
  "^npm install",
  "^npm test",
  "^npm run package"
]
```
Asegúrate de remover `pause` / `Read-Host` de cualquier wrapper.

## 7. Eliminar “Press any key to continue…”
Proviene de `pause` en `.bat`. Crea copia sin `pause` y ejecuta esa, o sustituye en tu script.

## 8. Validación rápida
1. Ejecuta `run-all.ps1`.
2. Revisa salida: no debe aparecer ningún prompt.
3. Añade comando nuevo → repite.

## 9. Integración con snapshots
Antes y después de la secuencia puedes correr `Copilot Chief: Capturar Snapshot Diagnóstico` para auditar el estado.

## 10. Problemas comunes
| Síntoma | Causa | Solución |
|--------|-------|----------|
| Se detiene esperando tecla | `pause` oculto en script | Buscar y eliminar `pause` |
| Se queda colgado en publish | Falta `--yes` | Añadir flag no interactiva |
| Command Bridge rechaza comando | Regex whitelist no coincide | Ajustar `allowedCommands` con ancla `^` |

---
Checklist: sin prompts, flags silenciosos, whitelist actualizada, logs en diagnostics si algo se bloquea.
