// Clean entrypoint extracted to avoid legacy corruption in original extension.js
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { startAgent, agentState, applyMemoryPlan, pauseAgent, resumeAgent, stopAgent, skipCurrentStep, regeneratePlan, manualAdvanceStep } = require('./agent');
const { openBridgeFile, processBridge } = require('./commandBridge');
const apiKeyStore = require('./apiKeyStore');
const { initDiagnostics, logDiag, toggleDiagnostics, openDiagnosticsFile } = require('./diagnostics');
const { StepsTreeDataProvider } = require('./stepsView');
// (Removed direct https import; using dynamic require in fetchJson)
const cp = require('child_process');
let _updateInterval=null;
let _lastUpdateCheckTs=0; let _lastUpdateVersionNotified='';

const _timers = [];
const _isTest = !!process.env.JEST_WORKER_ID;
let _liveFeedPanel=null, _liveFeedBuffer=[]; let _stepsTree=null, _rootPath='';
let _lastStepStartTs=null, _durations=[]; let _demoRunning=false,_demoSteps=[],_demoCompleted=0,_demoTimer=null; let _extVersion=null;

function activate(context){
	const output = vscode.window.createOutputChannel('Copilot Chief');
	const activity = vscode.window.createOutputChannel('Copilot Chief Activity');
	context.subscriptions.push(output, activity); apiKeyStore.init(context);
	try{ if(vscode.workspace.workspaceFolders){ initDiagnostics(vscode.workspace.workspaceFolders[0].uri.fsPath);} }catch{}
	context.subscriptions.push(
		vscode.commands.registerCommand('copilotChief.startAgent', async ()=>{ const key=await apiKeyStore.getApiKey(); if(!key){ vscode.window.showErrorMessage('Configura tu OpenAI API Key.'); return;} if(!vscode.workspace.workspaceFolders){ vscode.window.showErrorMessage('Abre una carpeta.'); return;} _rootPath=vscode.workspace.workspaceFolders[0].uri.fsPath; const objective=await vscode.window.showInputBox({prompt:'Objetivo',placeHolder:'Ej: Mejorar arquitectura'}); if(!objective)return; const cfg=vscode.workspace.getConfiguration('copilotChief'); if(cfg.get('demoMode')){ runDemo(objective,_rootPath,output);} else { startAgent(objective); _lastStepStartTs=Date.now(); } if(cfg.get('liveFeedAutoOpen')) vscode.commands.executeCommand('copilotChief.liveFeed'); }),
    vscode.commands.registerCommand('copilotChief.quickStatus', ()=>{ try{ const st=agentState(); const done=st.total? (st.total-st.remaining):0; const msg=`Estado: ${st.running?(st.paused?'Pausado':'En ejecución'):(st.planning?'Planificando':'Inactivo')} • Pasos ${done}/${st.total||'—'} • Objetivo: ${st.objective||'—'}`; vscode.window.showInformationMessage(msg);}catch{ vscode.window.showWarningMessage('Estado no disponible'); } }),
		vscode.commands.registerCommand('copilotChief.liveFeed', openFeed),
		vscode.commands.registerCommand('copilotChief.exportLiveFeed', exportFeed),
    vscode.commands.registerCommand('copilotChief.checkUpdates', ()=>checkForUpdates({manual:true, force:false})),
    vscode.commands.registerCommand('copilotChief.forceUpdateNow', ()=>checkForUpdates({manual:true, force:true, forceInstall:true})),
    vscode.commands.registerCommand('copilotChief.selfTest', ()=>autoSelfTest(output)),
    vscode.commands.registerCommand('copilotChief.installLatestRelease', ()=>checkForUpdates({ manual:true, force:true, forceInstall:true, includePrere:false })),
    vscode.commands.registerCommand('copilotChief.installLatestPrerelease', ()=>checkForUpdates({ manual:true, force:true, forceInstall:true, includePrere:true })),
		vscode.commands.registerCommand('copilotChief.pauseAgent', ()=>pauseAgent()),
		vscode.commands.registerCommand('copilotChief.resumeAgent', ()=>resumeAgent()),
		vscode.commands.registerCommand('copilotChief.stopAgent', ()=>stopAgent()),
		vscode.commands.registerCommand('copilotChief.skipCurrentStep', ()=>skipCurrentStep()),
		vscode.commands.registerCommand('copilotChief.regeneratePlan', ()=>regeneratePlan()),
		vscode.commands.registerCommand('copilotChief.nextStep', ()=>manualAdvanceStep()),
		vscode.commands.registerCommand('copilotChief.openRequests', ()=>{ if(!vscode.workspace.workspaceFolders){ return vscode.window.showWarningMessage('Abre una carpeta para usar el bridge.'); } openBridgeFile(vscode.workspace.workspaceFolders[0].uri.fsPath); }),
		vscode.commands.registerCommand('copilotChief.openDiagnostics', ()=>{ try{ openDiagnosticsFile(); }catch{} }),
		vscode.commands.registerCommand('copilotChief.toggleDiagnostics', ()=>{ try{ toggleDiagnostics(); }catch{} }),
		vscode.commands.registerCommand('copilotChief.dumpState', ()=>{ try{ logDiag('debug.dumpState',agentState()); vscode.window.showInformationMessage('Estado volcado.'); }catch(err){ vscode.window.showErrorMessage(String(err));} }),
		vscode.commands.registerCommand('copilotChief.captureSnapshot', ()=>snapshot(output)),
		vscode.commands.registerCommand('copilotChief.__internalStepCompleted', stepCompletedInternal)
	);
	try{ _stepsTree=new StepsTreeDataProvider(agentState,()=>_rootPath); vscode.window.registerTreeDataProvider('copilotChiefStepsView',_stepsTree);}catch{}
	if(vscode.workspace.workspaceFolders&&!_isTest){ _rootPath=vscode.workspace.workspaceFolders[0].uri.fsPath; const memFile=path.join(_rootPath,'.copilot-chief','state.json'); try{ const watcher=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.workspace.workspaceFolders[0],'.copilot-chief/state.json')); const reload=()=>{ try{ if(!fs.existsSync(memFile)) return; const raw=fs.readFileSync(memFile,'utf8'); applyMemoryPlan(JSON.parse(raw)); if(_stepsTree)_stepsTree.refresh(); }catch{} }; watcher.onDidChange(reload); watcher.onDidCreate(reload); context.subscriptions.push(watcher);}catch{} }

  // Command Bridge polling
  if(vscode.workspace.workspaceFolders&&!_isTest){
    const poll = ()=>{ try{ if(!_rootPath) return; processBridge(_rootPath, output, (scope,msg)=>{ pushLiveFeed('bridge.'+scope, msg); if(/error /.test(msg) && vscode.workspace.getConfiguration('copilotChief').get('playSoundOnError')){ vscode.window.setStatusBarMessage('\u0007',80);} }); }catch{} };
    const sec = Math.max(5, parseInt(vscode.workspace.getConfiguration('copilotChief').get('commandPollingSeconds')||15,10));
    _timers.push(setInterval(poll, sec*1000));
    setTimeout(poll, 3000);
  }
	initStatusBar(context);

  // Schedule automatic update checks based on settings
  try{ scheduleAutoUpdateChecks(context); }catch{}
	vscode.languages.registerCodeLensProvider({pattern:'**/*.{js,ts,jsx,tsx}'},{ provideCodeLenses(doc){ const cfg=vscode.workspace.getConfiguration('copilotChief'); if(!cfg.get('showCodeLens')) return []; const lenses=[]; const re=/Copilot Chief Paso: (.+)/g; for(let i=0;i<doc.lineCount;i++){ const line=doc.lineAt(i).text; let m=re.exec(line); if(m){ lenses.push(new vscode.CodeLens(new vscode.Range(i,0,i,line.length),{title:'✔ Completar',command:'copilotChief.skipCurrentStep'})); lenses.push(new vscode.CodeLens(new vscode.Range(i,0,i,line.length),{title:'↷ Regenerar Plan',command:'copilotChief.regeneratePlan'})); } re.lastIndex=0;} return lenses; } });
}

