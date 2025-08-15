// trigger: workflow release seed
// minor noop comment to trigger CI for release verification v5
const vscode = require('vscode');
const { startAgent, agentState } = require('./agent');
const apiKeyStore = require('./apiKeyStore');
const https = require('https');
const cp = require('child_process');

function activate(context) {
    const output = vscode.window.createOutputChannel('Copilot Chief');
    output.appendLine('[activate] Iniciando extensión Copilot Chief');
    apiKeyStore.init(context);
    const disposable = vscode.commands.registerCommand('copilotChief.startAgent', async () => {
        output.appendLine('[command] startAgent invoked');
        const objective = await vscode.window.showInputBox({
            prompt: 'Escribe el objetivo general para el Agente Jefe de Copilot',
            placeHolder: 'Ej: Implementar autenticación JWT con refresco de tokens'
        });
        if (objective) {
            output.appendLine('[command] objective recibido: ' + objective);
            startAgent(objective);
            // Abrir panel de estado automáticamente
            try { openStatusPanel(context); } catch {}
        } else {
            output.appendLine('[command] cancelado sin objetivo');
        }
    });
    const manualUpdate = vscode.commands.registerCommand('copilotChief.checkUpdates', () => {
        checkForUpdate(output, context);
    });
    const statusPanel = vscode.commands.registerCommand('copilotChief.statusPanel', () => openStatusPanel(context));
    const setKeyCmd = vscode.commands.registerCommand('copilotChief.setApiKey', async () => {
        const existing = await apiKeyStore.getApiKey();
        const val = await vscode.window.showInputBox({
            prompt: 'Introduce tu OpenAI API Key',
            placeHolder: 'sk-...',
            password: true,
            value: existing || ''
        });
        if (val) {
            await apiKeyStore.setApiKey(val);
            vscode.window.showInformationMessage('API Key guardada de forma segura (Secret Storage).');
        } else {
            vscode.window.showWarningMessage('No se guardó ninguna clave.');
        }
    });
    const diagnose = vscode.commands.registerCommand('copilotChief.diagnose', async () => {
        const cfg = vscode.workspace.getConfiguration('copilotChief');
        const issues = [];
        if (!process.env.OPENAI_API_KEY && !cfg.get('openaiApiKey')) issues.push('Falta OPENAI_API_KEY (env o setting).');
        if (!vscode.workspace.workspaceFolders) issues.push('No hay carpeta abierta.');
        // Check code CLI
        await new Promise(r => {
            cp.exec('code --version', (err) => { if (err) issues.push('CLI code no disponible en PATH (no habrá auto update silent).'); r(); });
        });
        // Version info
        const pkg = require('../package.json');
        const summary = `Versión local: ${pkg.version}`;
        if (issues.length === 0) {
            vscode.window.showInformationMessage('Diagnóstico OK. ' + summary);
        } else {
            vscode.window.showErrorMessage('Problemas: ' + issues.join(' | ') + ' | ' + summary);
        }
    });
    context.subscriptions.push(disposable, manualUpdate, diagnose, statusPanel, setKeyCmd, output);
    output.appendLine('[activate] Comando registrado');

    // Chequeo de actualización
    const cfg = vscode.workspace.getConfiguration('copilotChief');
    if (cfg.get('autoUpdateCheck')) {
        scheduleUpdateChecks(cfg, output);
    }
    // Init status bar item
    initStatusBar(context);
}

function scheduleUpdateChecks(cfg, output) {
    const run = () => checkForUpdate(output, { silentInstall: cfg.get('autoUpdateSilent') });
    run(); // initial
    const minutes = cfg.get('updatePollMinutes');
    if (minutes > 0) {
        const ms = Math.max(1, minutes) * 60 * 1000;
        setInterval(run, ms);
        output.appendLine('[update] Polling cada ' + minutes + ' min');
    }
}

function openStatusPanel(context) {
        const panel = vscode.window.createWebviewPanel(
                'copilotChiefStatus',
                'Copilot Chief - Estado',
                vscode.ViewColumn.Beside,
                { enableScripts: true }
        );
        const render = () => {
                try {
                        const st = agentState ? agentState() : { running:false, planning:false };
                        const color = st.running ? '#16a34a' : (st.planning ? '#f59e0b' : '#6b7280');
                        const statusText = st.running ? 'En ejecución' : (st.planning ? 'Planificando' : 'Inactivo');
                        const remaining = (st.total>=0 && st.remaining>=0) ? `${st.total-st.remaining}/${st.total}` : '—';
                        panel.webview.html = `<!DOCTYPE html><html><head><meta charset='utf-8'><style>
                        body { font-family: system-ui, sans-serif; margin:0; padding:16px; background:#1e1e1e; color:#eee; }
                        .card { background:#252526; border:1px solid #333; border-radius:8px; padding:16px; }
                        h1 { font-size:16px; margin:0 0 12px; }
                        .status { display:flex; align-items:center; gap:8px; }
                        .dot { width:12px; height:12px; border-radius:50%; background:${color}; box-shadow:0 0 6px ${color}; }
                        .meta { margin-top:12px; font-size:12px; line-height:1.4; }
                        button { background:#0d6efd; color:#fff; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; }
                        button:hover { background:#1d78ff; }
                        </style></head><body>
                        <div class='card'>
                            <h1>Estado del Agente</h1>
                            <div class='status'><div class='dot'></div><div><strong>${statusText}</strong></div></div>
                            <div class='meta'>
                                Objetivo: ${st.objective ? escapeHtml(st.objective) : '<em>No iniciado</em>'}<br/>
                                Progreso pasos: ${remaining}<br/>
                                Planificando: ${st.planning}<br/>
                                Ejecutando: ${st.running}
                            </div>
                            <div style='margin-top:14px;'>
                                <button onclick='vscode.postMessage({ cmd: "refresh" })'>Refrescar</button>
                            </div>
                            <p style='margin-top:10px; font-size:11px; opacity:.7;'>Se actualiza automáticamente cada 5s.</p>
                        </div>
                        <script>
                            const vscode = acquireVsCodeApi();
                            setInterval(()=>vscode.postMessage({cmd:'refresh'}),5000);
                            window.addEventListener('message', e => { if(e.data.html){ document.documentElement.innerHTML = e.data.html; } });
                        </script>
                        </body></html>`;
                } catch (e) {
                        panel.webview.html = '<pre>Error renderizando estado: '+e.message+'</pre>';
                }
        };
        const escapeHtml = (s)=> s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
        panel.webview.onDidReceiveMessage(msg => { if (msg.cmd==='refresh') render(); });
        render();
}

