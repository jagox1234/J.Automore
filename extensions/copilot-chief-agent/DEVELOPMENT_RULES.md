# Reglas Básicas de Desarrollo - Copilot Chief Agent

Estas reglas deben leerse antes de iniciar cualquier trabajo y cumplirse antes de crear una nueva versión o merge a `main`.

## 1. Flujo General de Trabajo
1. Crear rama feature/fix: `git checkout -b feat/descripcion-corta`.
2. Implementar cambios con commits pequeños y mensajes claros (convencional commits preferido: feat:, fix:, chore:, docs:, refactor:, test:, perf:).
3. Actualizar/añadir tests si se introduce lógica nueva o se modifica comportamiento.
4. Ejecutar verificación local: `npm run verify` (lint + tests).
5. Si se modifica la API pública / comandos / configuración: actualizar `CHANGELOG.md` y (si aplica) README.
6. Abrir PR (no push directo a main salvo emergencia).
7. Asegurar verde CI (lint + jest); sin bajar cobertura crítica (<70% global, objetivo mantener >80%).
8. Revisión y squash/merge.

## 2. Reglas de Calidad Previas a Release
- Obligatorio: `npm run lint` sin errores (0 warnings bloqueantes añadidos en config).
- Obligatorio: `npm test -- --ci` exitoso.
- Cobertura mínima global actual: Lines/Statements/Functions >=70%, Branches >=50%. Intentar subir hacia >=80% (no introducir regresiones grandes).
- No dejar archivos nuevos sin tests si contienen lógica (excepto UI directa VSCode: `extension-main.js`, `stepsView.js`, helpers experimentales).
- `CHANGELOG.md`: cada versión nueva debe tener sección `## vX.Y.Z - YYYY-MM-DD` con bullets de Added/Changed/Fixed/Internal cuando proceda.
- Version bump: sólo cuando la funcionalidad real cambia o se publica VSIX. No incrementar versión en commits triviales internos.

## 3. Gestión de Versionado
- SemVer simplificado (MAJOR.MINOR.PATCH). Por ahora usamos increments de PATCH.
- Bump manual antes de publicar si se añaden features; CI también puede ajustar si detecta discrepancias.
- Tags formateados: `copilot-chief-agent-vX.Y.Z`.

## 4. Actualizaciones Automáticas / Update System
- Al cambiar lógica del updater (`checkForUpdates`, descarga VSIX, integridad) añadir prueba manual: ejecutar comandos `Buscar Actualizaciones` y `Forzar Instalación` en entorno de desarrollo.
- Si se añade asset VSIX nuevo: asegurar hash .sha256 presente si `updateIntegrityEnforce` se va a usar.

## 5. Command Bridge y Seguridad
- Nunca ampliar whitelist (`allowedCommands`) con comandos destructivos.
- Revisar patrones bloqueados (`blockedCommands`) si se introducen nuevas herramientas.
- Tests de bridge deben cubrir: ejecución permitida, bloqueo, timeout y resultado truncado.

## 6. Estándares de Código
- Sin variables no usadas (ESLint debe capturarlo).
- Evitar lógica pesada dentro de listeners sin throttling.
- Mantener funciones < ~120 líneas; extraer helpers.
- Nombres de eventos feed con prefijos consistentes: `agent.*`, `bridge.*`, `openai.*`, `evt-*` (internos UI).

## 7. Manejo de Errores
- Usar try/catch alrededor de IO/FS/Red; loguear con `logDiag(scope, data)` cuando aporte valor.
- No silenciar errores críticos: si una operación clave falla (p.ej. escribir memoria), notificar al usuario.

## 8. Lógica de Plan y Pasos
- Garantizar que `markStepComplete` sólo se llama tras detectar contenido no trivial (no comentarios) — mantener tests correspondientes.
- Evitar loops infinitos: contador `_repeatCounter` no debe eliminarse.

## 9. Demo Mode
- Cambios a `runDemo` requieren verificar que no escribe fuera de `.copilot-chief/`.
- Demo no debe llamar a OpenAI.

## 10. Performance / Recursos
- Limitar buffers del feed (actualmente recorte a 2000 líneas → mantener).
- Polling mínimo Command Bridge 5s; no bajar por debajo salvo debug puntual.

## 11. Archivos y Estructura
- No reintroducir lógica en `extension.js` (legacy stub). Todo en `extension-main.js`.
- Nuevos módulos en `src/` deben exportar funciones puras testeables cuando sea posible.

## 12. Publicación VSIX
- Antes de `vsce package`: `npm run verify`.
- Confirmar inclusión de `icon` y ausencia de archivos pesados innecesarios (logs, coverage, snapshots) en el paquete.

## 13. Seguridad Claves API
- Nunca hardcodear claves. Uso de `OPENAI_API_KEY` (secrets) o settings seguros.
- No escribir claves en logs / feed.

## 14. Convenciones de Mensajes Feed
- `pushLiveFeed(type, msg)` debe sanitizar HTML — no eliminar escapes.
- No incluir payloads gigantes (>500 chars) sin truncar.

## 15. Trabajo Futuro (Mantener visible)
- Añadir tests para updater (simulación de redirect + hash mismatch).
- Incrementar cobertura de diagnostics.
- Migración progresiva a TypeScript con tipos para plan y steps.

## 16. Checklist Pre-Merge Rápido
- [ ] Lint OK
- [ ] Tests OK
- [ ] Cobertura >= thresholds
- [ ] CHANGELOG actualizado (si aplica)
- [ ] Version bump sólo si release
- [ ] Sin secretos expuestos
- [ ] Feed y updater manual smoke test (si tocados)

---
Mantén este archivo actualizado cuando cambien procesos o herramientas.