// Feed
function openFeed(){ if(_liveFeedPanel){ try{_liveFeedPanel.reveal();return;}catch{_liveFeedPanel=null;} } const html=feedHtml(); _liveFeedPanel=vscode.window.createWebviewPanel('copilotChiefLiveFeed','Copilot Chief - Feed',vscode.ViewColumn.Active,{enableScripts:true,retainContextWhenHidden:true}); _liveFeedPanel.webview.html=html; if(_liveFeedBuffer.length) _liveFeedPanel.webview.postMessage({kind:'batch',items:_liveFeedBuffer.slice(-200)}); _liveFeedPanel.onDidDispose(()=>_liveFeedPanel=null); }
function exportFeed(){ try{ const root=_rootPath||vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; if(!root) return; const file=path.join(root,'.copilot-chief','feed-'+new Date().toISOString().replace(/[:T]/g,'-').slice(0,19)+'.md'); fs.mkdirSync(path.dirname(file),{recursive:true}); const plain=_liveFeedBuffer.slice(-800).map(l=>l.replace(/<[^>]+>/g,'').trim()); fs.writeFileSync(file,'# Feed Export\n\n'+plain.join('\n'),'utf8'); vscode.window.showInformationMessage('Feed exportado: '+path.basename(file)); vscode.workspace.openTextDocument(file).then(d=>vscode.window.showTextDocument(d,{preview:false})); }catch(e){ vscode.window.showErrorMessage('Export feed error: '+e.message);} }
function pushLiveFeed(type,msg){ const ts=new Date().toISOString().slice(11,19); let cat='evt-info'; if(/^agent\./.test(type))cat='evt-agent'; else if(/^bridge/.test(type))cat='evt-bridge'; else if(/^openai\./.test(type))cat='evt-openai'; const safe=(msg||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]||c)); const html=`<div class="line ${cat}"><span class="ts">${ts}</span><span class="tag">${type}</span>${safe}</div>`; _liveFeedBuffer.push(html); if(_liveFeedBuffer.length>2000)_liveFeedBuffer=_liveFeedBuffer.slice(-1500); if(_liveFeedPanel){ try{_liveFeedPanel.webview.postMessage({kind:'line',html});}catch{} } if(/^agent.step.completed/.test(type)) vscode.commands.executeCommand('copilotChief.__internalStepCompleted'); }
function feedHtml(){
  return `<!DOCTYPE html><html><head><meta charset='utf-8'><style>
  body{margin:0;font-family:system-ui;background:#111;color:#eee;}
  header{padding:8px 14px;background:#1e1e1e;border-bottom:1px solid #333;display:flex;align-items:center;gap:10px;}
  h1{font-size:14px;margin:0;}
  button{background:#0d6efd;border:none;color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;}
  button:hover{background:#1d78ff;}
  #log{font-family:monospace;font-size:11px;padding:8px;max-height:calc(100vh - 46px);overflow:auto;white-space:pre-wrap;}
  .line{padding:2px 4px;border-left:3px solid transparent;margin-bottom:2px;}
  .evt-agent{border-color:#2563eb;background:#1e293b;}
  .evt-bridge{border-color:#d97706;background:#3b2f1e;}
  .evt-openai{border-color:#9333ea;background:#312042;}
  .evt-info{border-color:#4b5563;background:#1f2429;}
  .ts{opacity:.55;margin-right:4px;}
  .tag{display:inline-block;font-size:10px;padding:0 4px;margin-right:4px;border-radius:3px;background:#444;}
  .filters{margin-left:auto;display:flex;gap:6px;}
  .filters label{display:flex;align-items:center;gap:4px;font-size:11px;}
  </style></head><body>
  <header><h1>Feed</h1>
    <button onclick="clearLog()">Limpiar</button>
    <button onclick="pause()" id="pp">Pausar</button>
    <div class='filters'>
      <label><input type='checkbox' id='fAgent' checked>agent</label>
      <label><input type='checkbox' id='fBridge' checked>bridge</label>
      <label><input type='checkbox' id='fOpenAI' checked>openai</label>
      <label><input type='checkbox' id='fInfo' checked>info</label>
    </div>
  </header>
  <div id='log'></div>
  <script>
    const vscode=acquireVsCodeApi();
    let paused=false;
    function add(l){ if(paused) return; const el=document.getElementById('log'); el.insertAdjacentHTML('afterbegin',l); if(el.children.length>1000){ for(let i=el.children.length-1;i>800;i--) el.removeChild(el.children[i]); } }
    function clearLog(){ document.getElementById('log').innerHTML=''; }
    function pause(){ paused=!paused; document.getElementById('pp').textContent=paused?'Reanudar':'Pausar'; }
    function allowed(cat){ return (cat==='evt-agent'&&fAgent.checked)||(cat==='evt-bridge'&&fBridge.checked)||(cat==='evt-openai'&&fOpenAI.checked)||(cat==='evt-info'&&fInfo.checked); }
    window.addEventListener('message',e=>{ if(e.data.kind==='batch'){ e.data.items.forEach(h=>{ const m=/class="line ([^ ""]+)"/.exec(h)||[]; if(allowed(m[1]||'')) add(h); }); } else if(e.data.kind==='line'){ const m=/class="line ([^ ""]+)"/.exec(e.data.html)||[]; if(allowed(m[1]||'')) add(e.data.html); } });
  </script>
  </body></html>`;
}

