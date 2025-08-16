// trigger: workflow release seed
// minor noop comment to trigger CI for release verification v6 (force bump logic active)
// Timers registro global para permitir limpieza en tests/deactivate
const _timers = [];
const _isTest = !!process.env.JEST_WORKER_ID;
const vscode = require('vscode');
const { startAgent, agentState, applyMemoryPlan, pauseAgent, resumeAgent, stopAgent, skipCurrentStep, regeneratePlan, manualAdvanceStep } = require('./agent');
const apiKeyStore = require('./apiKeyStore');
const { validateEnv } = require('./envValidation');
const https = require('https');
const cp = require('child_process');

function activate(context) {
    const output = vscode.window.createOutputChannel('Copilot Chief');
    output.appendLine('[activate] Iniciando extensión Copilot Chief');
    apiKeyStore.init(context);
    const disposable = vscode.commands.registerCommand('copilotChief.startAgent', async () => {
        output.appendLine('[command] startAgent invoked');
        // Precheck API key
        const storedKey = await apiKeyStore.getApiKey();
        if (!storedKey) {
            vscode.window.showErrorMessage('Configura tu OpenAI API Key antes de iniciar el agente.');
            return;
        }
        if (!vscode.workspace.workspaceFolders) { vscode.window.showErrorMessage('Abre primero una carpeta.'); return; }
        // Wizard: pick subfolders to scan
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const { listDirectories } = require('./directoryHelper');
        const dirs = listDirectories(root, 2);
        const picks = await vscode.window.showQuickPick(
            dirs.map(d => ({ label: d.rel || '.', picked: d.depth < 1, d })),
            { canPickMany: true, placeHolder: 'Selecciona carpetas relevantes a escanear (Enter para continuar)' }
        );
        if (!picks || picks.length === 0) { vscode.window.showWarningMessage('Operación cancelada (no seleccionaste carpetas)'); return; }
        const objective = await vscode.window.showInputBox({
            prompt: 'Escribe el objetivo general para el Agente Jefe de Copilot',
            placeHolder: 'Ej: Mejorar arquitectura y rendimiento de la extensión'
        });
        if (!objective) { output.appendLine('[command] cancelado sin objetivo'); return; }
        // Persist selection in memory meta early
        try {
            const { loadMemory, saveMemory } = require('./memoryManager');
            const mem = loadMemory(root);
            mem.meta = mem.meta || {};
            mem.meta.selectedDirs = picks.map(p => p.d.rel);
            saveMemory(root, mem);
        } catch {}
        output.appendLine('[command] objective recibido: ' + objective + ' | dirs: ' + picks.map(p=>p.d.rel).join(','));
        // Start agent (will still internally scan full project for now; refinement later to restrict)
        startAgent(objective);
        try { openStatusPanel(context); } catch {}
    });
    const manualUpdate = vscode.commands.registerCommand('copilotChief.checkUpdates', () => {
        checkForUpdate(output, context);
    });
    const forceUpdate = vscode.commands.registerCommand('copilotChief.forceUpdateNow', async () => {
        output.appendLine('[force-update] Forzando verificación + instalación');
        await checkForUpdate(output, { silentInstall: true, force: true });
        vscode.window.showInformationMessage('Forzado ciclo de actualización (si había versión nueva).');
    });
    const statusPanel = vscode.commands.registerCommand('copilotChief.statusPanel', () => openStatusPanel(context));
    const testKeyCmd = vscode.commands.registerCommand('copilotChief.testApiKey', async () => {
        const k = await apiKeyStore.getApiKey();
        if(!k){ vscode.window.showWarningMessage('No hay API Key configurada'); return; }
        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Probando clave OpenAI...' }, () => new Promise(res => {
            const https = require('https');
            const req = https.request({ hostname:'api.openai.com', path:'/v1/models', method:'GET', headers:{ Authorization:'Bearer '+k, 'User-Agent':'copilot-chief-agent' }}, r => {
                if(r.statusCode===200) vscode.window.showInformationMessage('Clave válida.');
                else if(r.statusCode===401) vscode.window.showErrorMessage('Clave inválida (401).');
                else vscode.window.showErrorMessage('HTTP '+r.statusCode);
                res();
            });
            req.on('error', e=>{ vscode.window.showErrorMessage('Error: '+e.message); res(); });
            req.setTimeout(6000, ()=>{ req.destroy(); vscode.window.showErrorMessage('Timeout probando clave'); res(); });
            req.end();
        }));
    });
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
    const commandsCmd = vscode.commands.registerCommand('copilotChief.commands', async () => {
        const st = agentState ? agentState() : { running:false, paused:false };
        const picks = [
            { label: '$(rocket) Iniciar Agente', cmd: 'copilotChief.startAgent', always:true },
            st.paused ? { label: '$(play) Reanudar Agente', cmd: 'copilotChief.resumeAgent' } : { label: '$(debug-pause) Pausar Agente', cmd: 'copilotChief.pauseAgent', enabled: st.running },
            st.running ? { label: '$(primitive-square) Detener Agente', cmd: 'copilotChief.stopAgent' } : null,
            st.running ? { label: '$(debug-step-over) Saltar Paso Actual', cmd: 'copilotChief.skipCurrentStep' } : null,
            { label: '$(sync) Regenerar Plan', cmd: 'copilotChief.regeneratePlan' },
            { label: '$(arrow-right) Siguiente Paso (manual)', cmd: 'copilotChief.nextStep' },
            { label: '$(graph) Panel de Estado', cmd: 'copilotChief.statusPanel' },
            { label: '$(beaker) Diagnóstico', cmd: 'copilotChief.diagnose' },
            { label: '$(key) Configurar API Key', cmd: 'copilotChief.setApiKey' },
            { label: '$(shield) Probar API Key', cmd: 'copilotChief.testApiKey' },
            { label: '$(sync) Buscar Actualizaciones', cmd: 'copilotChief.checkUpdates' },
            { label: '$(cloud-download) Forzar Update Ahora', cmd: 'copilotChief.forceUpdateNow' }
        ].filter(p => p && (p.always || p.enabled === undefined || p.enabled));
        const sel = await vscode.window.showQuickPick(picks, { placeHolder: 'Comandos Copilot Chief' });
        if (sel) vscode.commands.executeCommand(sel.cmd);
    });

    const pauseCmd = vscode.commands.registerCommand('copilotChief.pauseAgent', () => pauseAgent());
    const resumeCmd = vscode.commands.registerCommand('copilotChief.resumeAgent', () => resumeAgent());
    const stopCmd = vscode.commands.registerCommand('copilotChief.stopAgent', () => stopAgent());
    const skipCmd = vscode.commands.registerCommand('copilotChief.skipCurrentStep', () => skipCurrentStep());
    const regenCmd = vscode.commands.registerCommand('copilotChief.regeneratePlan', () => regeneratePlan());
    const nextCmd = vscode.commands.registerCommand('copilotChief.nextStep', () => manualAdvanceStep());

    context.subscriptions.push(disposable, manualUpdate, forceUpdate, diagnose, statusPanel, setKeyCmd, testKeyCmd, commandsCmd, pauseCmd, resumeCmd, stopCmd, skipCmd, regenCmd, nextCmd, output);
    output.appendLine('[activate] Comando registrado');

    // Chequeos de actualización omitidos en test para no dejar handles abiertos
    if (!_isTest) {
        const cfg = vscode.workspace.getConfiguration('copilotChief');
        if (cfg.get('autoUpdateCheck')) {
            scheduleUpdateChecks(cfg, output);
        }
        try {
            checkForUpdate(output, { silentInstall: true, force: true });
            _timers.push(setTimeout(() => checkForUpdate(output, { silentInstall: true, force: true }), 15000));
        } catch {}
    } else {
        output.appendLine('[test] Skip update cycle');
    }
    // Init status bar items
    initStatusBars(context);
    // Watch memory file for external edits to sync steps/objective
    if (vscode.workspace.workspaceFolders && !_isTest) {
        const memFile = vscode.workspace.workspaceFolders[0].uri.fsPath + '/.copilot-chief/state.json';
        try {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.workspace.workspaceFolders[0], '.copilot-chief/state.json'));
            const reload = (uri) => {
                const fs = require('fs');
                try {
                    if (!fs.existsSync(memFile)) return;
                    const raw = fs.readFileSync(memFile, 'utf8');
                    const json = JSON.parse(raw);
                    applyMemoryPlan(json);
                } catch {
                    // ignore parse errors silently for now
                }
            };
            watcher.onDidChange(reload);
            watcher.onDidCreate(reload);
            context.subscriptions.push(watcher);
        } catch {}
    }
    // Environment validation warnings
    (async () => {
        try {
            const key = await apiKeyStore.getApiKey();
            const warnings = validateEnv(key);
            if (warnings.length) {
                output.appendLine('[env] Advertencias de entorno:');
                warnings.forEach(w => output.appendLine('[env] - ' + w));
            } else {
                output.appendLine('[env] Entorno OK');
            }
    } catch { output.appendLine('[env] Error validando entorno'); }
    })();
}

