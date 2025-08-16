## Contribuir al Proyecto Copilot Chief Agent

Lee primero `DEVELOPMENT_RULES.md` para las reglas operativas detalladas.

### Flujo básico
1. Crea una rama feature/fix.
2. Implementa cambios pequeños y testeables.
3. Ejecuta: `npm run verify` (lint + tests).
4. Actualiza `CHANGELOG.md` si el comportamiento visible cambia.
5. Abre PR; espera CI verde.
6. Merge (squash o rebase) una vez aprobado.

### Estilo de commits
Usa convencional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `perf:`.

### Tests
Añade o ajusta tests para cualquier lógica nueva. Evita introducir código no cubierto en módulos core.

### Releases
Sólo incrementar versión al preparar un release real (VSIX / tag). Sigue checklist en `DEVELOPMENT_RULES.md`.

### Dudas
Si una regla no aplica, documenta la excepción en la PR (sección "Justificación").

Gracias por contribuir.