// Status bar & ETA
function initStatusBar(context){ const sb=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,100); context.subscriptions.push(sb); const refresh=()=>{ try{ let st=agentState(); if(_demoRunning){ st={ running:true, planning:false, paused:false, total:_demoSteps.length, remaining:_demoSteps.length-_demoCompleted, objective: st.objective }; } let text='$(robot) Chief'; if(st.total){ const done=st.total-st.remaining; const pct=Math.round((done/st.total)*100); text+=` ${pct}%`; } else if(st.planning) text+=' Plan'; else if(!st.running) text+=' Idle'; if(st.remaining && _durations.length){ const avg=_durations.reduce((a,b)=>a+b,0)/_durations.length; const etaMs=avg*st.remaining; const m=Math.round(etaMs/60000); if(m>0) text+=' ETA:'+m+'m'; } if(!_extVersion){ try{ _extVersion=require('../package.json').version; }catch{ _extVersion='?'; } } text+=' v'+_extVersion; sb.text=text; sb.show(); }catch{ sb.text='Chief Err'; } }; if(_isTest){ refresh(); } else { _timers.push(setInterval(refresh,4000)); refresh(); } }
function stepCompletedInternal(){ try{ if(_lastStepStartTs){ _durations.push(Date.now()-_lastStepStartTs); if(_durations.length>30) _durations=_durations.slice(-30); } _lastStepStartTs=Date.now(); if(vscode.workspace.getConfiguration('copilotChief').get('playSoundOnStep')) vscode.window.setStatusBarMessage('\u0007',120); if(_stepsTree) _stepsTree.refresh(); }catch{} }