let statusBarItem;
function initStatusBar(context){
    if(!statusBarItem){
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    // Debe coincidir con el ID registrado en package.json
    statusBarItem.command = 'copilotChief.statusPanel';
        context.subscriptions.push(statusBarItem);
    }
    const refresh = () => {
        try {
            const st = agentState ? agentState() : { running:false, planning:false };
            let text = '$(robot) Chief: ';
            if(st.running) text += '$(sync~spin) Run';
            else if(st.planning) text += 'Plan';
            else text += 'Idle';
            statusBarItem.text = text;
            statusBarItem.tooltip = `Estado del Agente\nObjetivo: ${st.objective || '—'}`;
            statusBarItem.show();
        } catch (e) {
            statusBarItem.text = 'Chief: Err';
            statusBarItem.tooltip = e.message;
        }
    };
    setInterval(refresh, 4000);
    refresh();
}

function checkForUpdate(output, opts={}) {
    return new Promise((resolve) => {
        const pkg = require('../package.json');
        const current = pkg.version;
        const options = {
            hostname: 'api.github.com',
            path: '/repos/jagox1234/J.Automore/releases/latest',
            headers: { 'User-Agent': 'copilot-chief-agent' }
        };
    https.get(options, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
            if (res.statusCode === 404) { output.appendLine('[update] No hay releases publicados aún (404).'); return resolve(); }
            if (res.statusCode !== 200) { output.appendLine('[update] HTTP ' + res.statusCode); return resolve(); }
                    const json = JSON.parse(data);
                    const asset = (json.assets||[]).find(a => a.name && a.name.endsWith('.vsix'));
                    const tag = json.tag_name || '';
                    const latestVer = (asset && /copilot-chief-agent-(\d+\.\d+\.\d+)\.vsix/.exec(asset.name))?.[1] || tag.replace(/^.*v/, '');
                    output.appendLine(`[update] Versión local ${current} - remota ${latestVer}`);
                                if (latestVer && isNewer(latestVer, current) && asset) {
                                                if (opts.silentInstall) {
                                    output.appendLine('[update] Nueva versión ' + latestVer + ' detectada. Instalación silenciosa...');
                                    downloadAndInstall(asset.browser_download_url, asset.name, output, latestVer).finally(resolve);
                                                } else {
                                                        vscode.window.showInformationMessage(`Copilot Chief Agent ${latestVer} disponible. ¿Actualizar ahora?`, 'Actualizar', 'Omitir')
                                                            .then(sel => {
                                                                if (sel === 'Actualizar') {
                                        downloadAndInstall(asset.browser_download_url, asset.name, output, latestVer).finally(resolve);
                                                                } else resolve();
                                                            });
                                                }
                    } else resolve();
                } catch (e) { output.appendLine('[update] parse error ' + e.message); resolve(); }
            });
        }).on('error', err => { output.appendLine('[update] req error ' + err.message); resolve(); });
    });
}

function isNewer(a, b) {
    const pa = a.split('.').map(n=>parseInt(n,10));
    const pb = b.split('.').map(n=>parseInt(n,10));
    for (let i=0;i<3;i++) { if (pa[i]>pb[i]) return true; if (pa[i]<pb[i]) return false; }
    return false;
}

function downloadAndInstall(url, name, output, versionHint) {
    return new Promise((resolve) => {
        const filePath = require('path').join(require('os').tmpdir(), name);
        output.appendLine('[update] Descargando ' + url);
        const fs = require('fs');
        const req = https.get(url, res => {
            if (res.statusCode !== 200) { output.appendLine('[update] descarga HTTP ' + res.statusCode); return resolve(); }
            const file = fs.createWriteStream(filePath);
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    output.appendLine('[update] Instalando VSIX ' + filePath);
                    try {
                        // Usa CLI de VS Code. Debe existir 'code' en PATH.
                        const cmd = process.platform.startsWith('win') ? `code --install-extension "${filePath}" --force` : `code --install-extension '${filePath}' --force`;
                        cp.exec(cmd, (err, stdout, stderr) => {
                            if (err) {
                                output.appendLine('[update] error instalación: ' + (stderr||err.message));
                            } else {
                                output.appendLine('[update] Instalado. Reinicia la ventana para aplicar.');
                                const verMsg = versionHint ? ' a ' + versionHint : '';
                                vscode.window.showInformationMessage('Copilot Chief actualizado' + verMsg + '. ¿Recargar ahora?', 'Recargar ahora', 'Luego')
                                  .then(choice => { if (choice === 'Recargar ahora') { vscode.commands.executeCommand('workbench.action.reloadWindow'); } });
                            }
                            resolve();
                        });
                    } catch(e) { output.appendLine('[update] excepción instalación: ' + e.message); resolve(); }
                });
            });
        });
        req.on('error', e => { output.appendLine('[update] error descarga: ' + e.message); resolve(); });
    });
}

function deactivate() {}

module.exports = { activate, deactivate };
