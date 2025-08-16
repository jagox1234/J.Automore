// trigger: workflow release seed
// minor noop comment to trigger CI for release verification v6 (force bump logic active)
// Timers registro global para permitir limpieza en tests/deactivate
const _timers = [];
const _isTest = !!process.env.JEST_WORKER_ID;
const vscode = require('vscode');
const { startAgent, agentState, applyMemoryPlan, pauseAgent, resumeAgent, stopAgent, skipCurrentStep, regeneratePlan, manualAdvanceStep } = require('./agent');
const { processBridge, openBridgeFile } = require('./commandBridge');
const apiKeyStore = require('./apiKeyStore');
const { validateEnv } = require('./envValidation');
const https = require('https');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');
let _testConsoleSessions = new Map(); // panelId -> { transcript: [] }
// Diagnostics
const { initDiagnostics, logDiag, toggleDiagnostics, openDiagnosticsFile } = require('./diagnostics');
// Live feed globals
let _liveFeedPanel = null; let _liveFeedBuffer = [];

function activate(context) {
    const output = vscode.window.createOutputChannel('Copilot Chief');
    const activity = vscode.window.createOutputChannel('Copilot Chief Activity');
    try { if(vscode.workspace.workspaceFolders){ initDiagnostics(vscode.workspace.workspaceFolders[0].uri.fsPath); } } catch {}
    const logActivity = (type, msg) => {
        const ts = new Date().toISOString().slice(11,19);
        activity.appendLine(`[${ts}] [${type}] ${msg}`);
        try { logDiag('activity', { type, msg }); } catch {}
        try { pushLiveFeed(type, msg); } catch {}
    };
    output.appendLine('[activate] Iniciando extensión Copilot Chief');
    try { logDiag('lifecycle.activate', {}); } catch {}
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
        try {
            const cfg = vscode.workspace.getConfiguration('copilotChief');
            if(cfg.get('liveFeedAutoOpen')){ vscode.commands.executeCommand('copilotChief.liveFeed'); }
        } catch {}
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
    const quickStatus = vscode.commands.registerCommand('copilotChief.quickStatus', () => {
        try {
            const st = agentState ? agentState() : { running:false, planning:false };
            const msg = `Estado: ${st.running? (st.paused? 'Pausado':'En ejecución') : (st.planning? 'Planificando':'Inactivo')} | Objetivo: ${st.objective||'—'} | Pasos: ${st.total?(st.total-st.remaining)+'/'+st.total:'—'}`;
            vscode.window.showInformationMessage(msg);
        } catch(e){ vscode.window.showWarningMessage('Estado no disponible: '+e.message); }
    });
    const openRequests = vscode.commands.registerCommand('copilotChief.openRequests', () => {
        if(!vscode.workspace.workspaceFolders){ return vscode.window.showWarningMessage('Abre una carpeta para usar el bridge.'); }
        openBridgeFile(vscode.workspace.workspaceFolders[0].uri.fsPath);
    });
    const consoleCmd = vscode.commands.registerCommand('copilotChief.console', () => { activity.show(true); });
    const diagOpenCmd = vscode.commands.registerCommand('copilotChief.openDiagnostics', () => { try { openDiagnosticsFile(); } catch {} });
    const diagToggleCmd = vscode.commands.registerCommand('copilotChief.toggleDiagnostics', () => { try { toggleDiagnostics(); } catch {} });
    const dumpStateCmd = vscode.commands.registerCommand('copilotChief.dumpState', () => {
        try {
            const st = agentState ? agentState() : {};
            logDiag('debug.dumpState', st);
            output.appendLine('[dumpState] '+JSON.stringify(st));
            vscode.window.showInformationMessage('Estado volcado a salida y diagnostics.');
        } catch(e){ vscode.window.showErrorMessage('Error dumpState: '+e.message); }
    });
    const snapshotCmd = vscode.commands.registerCommand('copilotChief.captureSnapshot', async () => {
        try {
            if(!vscode.workspace.workspaceFolders){ return vscode.window.showWarningMessage('Sin workspace'); }
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const memPath = path.join(root,'.copilot-chief','state.json');
            let memoryRaw='', memoryJson=null;
            try { if(fs.existsSync(memPath)){ memoryRaw = fs.readFileSync(memPath,'utf8'); try { memoryJson = JSON.parse(memoryRaw); } catch {} } } catch {}
            // Tail diagnostics log (last 200 lines)
            const diagFile = path.join(root,'.copilot-chief','diagnostics.log');
            let diagnosticsTail='';
            try { if(fs.existsSync(diagFile)){ const lines = fs.readFileSync(diagFile,'utf8').trim().split(/\r?\n/); diagnosticsTail = lines.slice(-200).join('\n'); } } catch {}
            const bridgeFile = path.join(root,'.copilot-chief','requests.json');
            let bridgeRaw='';
            try { if(fs.existsSync(bridgeFile)){ bridgeRaw = fs.readFileSync(bridgeFile,'utf8'); } } catch {}
            const st = agentState ? agentState() : {};
            const snapshot = {
                ts: new Date().toISOString(),
                state: st,
                memory: memoryJson,
                memoryRawLength: memoryRaw.length,
                diagnosticsTailLines: (diagnosticsTail.match(/\n/g)||[]).length+ (diagnosticsTail?1:0),
                bridgeRaw,
            };
            const outDir = path.join(root,'.copilot-chief','snapshots');
            fs.mkdirSync(outDir, { recursive:true });
            const file = path.join(outDir,'snapshot-'+new Date().toISOString().replace(/[:T]/g,'-').slice(0,19)+'.json');
            fs.writeFileSync(file, JSON.stringify(snapshot,null,2),'utf8');
            logDiag('snapshot.created', { file });
            output.appendLine('[snapshot] creado '+file);
            vscode.window.showInformationMessage('Snapshot creado: '+path.basename(file));
            const doc = await vscode.workspace.openTextDocument(file); vscode.window.showTextDocument(doc,{preview:false});
        } catch(e){ vscode.window.showErrorMessage('Error snapshot: '+e.message); }
    });
    const autoEnqueueCmd = vscode.commands.registerCommand('copilotChief.enqueueBridgePipeline', async () => {
        try {
            if(!vscode.workspace.workspaceFolders){ return vscode.window.showWarningMessage('Sin workspace'); }
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const file = path.join(root, '.copilot-chief', 'requests.json');
            fs.mkdirSync(path.dirname(file), { recursive:true });
            let list = [];
            try { if(fs.existsSync(file)) list = JSON.parse(fs.readFileSync(file,'utf8')); } catch {}
            const now = Date.now();
            const base = [
                'git pull --rebase --autostash',
                'npm install --no-audit --no-fund',
                'npm test --silent'
            ];
            try { const pkg = require('../package.json'); if(pkg.scripts && pkg.scripts.package){ base.push('npm run package'); } } catch {}
            const pendingOrRunning = new Set(list.filter(r=>['pending','running'].includes(r.status)).map(r=>r.command));
            for(const [i,cmd] of base.entries()){
                if(pendingOrRunning.has(cmd)) continue;
                list.push({ id: 'auto-'+(now+i), command: cmd, status: 'pending', createdAt: new Date(now+i).toISOString() });
            }
            fs.writeFileSync(file, JSON.stringify(list,null,2),'utf8');
            vscode.window.showInformationMessage('Bridge: comandos encolados ('+base.length+').');
            logDiag('bridge.autoEnqueue', { count: base.length });
            logActivity('bridge','auto enqueue '+base.length+' cmds');
            try { processBridge(root, output, logActivity); } catch {}
        } catch(e){ vscode.window.showErrorMessage('Error enqueue: '+e.message); }
    });
    const liveFeedCmd = vscode.commands.registerCommand('copilotChief.liveFeed', () => {
        if(_liveFeedPanel){ try { _liveFeedPanel.reveal(); return; } catch { _liveFeedPanel = null; }}
        _liveFeedPanel = vscode.window.createWebviewPanel('copilotChiefLiveFeed','Copilot Chief - Feed en Vivo', vscode.ViewColumn.Active, { enableScripts:true, retainContextWhenHidden:true });
                const html = `<!DOCTYPE html><html><head><meta charset='utf-8'/><style>
        body{margin:0;font-family:system-ui,sans-serif;background:#111;color:#eee;}
        header{padding:10px 16px;background:#1e1e1e;border-bottom:1px solid #333;display:flex;align-items:center;gap:12px;}
                h1{font-size:15px;margin:0;} button{background:#0d6efd;color:#fff;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:12px;} button:hover{background:#1d78ff;}
                .filters{margin-left:auto;display:flex;gap:6px;align-items:center;font-size:11px;}
                .filters label{display:flex;gap:4px;align-items:center;}
        #log{font-family:monospace;font-size:11px;line-height:1.35;padding:10px;max-height:calc(100vh - 54px);overflow:auto;white-space:pre-wrap;}
        .line{padding:2px 4px;border-left:3px solid transparent;margin-bottom:2px;}
        .evt-agent{border-color:#2563eb;background:#1e293b;} .evt-bridge{border-color:#d97706;background:#3b2f1e;} .evt-openai{border-color:#9333ea;background:#312042;} .evt-info{border-color:#4b5563;background:#1f2429;}
        .ts{opacity:.55;margin-right:4px;} .tag{display:inline-block;font-size:10px;padding:0 4px;margin-right:4px;border-radius:3px;background:#444;}
                </style></head><body><header><h1>Feed en Vivo</h1><button onclick='clearLog()'>Limpiar</button><button onclick='pause()' id='pp'>Pausar</button><div class='filters'>
                <label><input type='checkbox' id='fAgent' checked/>agent</label>
                <label><input type='checkbox' id='fBridge' checked/>bridge</label>
                <label><input type='checkbox' id='fOpenAI' checked/>openai</label>
                <label><input type='checkbox' id='fInfo' checked/>info</label>
                </div></header><div id='log'></div>
        <script>
    const vscode = acquireVsCodeApi(); let paused=false; function esc(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c));}
        function add(l){ if(paused) return; const el=document.getElementById('log'); el.insertAdjacentHTML('afterbegin', l); if(el.children.length>1200){ for(let i=el.children.length-1;i>1000;i--) el.removeChild(el.children[i]); }}
        function clearLog(){ document.getElementById('log').innerHTML=''; }
        function pause(){ paused=!paused; document.getElementById('pp').textContent = paused? 'Reanudar':'Pausar'; }
                function allowed(cat){
                    return (cat==='evt-agent' && document.getElementById('fAgent').checked) ||
                                 (cat==='evt-bridge' && document.getElementById('fBridge').checked) ||
                                 (cat==='evt-openai' && document.getElementById('fOpenAI').checked) ||
                                 (cat==='evt-info' && document.getElementById('fInfo').checked);
                }
    window.addEventListener('message', e=>{ if(e.data.kind==='batch'){ e.data.items.forEach(html=>{ const m=/class="line ([^ "]+)"/.exec(html)||[]; if(allowed(m[1]||'')) add(html); }); } else if(e.data.kind==='line'){ const m=/class="line ([^ "]+)"/.exec(e.data.html)||[]; if(allowed((m[1]||''))) add(e.data.html); } });
        </script></body></html>`;
        _liveFeedPanel.webview.html = html;
        // Seed existing buffer
        if(_liveFeedBuffer.length){ _liveFeedPanel.webview.postMessage({ kind:'batch', items:_liveFeedBuffer.slice(-200) }); }
        _liveFeedPanel.onDidDispose(()=>{ _liveFeedPanel=null; });
    });
        const testConsoleCmd = vscode.commands.registerCommand('copilotChief.testConsole', () => {
                const panel = vscode.window.createWebviewPanel('copilotChiefTestConsole','Copilot Chief - Consola de Pruebas', vscode.ViewColumn.Active, { enableScripts:true });
                    _testConsoleSessions.set(panel.id, { transcript: [] });
            const htmlTest = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
                <style>
                body{font-family:system-ui,sans-serif;margin:0;background:#1e1e1e;color:#eee;}
                header{padding:10px 16px;background:#252526;border-bottom:1px solid #333;}h1{margin:0;font-size:15px;}
                    .toolbar{display:flex;gap:10px;align-items:center;padding:6px 12px;background:#202124;border-bottom:1px solid #333;font-size:12px;}
                    .toolbar label{display:flex;align-items:center;gap:4px;cursor:pointer;}
                    main{display:flex;height:calc(100vh - 188px);} .col{flex:1;display:flex;flex-direction:column;border-right:1px solid #333;} .col:last-child{border-right:none;}
                .col header{background:#202124;} textarea{flex:1;background:#111;color:#eee;border:none;padding:8px;font-family:monospace;resize:none;font-size:12px;outline:none;}
                .actions{display:flex;gap:6px;padding:8px;background:#252526;border-top:1px solid #333;}button{background:#0d6efd;border:none;color:#fff;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:12px;}button.alt{background:#444;}button:hover{background:#1d78ff;}button.alt:hover{background:#555;}
                    .log{height:180px;overflow:auto;background:#111;font-size:11px;padding:6px;border-top:1px solid #333;font-family:monospace;line-height:1.3;} .tag{font-size:10px;padding:2px 4px;border-radius:3px;margin-right:4px;background:#2563eb;} .tag.b{background:#d97706;} .tag.q{background:#9333ea;} .tag.r{background:#16a34a;} .tag.ai{background:#0ea5e9;}
                    .meta{font-size:10px;opacity:.6;margin-left:auto;}
                </style></head><body>
                <header><h1>Consola de Pruebas (Doble Interacción)</h1></header>
                    <div class='toolbar'>
                        <label><input type='checkbox' id='autoAns'/> Auto-responder (OpenAI)</label>
                        <button onclick='exportar()'>Exportar</button>
                        <button onclick='limpiarLog()' class='alt'>Limpiar Log</button>
                        <span class='meta' id='status'>Listo</span>
                    </div>
                <main>
                    <div class='col'>
                        <header><strong>Actor A (emite)</strong></header>
                        <textarea id='aInput' placeholder='Acción / pregunta hacia B...'></textarea>
                        <div class='actions'>
                            <button onclick='emitA()'>Enviar a B</button>
                            <button class='alt' onclick='clearA()'>Limpiar</button>
                        </div>
                    </div>
                    <div class='col'>
                        <header><strong>Actor B (responde)</strong></header>
                        <textarea id='bInput' placeholder='Respuesta o pregunta hacia A...'></textarea>
                        <div class='actions'>
                            <button onclick='emitB()'>Enviar a A</button>
                            <button class='alt' onclick='clearB()'>Limpiar</button>
                        </div>
                    </div>
                </main>
                <div class='log' id='log'></div>
                <script>
                const vscode = acquireVsCodeApi();
                function log(html){ const el=document.getElementById('log'); el.innerHTML += html; el.scrollTop = el.scrollHeight; }
                function sanitize(s){ const m={}; m['&']='&amp;'; m['<']='&lt;'; m['>']='&gt;'; m['"']='&quot;'; m["'"]='&#39;'; return s.replace(/[&<>"']/g,c=>m[c]||c); }
            function emitA(){ const v=document.getElementById('aInput').value.trim(); if(!v) return; const isQ=/[?¿]$/.test(v); log('<div><span class="tag'+(isQ?' q':'')+'">A→B'+(isQ?'?':'')+'</span>'+sanitize(v)+'</div>'); vscode.postMessage({kind:'a2b', value:v, question:isQ}); }
            function emitB(){ const v=document.getElementById('bInput').value.trim(); if(!v) return; const isQ=/[?¿]$/.test(v); log('<div><span class="tag b'+(isQ?' q':'')+'">B→A'+(isQ?'?':'')+'</span>'+sanitize(v)+'</div>'); vscode.postMessage({kind:'b2a', value:v, question:isQ}); }
                function clearA(){ document.getElementById('aInput').value=''; }
                function clearB(){ document.getElementById('bInput').value=''; }
            function exportar(){ vscode.postMessage({ kind:'export' }); }
            function limpiarLog(){ document.getElementById('log').innerHTML=''; vscode.postMessage({ kind:'clear' }); }
                window.addEventListener('message', e => {
                       if(e.data.kind==='a2b'){ log('<div><span class="tag r">Resp A</span>'+sanitize(e.data.value)+'</div>'); }
                       if(e.data.kind==='b2a'){ log('<div><span class="tag r">Resp B</span>'+sanitize(e.data.value)+'</div>'); }
               if(e.data.kind==='auto'){ log('<div><span class="tag ai">AI</span>'+sanitize(e.data.value)+'</div>'); }
               if(e.data.kind==='status'){ const s=document.getElementById('status'); if(s) s.textContent=e.data.value; }
                });
                </script>
            </body></html>`;
            panel.webview.html = htmlTest;
            panel.webview.onDidReceiveMessage(msg => {
                        try { logDiag('testConsole.message', { kind: msg.kind, q: !!msg.question }); } catch {}
                        // Por ahora eco simple; se podría integrar con agente para respuestas automáticas
                const session = _testConsoleSessions.get(panel.id);
                const push = (entry) => { if(session){ session.transcript.push(entry); } };
                if(msg.kind==='a2b'){
                    push({ from:'A', to:'B', text:msg.value, question:!!msg.question, ts:Date.now() });
                    if(!msg.question){ panel.webview.postMessage({ kind:'a2b', value: 'ACK A:'+ msg.value.slice(0,60) }); push({ from:'SYS', to:'A', text:'ACK A:'+msg.value.slice(0,60), ts:Date.now() }); }
                    else if(isAutoResponderEnabled(panel)) { handleAutoAnswer(panel, 'B', msg.value, session); }
                }
                if(msg.kind==='b2a'){
                    push({ from:'B', to:'A', text:msg.value, question:!!msg.question, ts:Date.now() });
                    if(!msg.question){ panel.webview.postMessage({ kind:'b2a', value: 'ACK B:'+ msg.value.slice(0,60) }); push({ from:'SYS', to:'B', text:'ACK B:'+msg.value.slice(0,60), ts:Date.now() }); }
                    else if(isAutoResponderEnabled(panel)) { handleAutoAnswer(panel, 'A', msg.value, session); }
                }
                if(msg.kind==='export'){
                    exportTranscript(panel).catch(e=> panel.webview.postMessage({ kind:'status', value:'Error export: '+e.message }));
                }
                if(msg.kind==='clear'){
                    if(session) session.transcript = [];
                }
                });
            panel.onDidDispose(()=>{ _testConsoleSessions.delete(panel.id); });
    });
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

    context.subscriptions.push(disposable, manualUpdate, forceUpdate, diagnose, statusPanel, quickStatus, setKeyCmd, testKeyCmd, commandsCmd, pauseCmd, resumeCmd, stopCmd, skipCmd, regenCmd, nextCmd, openRequests, consoleCmd, testConsoleCmd, output, activity, diagOpenCmd, diagToggleCmd, dumpStateCmd, snapshotCmd, autoEnqueueCmd, liveFeedCmd);
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

    // Command Bridge polling
    if(!_isTest && vscode.workspace.workspaceFolders){
        try {
            const cfg = vscode.workspace.getConfiguration('copilotChief');
            if(cfg.get('enableCommandBridge')){
                const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const interval = Math.max(5, parseInt(cfg.get('commandPollingSeconds')||15,10));
                const run = () => processBridge(root, output, logActivity);
                run();
                _timers.push(setInterval(run, interval*1000));
                output.appendLine('[bridge] Activado polling cada '+interval+'s');
                logActivity('bridge','poll cycle scheduled '+interval+'s');
                try { logDiag('bridge.init', { interval }); } catch {}
            }
        } catch(e){ output.appendLine('[bridge] error iniciando bridge: '+e.message); }
    }
}

function isAutoResponderEnabled(panel){
    // Query webview state by sending a script snippet? Simpler: we toggle via last message; for now assume checkbox state tracked by DOM not accessible.
    // Workaround: we embed a hidden state send when user toggles - not implemented yet: treat always enabled if API key exists.
    // Future improvement: add postMessage from webview on toggle. For now we'll skip if no API key.
    return true; // simplified
}

async function handleAutoAnswer(panel, targetActor, questionText, session){
    try {
        panel.webview.postMessage({ kind:'status', value:'Consultando OpenAI...' });
        const { askChatGPT } = require('./openaiClient');
        const cfg = vscode.workspace.getConfiguration('copilotChief');
        const key = cfg.get('openaiApiKey') || process.env.OPENAI_API_KEY || '';
        if(!key){ panel.webview.postMessage({ kind:'status', value:'Sin API Key' }); return; }
        // Build short context from last 6 exchanges
        const recent = (session?.transcript||[]).slice(-6).map(e=>`${e.from}->${e.to}: ${e.text}`).join('\n');
        const answer = await askChatGPT(`Eres un asistente técnico conciso. Conversación reciente:\n${recent}\nPregunta dirigida a ${targetActor}: ${questionText}\nResponde en <=4 líneas.`);
        panel.webview.postMessage({ kind: targetActor==='A' ? 'a2b' : 'b2a', value: answer.trim() });
        panel.webview.postMessage({ kind:'auto', value: answer.trim() });
        session.transcript.push({ from:'AI', to:targetActor, text:answer.trim(), ts:Date.now() });
        panel.webview.postMessage({ kind:'status', value:'Listo' });
    } catch(e){ panel.webview.postMessage({ kind:'status', value:'Error AI: '+e.message }); }
}

async function exportTranscript(panel){
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if(!root) throw new Error('Sin workspace');
    const session = _testConsoleSessions.get(panel.id);
    if(!session || !session.transcript.length) throw new Error('Nada que exportar');
    const exporter = require('./testConsoleExporter');
    const md = exporter.formatTranscriptMD(session.transcript);
    const fileName = 'test-console-'+ new Date().toISOString().replace(/[:T]/g,'-').slice(0,19) + '.md';
    const filePath = path.join(root, '.copilot-chief', fileName);
    fs.mkdirSync(path.dirname(filePath), { recursive:true });
    fs.writeFileSync(filePath, md, 'utf8');
    panel.webview.postMessage({ kind:'status', value:'Exportado '+fileName });
    vscode.window.showInformationMessage('Transcript exportado: '+fileName);
    const doc = await vscode.workspace.openTextDocument(filePath);
    vscode.window.showTextDocument(doc, { preview:false });
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

let statusBarAgent, statusBarKey, statusBarMenu, statusBarControl, statusBarActivity, statusBarTest;
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
    if(!statusBarActivity){
        statusBarActivity = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
        statusBarActivity.command = 'copilotChief.console';
        context.subscriptions.push(statusBarActivity);
    }
    if(!statusBarTest){
        statusBarTest = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
        statusBarTest.command = 'copilotChief.testConsole';
        context.subscriptions.push(statusBarTest);
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
            // Siempre visible: estado según ejecución
            if (st.paused) {
                statusBarControl.text = '$(play)';
                statusBarControl.tooltip = 'Reanudar Agente';
                statusBarControl.command = 'copilotChief.resumeAgent';
            } else if (st.running) {
                statusBarControl.text = '$(debug-pause)';
                statusBarControl.tooltip = 'Pausar Agente';
                statusBarControl.command = 'copilotChief.pauseAgent';
            } else {
                statusBarControl.text = '$(play)';
                statusBarControl.tooltip = 'Iniciar Agente';
                statusBarControl.command = 'copilotChief.startAgent';
            }
            statusBarControl.show();
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
    statusBarActivity.text = '$(output)';
    statusBarActivity.tooltip = 'Abrir Consola de Actividad Copilot Chief';
    statusBarActivity.show();
    statusBarTest.text = '$(beaker)';
    statusBarTest.tooltip = 'Abrir Consola de Pruebas Doble Interacción';
    statusBarTest.show();
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
    try { logDiag('lifecycle.deactivate', {}); } catch {}
    while (_timers.length) {
        const t = _timers.pop();
        try { clearTimeout(t); clearInterval(t); } catch {}
    }
}

function pushLiveFeed(type, msg){
    const ts = new Date().toISOString().slice(11,19);
    let cat='evt-info';
    if(/^agent\./.test(type)) cat='evt-agent'; else if(/^bridge/.test(type)) cat='evt-bridge'; else if(/^openai\./.test(type)) cat='evt-openai';
    const safe = (msg||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
    const html = `<div class="line ${cat}"><span class="ts">${ts}</span><span class="tag">${type}</span>${safe}</div>`;
    _liveFeedBuffer.push(html); if(_liveFeedBuffer.length>2000) _liveFeedBuffer = _liveFeedBuffer.slice(-1500);
    if(_liveFeedPanel){ try { _liveFeedPanel.webview.postMessage({ kind:'line', html }); } catch {} }
}

// CodeLens provider para marcar pasos manualmente
vscode.languages.registerCodeLensProvider({ pattern:'**/*.{js,ts,jsx,tsx}' }, {
    provideCodeLenses(document){
        const cfg = vscode.workspace.getConfiguration('copilotChief');
        if(!cfg.get('showCodeLens')) return [];
        const lenses = [];
        const re = /Copilot Chief Paso: (.+)/g;
        for(let i=0;i<document.lineCount;i++){
            const line = document.lineAt(i).text;
            let m = re.exec(line);
            if(m){
                lenses.push(new vscode.CodeLens(new vscode.Range(i,0,i,line.length), { title:'✔ Completar', command:'copilotChief.skipCurrentStep' }));
                lenses.push(new vscode.CodeLens(new vscode.Range(i,0,i,line.length), { title:'↷ Regenerar Plan', command:'copilotChief.regeneratePlan' }));
            }
            re.lastIndex=0;
        }
        return lenses;
    }
});

module.exports = { activate, deactivate };