function scheduleUpdateChecks(cfg, output) {
    if (process.env.JEST_WORKER_ID) { // evitar timers persistentes en tests
        output.appendLine('[update][test] Polling desactivado en entorno de test');
        return;
    }
    const run = () => checkForUpdate(output, { silentInstall: true });
    run();
    _timers.push(setTimeout(run, 30_000));
    _timers.push(setTimeout(run, 120_000));
    const minutes = cfg.get('updatePollMinutes');
    const base = Math.min(3, Math.max(1, minutes || 3));
    const ms = base * 60 * 1000;
    _timers.push(setInterval(run, ms));
    output.appendLine('[update] Polling forzado cada ' + base + ' min (silent)');
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
            let metaFeedback = ''; let lastSync='';
                        try { const fs = require('fs'); const path = require('path'); const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; if(root){ const memPath = path.join(root,'.copilot-chief','state.json'); if(fs.existsSync(memPath)){ const parsed = JSON.parse(fs.readFileSync(memPath,'utf8')); metaFeedback = parsed?.meta?.feedback || ''; lastSync = parsed?.meta?.lastSync || ''; } } } catch {}
                        const color = st.running ? '#16a34a' : (st.planning ? '#f59e0b' : '#6b7280');
                        const statusText = st.running ? 'En ejecución' : (st.planning ? 'Planificando' : 'Inactivo');
                        const remaining = (st.total>=0 && st.remaining>=0) ? `${st.total-st.remaining}/${st.total}` : '—';
                        panel.webview.html = `<!DOCTYPE html><html><head><meta charset='utf-8'><style>
                        body { font-family: system-ui, sans-serif; margin:0; padding:16px; background:#1e1e1e; color:#eee; }
                        .card { background:#252526; border:1px solid #333; border-radius:8px; padding:16px; }
                        h1 { font-size:16px; margin:0 0 12px; }
                        .status { display:flex; align-items:center; gap:8px; }
                        .dot { width:12px; height:12px; border-radius:50%; background:${color}; box-shadow:0 0 6px ${color}; }
                        .badge { display:inline-block; padding:2px 6px; font-size:10px; border-radius:4px; background:#444; margin-left:8px; }
                        .badge.ok { background:#2563eb; }
                        .badge.missing { background:#7f1d1d; }
                        .meta { margin-top:12px; font-size:12px; line-height:1.4; }
                        button { background:#0d6efd; color:#fff; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; }
                        button:hover { background:#1d78ff; }
                        .apikey { margin-top:16px; padding:12px; background:#1b1b1b; border:1px solid #333; border-radius:6px; }
                        .apikey h2 { margin:0 0 8px; font-size:13px; }
                        .apikey input { width:100%; background:#111; color:#eee; border:1px solid #444; padding:6px 8px; border-radius:4px; font-family:monospace; }
                        .apikey small { display:block; margin-top:6px; opacity:.6; line-height:1.3; }
                        </style></head><body>
                        <div class='card'>
                            <h1>Estado del Agente <span id='keyBadge' class='badge missing'>Key?</span></h1>
                            <div class='status'><div class='dot'></div><div><strong>${statusText}</strong></div></div>
                            <div class='meta'>
                                Objetivo: ${st.objective ? escapeHtml(st.objective) : '<em>No iniciado</em>'}<br/>
                                Progreso pasos: ${remaining}<br/>
                                Planificando: ${st.planning}<br/>
                                Ejecutando: ${st.running}<br/>
                                ${ metaFeedback ? `<span style='color:#93c5fd'>${escapeHtml(metaFeedback)}</span><br/>` : '' }
                                ${ lastSync ? `<span style='opacity:.6'>Sync: ${escapeHtml(lastSync)}</span>` : '' }
                            </div>
                            <div style='margin-top:14px;'>
                                <button onclick='vscode.postMessage({ cmd: "refresh" })'>Refrescar</button>
                                <button onclick='vscode.postMessage({ cmd: "openKeyPalette" })'>Cambiar API Key (InputBox)</button>
                            </div>
                                                        <div class='apikey'>
                                                                <h2>OpenAI API Key</h2>
                                                                <div id='keyBlock'>
                                                                    <input id='ak' type='password' placeholder='sk-...' />
                                                                    <div style='margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;'>
                                                                            <button onclick='saveKey()'>Guardar</button>
                                                                            <button onclick='toggle()'>Mostrar/Ocultar</button>
                                                                            <button onclick='testKey()'>Probar</button>
                                                                    </div>
                                                                    <div id='testResult' style='margin-top:6px; font-size:11px;'></div>
                                                                    <small>La clave se guarda en Secret Storage local. Vacía el campo y guarda para eliminarla.</small>
                                                                </div>
                                                                <div id='keySummary' style='display:none;'>
                                                                    <p style='font-size:12px; margin:0 0 8px;'>Clave configurada.</p>
                                                                    <button onclick='editKey()'>Cambiar / Ver</button>
                                                                    <button onclick='testKey()'>Probar</button>
                                                                    <button onclick='removeKey()'>Eliminar</button>
                                                                    <div id='testResult' style='margin-top:6px; font-size:11px;'></div>
                                                                </div>
                                                        </div>
                            <p style='margin-top:10px; font-size:11px; opacity:.7;'>Se actualiza automáticamente cada 5s.</p>
                        </div>
                        <script>
                            const vscode = acquireVsCodeApi();
                            setInterval(()=>vscode.postMessage({cmd:'refresh'}),5000);
                            window.addEventListener('message', e => { 
                               if(e.data.html){ document.documentElement.innerHTML = e.data.html; }
                               if(e.data.apiKeyPresent !== undefined){
                                   const input = document.getElementById('ak');
                                   if(e.data.apiKeyPresent){
                                       showSummary();
                                   } else {
                                       showInput();
                                   }
                                   updateKeyBadge(e.data.apiKeyPresent);
                               }
                               if(e.data.testResult){
                                   const el = document.getElementById('testResult');
                                   if(el){ el.textContent = e.data.testResult.message; el.style.color = e.data.testResult.ok ? '#16a34a' : '#ef4444'; }
                               }
                            });
                            function saveKey(){
                               const v = document.getElementById('ak').value.trim();
                               vscode.postMessage({ cmd:'saveApiKey', value: v });
                            }
                            function toggle(){
                               const i = document.getElementById('ak');
                               if(!i) return; i.type = i.type === 'password' ? 'text' : 'password';
                            }
                            function testKey(){ vscode.postMessage({ cmd:'testApiKey' }); }
                            function editKey(){ showInput(); const i=document.getElementById('ak'); if(i){ i.focus(); i.select(); } }
                            function removeKey(){ document.getElementById('ak').value=''; saveKey(); showInput(); }
                            function showSummary(){ const kb=document.getElementById('keyBlock'); const ks=document.getElementById('keySummary'); if(kb&&ks){ kb.style.display='none'; ks.style.display='block'; }}
                            function showInput(){ const kb=document.getElementById('keyBlock'); const ks=document.getElementById('keySummary'); if(kb&&ks){ kb.style.display='block'; ks.style.display='none'; }}
                            function updateKeyBadge(present){
                                const b = document.getElementById('keyBadge'); if(!b) return;
                                if(present){ b.textContent='Key OK'; b.classList.add('ok'); b.classList.remove('missing'); }
                                else { b.textContent='Sin Key'; b.classList.add('missing'); b.classList.remove('ok'); }
                            }
                            // Pedir estado inicial clave
                            vscode.postMessage({ cmd:'checkKey' });
                        </script>
                        </body></html>`;
                } catch (e) {
                        panel.webview.html = '<pre>Error renderizando estado: '+e.message+'</pre>';
                }
        };
        // escape html util (declared once)
        const escapeHtml = (s)=> s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
        panel.webview.onDidReceiveMessage(async msg => { 
            if (msg.cmd==='refresh') return render();
            if (msg.cmd==='checkKey') {
                const k = await apiKeyStore.getApiKey();
                panel.webview.postMessage({ apiKeyPresent: !!k });
            }
            if (msg.cmd==='saveApiKey') {
                const val = (msg.value||'').trim();
                if(!val){ await apiKeyStore.setApiKey(''); vscode.window.showInformationMessage('API Key eliminada'); }
                else {
                    await apiKeyStore.setApiKey(val);
                    vscode.window.showInformationMessage('API Key guardada.');
                }
                panel.webview.postMessage({ apiKeyPresent: !!val });
            }
            if (msg.cmd==='testApiKey') {
                const k = await apiKeyStore.getApiKey();
                if(!k){ panel.webview.postMessage({ testResult:{ ok:false, message:'No hay clave configurada.' } }); return; }
                try {
                    // Petición ligera a OpenAI models (HEAD no soporta; usamos GET con low timeout)
                    const https = require('https');
                    const req = https.request({
                        hostname: 'api.openai.com',
                        path: '/v1/models',
                        method: 'GET',
                        headers: { 'Authorization': 'Bearer ' + k, 'User-Agent':'copilot-chief-agent', 'Accept':'application/json' }
                    }, res => {
                        if(res.statusCode === 200){ panel.webview.postMessage({ testResult:{ ok:true, message:'Clave válida.' } }); }
                        else if(res.statusCode === 401){ panel.webview.postMessage({ testResult:{ ok:false, message:'Unauthorized: clave inválida.' } }); }
                        else panel.webview.postMessage({ testResult:{ ok:false, message:'HTTP '+res.statusCode } });
                    });
                    req.on('error', e=> panel.webview.postMessage({ testResult:{ ok:false, message:e.message } }));
                    req.setTimeout(6000, ()=>{ req.destroy(); panel.webview.postMessage({ testResult:{ ok:false, message:'Timeout' } }); });
                    req.end();
                } catch(e){ panel.webview.postMessage({ testResult:{ ok:false, message:e.message } }); }
            }
            if (msg.cmd==='openKeyPalette') {
                vscode.commands.executeCommand('copilotChief.setApiKey');
            }
        });
        render();
}