// Demo
function runDemo(objective, root, output){ if(_demoRunning) return; _demoRunning=true; _demoSteps=['Revisar estructura','Simular plan','Vista pasos','ETA dinámica','Fin demo']; _demoCompleted=0; try{ const mem={ objective, steps:_demoSteps, completed:[], startedAt:new Date().toISOString(), stepMeta:{} }; fs.mkdirSync(path.join(root,'.copilot-chief'),{recursive:true}); fs.writeFileSync(path.join(root,'.copilot-chief','state.json'), JSON.stringify(mem,null,2),'utf8'); }catch(e){ output.appendLine('[demo] init error '+e.message);} const advance=()=>{ if(!_demoRunning) return; if(_demoCompleted>=_demoSteps.length){ _demoRunning=false; pushLiveFeed('agent.demo','Demo finalizada'); return;} const step=_demoSteps[_demoCompleted]; try{ const p=path.join(root,'.copilot-chief','state.json'); const json=JSON.parse(fs.readFileSync(p,'utf8')); json.completed=json.completed||[]; if(!json.completed.includes(step)) json.completed.push(step); json.stepMeta=json.stepMeta||{}; json.stepMeta[step]={ startedAt:new Date().toISOString(), completedAt:new Date().toISOString() }; fs.writeFileSync(p,JSON.stringify(json,null,2),'utf8'); }catch{} _demoCompleted++; vscode.commands.executeCommand('copilotChief.__internalStepCompleted'); pushLiveFeed('agent.demo','Paso demo: '+step); if(_stepsTree)_stepsTree.refresh(); if(_demoCompleted<_demoSteps.length) _demoTimer=setTimeout(advance,2200); }; _lastStepStartTs=Date.now(); pushLiveFeed('agent.demo','Demo iniciada con '+_demoSteps.length+' pasos'); _demoTimer=setTimeout(advance,1500); }

