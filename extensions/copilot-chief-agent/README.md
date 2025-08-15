# Copilot Chief Agent

Agente autónomo que coordina a GitHub Copilot para ejecutar un objetivo de desarrollo paso a paso.

## Flujo
1. Proporcionas un objetivo general.
2. El agente escanea el proyecto (archivos de código principales <= ~200KB total).
3. Genera un plan de pasos (máx 15) orientados a commits atómicos.
4. Inserta cada paso como comentario para que Copilot proponga código.
5. Detecta preguntas en el código ("?", "¿", patrones de duda) y responde automáticamente.
6. Marca cada paso como completado al detectar código nuevo y avanza al siguiente.
7. Finaliza cuando no quedan pasos.

## Comando
- "Copilot Chief: Iniciar Agente" (`copilotChief.startAgent`)

## Configuración
- `copilotChief.openaiApiKey`: API Key de OpenAI (requerida).
- `copilotChief.model`: Modelo (por defecto `gpt-4o-mini`).
- `copilotChief.maxPlanSteps`: Límite de pasos en plan inicial (soft; el prompt lo sugiere al modelo).

## Limitaciones
- No usa API oficial de Copilot. Interactúa insertando comentarios.
- El escaneo se limita en tamaño y omite carpetas pesadas (`node_modules`, `dist`, etc.).
- No hay rollback automático si Copilot genera código incorrecto.

## Próximas Mejores (ideas)
- Panel de control con progreso y edición de pasos.
- Replanificación dinámica si falla un paso.
- Modo "dry-run" que solo simula instrucciones.
- Persistencia detallada de cada diff aplicado.
- Integración con Git para commits automáticos por paso.

## Uso
1. Configura tu API Key en la configuración de la extensión.
2. Ejecuta el comando e introduce un objetivo.
3. Abre un archivo relevante para que el agente inserte instrucciones.
4. Observa cómo avanza paso a paso.

## Seguridad
La API Key se lee desde configuración de usuario. Considerar migrar a Secret Storage.