let statusBarAgent, statusBarKey, statusBarMenu, statusBarControl;
// Cache versión extensión
let _extVersion = null;
async function initStatusBars(context){
    if(!statusBarAgent){
        statusBarAgent = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarAgent.command = 'copilotChief.statusPanel';
        context.subscriptions.push(statusBarAgent);
    }
    if(!statusBarControl){
        // Dedicated pause/resume toggle. Higher priority so it appears just left of main label.
        statusBarControl = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
        context.subscriptions.push(statusBarControl);
    }
    if(!statusBarKey){
        statusBarKey = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        statusBarKey.command = 'copilotChief.setApiKey';
        context.subscriptions.push(statusBarKey);
    }
    if(!statusBarMenu){
        statusBarMenu = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
        statusBarMenu.command = 'copilotChief.commands';
        context.subscriptions.push(statusBarMenu);
    }
    const refresh = async () => {
        try {
            const st = agentState ? agentState() : { running:false, planning:false };
            let text = '$(robot) Chief';
            const total = st.total || 0; const done = total ? (total - st.remaining) : 0;
            const pct = total ? Math.min(100, Math.round((done/total)*100)) : 0;
            if(st.running) text += ` $(sync~spin) ${pct}%`;
            if(st.paused) text += ' ⏸';
            else if(st.planning) text += ' Plan';
            else if(!st.running) text += ' Idle';
            if(!_extVersion){ try { _extVersion = require('../package.json').version; } catch { _extVersion = '?'; } }
            text += ' v' + _extVersion;
            statusBarAgent.text = text;
            statusBarAgent.tooltip = `Estado del Agente\nObjetivo: ${st.objective || '—'}`;
            statusBarAgent.show();
            // Control button (pause/resume)
            if (st.running || st.paused) {
                if (st.paused) {
                    statusBarControl.text = '$(play)';
                    statusBarControl.tooltip = 'Reanudar Agente';
                    statusBarControl.command = 'copilotChief.resumeAgent';
                } else {
                    statusBarControl.text = '$(debug-pause)';
                    statusBarControl.tooltip = 'Pausar Agente';
                    statusBarControl.command = 'copilotChief.pauseAgent';
                }
                statusBarControl.show();
            } else {
                statusBarControl.hide();
            }
        } catch (e) {
            statusBarAgent.text = 'Chief: Err';
            statusBarAgent.tooltip = e.message;
        }
        try {
            const k = await apiKeyStore.getApiKey();
            statusBarKey.text = k ? '$(key) Key OK' : '$(key) Key?';
            statusBarKey.tooltip = k ? 'API Key configurada (clic para cambiar)' : 'Configurar API Key';
            statusBarKey.color = k ? undefined : '#f87171';
            statusBarKey.show();
        } catch {}
        statusBarMenu.text = '$(menu)';
        statusBarMenu.tooltip = 'Menú de comandos Copilot Chief';
        statusBarMenu.show();
    };
    if (process.env.JEST_WORKER_ID) {
        // En tests, ejecutar refresh una sola vez para no dejar handles abiertos
        refresh();
    } else {
        _timers.push(setInterval(refresh, 4000));
        refresh();
    }
}

