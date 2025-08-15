# J.Automore

Automatiza la generación de instrucciones de mejora (para usar con GitHub Copilot) analizando archivos de tu repositorio mediante la API de OpenAI.

## 🚀 Características
- Lee un archivo del repositorio vía GitHub API.
- Envía el contenido al modelo `gpt-4o-mini`.
- Devuelve una lista priorizada de mejoras sugeridas (stdout).
- Workflow opcional que comenta automáticamente en Pull Requests.

## 📦 Instalación local

1. Clona el repo.
2. Crea el archivo `.env` a partir de `.env.example` y rellena:
   - `OPENAI_API_KEY` (obligatorio)
   - `GITHUB_REPO` (formato `owner/name`, obligatorio)
   - `GITHUB_TOKEN` (opcional para ampliar rate limit / repos privados; en Actions se inyecta automáticamente)
3. Instala dependencias:

```powershell
npm install
```

## ▶️ Uso básico

Analizar `App.js` (por defecto busca ese archivo):

```powershell
npm run bot
```

Analizar otro archivo:

```powershell
node bot.js --file src/index.js
```

Salida: se imprimen instrucciones listas para copiar en VS Code y guiar a Copilot.

## 🤖 GitHub Actions (modo automático)
El workflow `auto-instructions.yml` se ejecuta en cada `push` y en cada `pull_request`. Para habilitarlo:

1. Añade el secret `OPENAI_API_KEY` en: Settings > Secrets and variables > Actions.
2. Ajusta el nombre del archivo objetivo en el paso "Run bot" si no es `App.js`.
3. Al abrir o actualizar un PR, el bot comentará con las instrucciones.

## 🔐 Seguridad
- No expongas tu API key (no la pegues en issues, comentarios ni commits).
- Si una clave se divulga, ROTAR inmediatamente (revoca y genera una nueva).
- `.env` está en `.gitignore`; verifica antes de commitear.
- Usa `secrets.OPENAI_API_KEY` en GitHub Actions (ya configurado en workflows).
- `GITHUB_TOKEN` integrado de Actions basta para repos públicos/privados con permisos limitados; evita crear un PAT amplio.

## 🛠 Personalización
- Cambia el modelo u opciones (temperatura, etc.) en `bot.js`.
- Adapta el prompt para enfocarte en rendimiento, seguridad, estilo, etc.
- Itera sobre múltiples archivos extendiendo el script (ej. leer lista desde JSON).

## ❗️Errores comunes
- `Missing required environment variables`: revisa tu `.env`.
- `GitHub API error (404)`: revisa la ruta del archivo o branch/visibilidad.
- Respuesta vacía: puede ser un problema temporal de la API; reintenta.

## 📄 Licencia
MIT