// Snapshot
function snapshot(output){ try{ if(!vscode.workspace.workspaceFolders) return; const root=vscode.workspace.workspaceFolders[0].uri.fsPath; const memPath=path.join(root,'.copilot-chief','state.json'); let memoryRaw='',memoryJson=null; if(fs.existsSync(memPath)){ memoryRaw=fs.readFileSync(memPath,'utf8'); try{memoryJson=JSON.parse(memoryRaw);}catch{} } const diagFile=path.join(root,'.copilot-chief','diagnostics.log'); let diagnosticsTail=''; if(fs.existsSync(diagFile)){ const lines=fs.readFileSync(diagFile,'utf8').trim().split(/\r?\n/); diagnosticsTail=lines.slice(-200).join('\n'); } const bridgeFile=path.join(root,'.copilot-chief','requests.json'); let bridgeRaw=''; if(fs.existsSync(bridgeFile)){ bridgeRaw=fs.readFileSync(bridgeFile,'utf8'); } const st=agentState(); const snap={ ts:new Date().toISOString(), state:st, memory:memoryJson, memoryRawLength:memoryRaw.length, diagnosticsTailLines:(diagnosticsTail.match(/\n/g)||[]).length+(diagnosticsTail?1:0), bridgeRaw }; const outDir=path.join(root,'.copilot-chief','snapshots'); fs.mkdirSync(outDir,{recursive:true}); const file=path.join(outDir,'snapshot-'+new Date().toISOString().replace(/[:T]/g,'-').slice(0,19)+'.json'); fs.writeFileSync(file,JSON.stringify(snap,null,2),'utf8'); vscode.window.showInformationMessage('Snapshot creado: '+path.basename(file)); vscode.workspace.openTextDocument(file).then(d=>vscode.window.showTextDocument(d,{preview:false})); }catch(e){ vscode.window.showErrorMessage('Error snapshot: '+e.message);} }