function checkForUpdate(output, opts={}) {
    if (_isTest) return Promise.resolve();
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
                    let asset = (json.assets||[]).find(a => a.name && a.name.endsWith('.vsix'));
                    let tag = json.tag_name || '';
                    // Fallback: si el "latest" no tiene asset (p.ej. delay), buscar releases recientes y elegir la primera con vsix
                    const useFallback = !asset;
                    const handleVersion = (assetFound, tagFound) => {
                        const latestVer = (/copilot-chief-agent-(\d+\.\d+\.\d+)\.vsix/.exec(assetFound.name))?.[1] || tagFound.replace(/^.*v/, '');
                        // Si la versión local es mayor que la remota (p.ej. bump commit antes de que pipeline publique release), saltar.
                        if (isNewer(current, latestVer)) { // local > remote
                            output.appendLine(`[update] Local (${current}) > remote (${latestVer}) aún sin release: esperando pipeline.`);
                            return resolve();
                        }
                        output.appendLine(`[update] Versión local ${current} - remota ${latestVer}`);
                        if (assetFound && (opts.force || (latestVer && isNewer(latestVer, current)))) {
                            if (opts.silentInstall) {
                                output.appendLine('[update] Nueva versión ' + latestVer + ' detectada. Instalación silenciosa...');
                                downloadAndInstall(assetFound.browser_download_url, assetFound.name, output, latestVer).finally(resolve);
                            } else {
                                vscode.window.showInformationMessage(`Copilot Chief Agent ${latestVer} disponible. ¿Actualizar ahora?`, 'Actualizar', 'Omitir')
                                    .then(sel => {
                                        if (sel === 'Actualizar') {
                                            downloadAndInstall(assetFound.browser_download_url, assetFound.name, output, latestVer).finally(resolve);
                                        } else resolve();
                                    });
                            }
                        } else resolve();
                    };
                    if (useFallback) {
                        output.appendLine('[update] Release latest sin VSIX; buscando en lista de releases…');
                        const listOpts = { hostname:'api.github.com', path:'/repos/jagox1234/J.Automore/releases?per_page=10', headers:{ 'User-Agent':'copilot-chief-agent' } };
                        https.get(listOpts, r2 => {
                            let buf=''; r2.on('data',d=>buf+=d); r2.on('end',()=>{
                                try {
                                    if (r2.statusCode!==200){ output.appendLine('[update] fallback releases HTTP '+r2.statusCode); return resolve(); }
                                    const arr = JSON.parse(buf);
                                    const found = (arr||[]).find(rel => (rel.assets||[]).some(a=>a.name&&a.name.endsWith('.vsix')));
                                    if(!found){ output.appendLine('[update] Ningún release reciente tiene VSIX aún.'); return resolve(); }
                                    asset = found.assets.find(a=>a.name.endsWith('.vsix'));
                                    tag = found.tag_name || tag;
                                    handleVersion(asset, tag);
                                } catch(e){ output.appendLine('[update] fallback parse error '+e.message); resolve(); }
                            });
                        }).on('error',e=>{ output.appendLine('[update] fallback req error '+e.message); resolve(); });
                    } else {
                        handleVersion(asset, tag);
                    }
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
        const maxRedirects = 5;
        const fetchUrl = (theUrl, depth=0) => {
            const req = https.get(theUrl, res => {
                if (res.statusCode === 302 || res.statusCode === 301) {
                    const loc = res.headers.location;
                    if (!loc) { output.appendLine('[update] 302 sin Location'); return resolve(); }
                    if (depth >= maxRedirects) { output.appendLine('[update] Demasiados redirects'); return resolve(); }
                    output.appendLine('[update] Siguiendo redirect -> ' + loc);
                    res.resume();
                    return fetchUrl(loc, depth+1);
                }
                if (res.statusCode !== 200) { output.appendLine('[update] descarga HTTP ' + res.statusCode); return resolve(); }
            const file = fs.createWriteStream(filePath);
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    output.appendLine('[update] VSIX descargado en ' + filePath);
                    output.appendLine('[update][diag] PATH=' + process.env.PATH);
                    output.appendLine('[update][diag] execPath=' + process.execPath);
                    const attempts = [];
                    const path = require('path');
                    const exeDir = path.dirname(process.execPath);
                    if (process.platform.startsWith('win')) {
                        attempts.push(`code --install-extension "${filePath}" --force`);
                        attempts.push(`code.cmd --install-extension "${filePath}" --force`);
                        attempts.push(`"${path.join(exeDir,'bin','code.cmd')}" --install-extension "${filePath}" --force`);
                    } else {
                        attempts.push(`code --install-extension '${filePath}' --force`);
                        attempts.push(`${path.join(exeDir,'bin','code')} --install-extension '${filePath}' --force`);
                    }
                    let _installed = false; // underscore to indicate intentional unused
                    const tryNext = () => {
                        if (!attempts.length) {
                            output.appendLine('[update] No se pudo instalar automáticamente via CLI. Mostrando métodos manuales.');
                            manualFallback();
                            return resolve();
                        }
                        const cmd = attempts.shift();
                        output.appendLine('[update] Intentando instalación con: ' + cmd);
                        // Pequeña prueba previa (which/where)
                        try {
                            if (process.platform.startsWith('win')) {
                                cp.exec('where code', (e, so) => { if(!e) output.appendLine('[update][diag] where code -> ' + so.trim()); });
                            } else {
                                cp.exec('which code', (e, so) => { if(!e) output.appendLine('[update][diag] which code -> ' + so.trim()); });
                            }
                        } catch {}
                        cp.exec(cmd, { timeout: 20000 }, (err, stdout, stderr) => {
                            if (err) {
                                output.appendLine('[update] Falló comando: ' + err.message + (stderr? (' | ' + stderr):''));
                                return tryNext();
                            }
                            output.appendLine('[update] Instalación CLI OK. stdout: ' + (stdout||'')); _installed = true;
                            const verMsg = versionHint ? ' a ' + versionHint : '';
                            vscode.window.showInformationMessage('Copilot Chief actualizado' + verMsg + '. ¿Recargar ahora?', 'Recargar ahora', 'Luego')
                                .then(choice => { if (choice === 'Recargar ahora') vscode.commands.executeCommand('workbench.action.reloadWindow'); });
                            resolve();
                        });
                    };
                    const manualFallback = () => {
                        const uri = vscode.Uri.file(filePath);
                        vscode.window.showWarningMessage('No se pudo instalar automáticamente. Abriendo VSIX para instalación manual.', 'Abrir VSIX', 'Copiar Ruta')
                          .then(sel => {
                              if (sel === 'Abrir VSIX') {
                                  vscode.commands.executeCommand('vscode.open', uri);
                              } else if (sel === 'Copiar Ruta') {
                                  vscode.env.clipboard.writeText(filePath);
                                  vscode.window.showInformationMessage('Ruta copiada. Usa: Extensiones > ... > Instalar desde VSIX.');
                              }
                          });
                        // intento extra: abrir carpeta del archivo
                        try { vscode.env.openExternal(vscode.Uri.file(require('path').dirname(filePath))); } catch {}
                    };
                    tryNext();
                });
            });
            });
            req.on('error', e => { output.appendLine('[update] error descarga: ' + e.message); resolve(); });
        };
        fetchUrl(url);
    });
}

function deactivate() {
    while (_timers.length) {
        const t = _timers.pop();
        try { clearTimeout(t); clearInterval(t); } catch {}
    }
}

module.exports = { activate, deactivate };
