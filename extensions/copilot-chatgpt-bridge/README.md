# Copilot + ChatGPT Bridge

Extensión que conecta GitHub Copilot con ChatGPT añadiendo:

- Objetivo global del proyecto
- Indexado de código (resumen de archivos .js/.ts/.jsx/.tsx)
- Memoria persistente entre sesiones
- Resumen automático de la conversación (≥20 mensajes)
- Resumen manual bajo demanda
- Reindex manual
- Métricas de memoria

## Comandos
- `Copilot Bridge: Open Panel` – Abre panel para definir objetivo y plan.
- `Copilot Bridge: Reindex Project` – Releer archivos y regenerar contexto.
- `Copilot Bridge: Summarize Memory Now` – Forzar resumen inmediato.
- `Copilot Bridge: Show Metrics` – Ver número de mensajes y tamaño aproximado.

## Flujo
1. Abre el panel y escribe el objetivo → se inserta plan como comentarios.
2. Copilot genera código; cuando introduce preguntas (heurística: `?`, `should`, etc.) la extensión pregunta a ChatGPT.
3. ChatGPT responde e inserta comentarios orientando a Copilot.
4. Cuando la memoria crece se resume automáticamente preservando decisiones clave.

## Configuración
En `settings.json` agrega:
```json
{
  "copilotBridge.openaiApiKey": "sk-...",
  "copilotBridge.model": "gpt-4o-mini",
  "copilotBridge.insertMode": "comment"
}
```

## Desarrollo
Instalar dependencias y compilar en watch:
```bash
npm install
npm run watch
```
Luego F5 en VS Code para abrir un Extension Development Host.

## Limitaciones / Próximos pasos
- Detección heurística de preguntas de Copilot (se puede mejorar usando inline completions API si se abre).
- Indexado estático (no reactualiza en cada cambio salvo comando manual).
- No hay streaming de tokens todavía.
- Falta filtrado semántico del índice para prompts largos.

## Seguridad
La API Key se mantiene en la configuración de usuario de VS Code. No se sube a repos.

## Licencia
MIT