// Update checker (GitHub Releases) con auto-install opcional y logging feed
async function checkForUpdates(opts={}){
  const { manual=false, force=false, forceInstall=false, includePrere }=opts;
  const cfg=vscode.workspace.getConfiguration('copilotChief');
  if(!manual && !cfg.get('autoUpdateCheck')) return;
  const now=Date.now();
  if(!manual && _lastUpdateCheckTs && (now-_lastUpdateCheckTs) < 60000){ return; }
  _lastUpdateCheckTs=now;
  const owner='jagox1234'; const repo='J.Automore';
  let current='?';
  try{ current=require('../package.json').version; }catch{}
  const acceptPrere = (typeof includePrere==='boolean')? includePrere : cfg.get('acceptPrereleases');
  let releaseJson=null;
  try{
    if(acceptPrere){
      const releases=await fetchJson(`https://api.github.com/repos/${owner}/${repo}/releases`);
      if(Array.isArray(releases)) releaseJson=releases.find(r=>!r.draft);
    } else {
      releaseJson=await fetchJson(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
    }
  }catch(e){ if(manual) vscode.window.showErrorMessage('Error consultando releases: '+e.message); pushLiveFeed('update.error','Fetch releases: '+e.message); return; }
  if(!releaseJson || !releaseJson.tag_name){ if(manual) vscode.window.showWarningMessage('No se pudo obtener release tag'); pushLiveFeed('update.warn','Release sin tag_name'); return; }
  const remoteTagRaw=releaseJson.tag_name; const remote=extractVersion(remoteTagRaw) || remoteTagRaw.replace(/^v/,'');
  pushLiveFeed('update.info',`Release detectada tag="${remoteTagRaw}" versionExtraida=${remote} actual=${current}`);
  if(remote===current && !force){ if(manual) vscode.window.showInformationMessage('Ya estás en la última versión '+current); return; }
  const body=(releaseJson.body||'').split('\n').slice(0,15).join('\n');
  const silent=cfg.get('autoUpdateSilent'); const autoInstall=cfg.get('autoUpdateInstall');
  if(!forceInstall && !silent && !manual){
    if(_lastUpdateVersionNotified!==remote){
      if(autoInstall){ pushLiveFeed('update.auto','Instalación automática iniciada a '+remote); }
      else { vscode.window.showInformationMessage(`[Copilot Chief] Nueva versión ${remote} disponible (actual ${current}). Usa comando Buscar Actualizaciones para instalar.`); }
      _lastUpdateVersionNotified=remote;
    }
    if(!autoInstall) return;
  }
  if(!forceInstall && !silent && manual){
    const pick=await vscode.window.showInformationMessage(`Nueva versión ${remote} (actual ${current}). ¿Instalar ahora?`, 'Instalar', 'Ver Cambios', 'Cancelar');
    if(pick==='Ver Cambios'){ await showTempDoc('Copilot Chief - Cambios', body||'Sin changelog'); }
    if(pick!=='Instalar') return;
  }
  if(silent || forceInstall || manual || autoInstall){
    try{
      const assetInfo = pickVsixAsset(releaseJson.assets||[]);
      if(assetInfo){
        pushLiveFeed('update.download','Descargando VSIX '+(assetInfo.vsix?.name||''));
        await installVsixFromAsset(releaseJson, assetInfo, cfg);
        pushLiveFeed('update.installed','VSIX instalado '+(assetInfo.vsix?.name||''));
        if(cfg.get('autoReloadAfterUpdate')){
          pushLiveFeed('update.reload','Recargando ventana tras actualización');
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        } else if(!silent){
          vscode.window.showInformationMessage('Actualización instalada. Recarga la ventana para aplicar (Ctrl+Shift+P → Reload Window).');
        }
      } else {
        await attemptGitPullUpdate();
        vscode.window.showInformationMessage('Actualizado vía git pull (no VSIX encontrado). Reinicia la ventana si es necesario.');
      }
    }catch(e){ vscode.window.showErrorMessage('Fallo al actualizar: '+e.message); pushLiveFeed('update.error','Error '+e.message); }
  }
}

function extractVersion(tag){
  if(!tag) return null;
  const matches=[...tag.matchAll(/(\d+\.\d+\.\d+)/g)];
  if(!matches.length) return null;
  return matches[matches.length-1][1];
}

function scheduleAutoUpdateChecks(context){
  const cfg=vscode.workspace.getConfiguration('copilotChief');
  if(!cfg.get('autoUpdateCheck')) return;
  const poll=cfg.get('updatePollMinutes');
  if(poll===0){ pushLiveFeed('update.info','Auto update polling desactivado'); return; }
  const minutes=Math.max(1, poll||15);
  // Intento de instalación automática inmediato (forceInstall) para asegurar actualización sin intervención
  setTimeout(()=>checkForUpdates({manual:false, force:false, forceInstall:true}), 5000);
  // Chequeo normal (notificación / autoInstall según configuración)
  setTimeout(()=>checkForUpdates({manual:false}), 8000);
  _updateInterval=setInterval(()=>checkForUpdates({manual:false}), minutes*60000);
  context.subscriptions.push({ dispose(){ try{ clearInterval(_updateInterval);}catch{} } });
}

function fetchJson(url, depth=0){
  return new Promise((resolve,reject)=>{
    if(depth>6) return reject(new Error('fetchJson demasiados redirects'));
    const headers={ 'User-Agent':'copilot-chief-agent', 'Accept':'application/vnd.github+json' };
    const lib = url.startsWith('https:')? require('https'): require('http');
    lib.get(url,{ headers }, res=>{
      const code=res.statusCode||0;
      if(code>=300 && code<400){
        const loc=res.headers.location||res.headers.Location;
        if(loc){
          const next=loc.startsWith('http')? loc : new URL(loc,url).toString();
          return resolve(fetchJson(next, depth+1));
        }
        return reject(new Error('HTTP '+code+' sin Location (redirect)'));
      }
      if(code>=400){ return reject(new Error('HTTP '+code)); }
      let data=''; res.on('data',d=>data+=d); res.on('end',()=>{ try{ resolve(JSON.parse(data)); }catch(e){ reject(e);} });
    }).on('error',reject);
  });
}

async function attemptGitPullUpdate(){
  return new Promise((resolve,reject)=>{
    const cwd=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if(!cwd) return reject(new Error('No workspace')); 
    cp.exec('git pull', { cwd }, (err,stdout,stderr)=>{ if(err) return reject(new Error(stderr.trim()||err.message)); resolve(stdout.trim()); });
  });
}

function pickVsixAsset(assets){
  if(!Array.isArray(assets)) return null;
  // Prefer .vsix asset
  let vsix=assets.find(a=>/\.vsix$/i.test(a.name));
  if(!vsix) return null;
  // Optional hash file .sha256 with same base
  const base=vsix.name.replace(/\.vsix$/i,'');
  const hash=assets.find(a=>new RegExp('^'+escapeRegex(base)+'.*' + '.sha256$','i').test(a.name));
  return { vsix, hash };
}

function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

async function installVsixFromAsset(release, assetsInfo, cfg){
  const { vsix, hash }=assetsInfo;
  if(!vsix.browser_download_url) throw new Error('Asset VSIX sin URL');
  const tmpDir = require('os').tmpdir();
  const filePath = path.join(tmpDir, vsix.name);
  const buf = await fetchBuffer(vsix.browser_download_url);
  const integrityEnforce = cfg.get('updateIntegrityEnforce');
  if(hash && hash.browser_download_url){
    const hashText=(await fetchBuffer(hash.browser_download_url)).toString('utf8').trim();
    const expected = (hashText.match(/[A-Fa-f0-9]{64}/)||[])[0];
    if(!expected && integrityEnforce) throw new Error('Hash sha256 no encontrado en archivo de hash');
    if(expected){
      const crypto=require('crypto');
      const got=crypto.createHash('sha256').update(buf).digest('hex');
      if(got.toLowerCase()!==expected.toLowerCase()){
        if(integrityEnforce) throw new Error('Hash mismatch VSIX');
        vscode.window.showWarningMessage('Advertencia: hash VSIX no coincide, instalando de todas formas.');
      }
    }
  } else if(integrityEnforce){
    throw new Error('Integridad requerida pero no hay archivo de hash');
  }
  fs.writeFileSync(filePath, buf);
  await installVsix(filePath);
  vscode.window.showInformationMessage('VSIX instalado: '+vsix.name+' — reinicia la ventana para aplicar.');
}

function fetchBuffer(url, depth=0){
  return new Promise((resolve,reject)=>{
    if(depth>8) return reject(new Error('Demasiados redirects (>8)'));
    const lib= url.startsWith('https:')? require('https'): require('http');
    const headers={ 'User-Agent':'copilot-chief-agent', 'Accept':'application/octet-stream' };
    lib.get(url,{ headers },res=>{
      const code=res.statusCode||0;
      const location = res.headers.location || res.headers.Location;
      if(code>=300 && code<400){
        if(location){
          const next = location.startsWith('http')? location : new URL(location, url).toString();
          return resolve(fetchBuffer(next, depth+1));
        } else {
          return reject(new Error('HTTP '+code+' sin header Location (no se pudo seguir redirect)'));
        }
      }
      if(code>=400){ return reject(new Error('HTTP '+code)); }
      const chunks=[]; res.on('data',d=>chunks.push(d)); res.on('end',()=>resolve(Buffer.concat(chunks))); res.on('error',reject);
    }).on('error',reject);
  });
}

function installVsix(filePath){
  return new Promise((resolve,reject)=>{
    const codeCmd = process.platform.startsWith('win')? 'code.cmd':'code';
    cp.exec(`${codeCmd} --install-extension "${filePath}"`, (err,stdout,stderr)=>{ if(err) return reject(new Error(stderr.trim()||err.message)); resolve(stdout.trim()); });
  });
}

async function showTempDoc(title, text){
  const doc=await vscode.workspace.openTextDocument({ content:text, language:'markdown' });
  await vscode.window.showTextDocument(doc,{ preview:true });
  vscode.window.showInformationMessage(title);
}

// Automated self-test: ensures demo mode run, export feed, snapshot
async function autoSelfTest(output){
  try{
    if(!vscode.workspace.workspaceFolders){ return vscode.window.showWarningMessage('Abre una carpeta.'); }
    const cfg=vscode.workspace.getConfiguration('copilotChief');
    if(!cfg.get('demoMode')){
      vscode.window.showInformationMessage('Activando demoMode temporal para self-test');
      await cfg.update('demoMode', true, vscode.ConfigurationTarget.Workspace);
    }
    const root=vscode.workspace.workspaceFolders[0].uri.fsPath;
    // Start demo if not already
    if(!_demoRunning){ runDemo('SelfTest Demo', root, output); }
    // Wait for demo to finish (cap at 20s)
    const start=Date.now();
    while(_demoRunning && Date.now()-start < 20000){ await new Promise(r=>setTimeout(r,600)); }
    // Export feed
    exportFeed();
    // Snapshot
    snapshot(output);
    vscode.window.showInformationMessage('Self-test completado');
  }catch(err){ vscode.window.showErrorMessage('Self-test error: '+err.message); }
}

function deactivate(){ while(_timers.length){ const t=_timers.pop(); try{ clearInterval(t); clearTimeout(t);}catch{} } if(_demoTimer){ try{ clearTimeout(_demoTimer);}catch{} } }

module.exports = { activate, deactivate };
