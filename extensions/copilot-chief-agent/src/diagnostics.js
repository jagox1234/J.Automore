const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

let _channel = null;
let _enabled = true;
let _filePath = null;
let _inited = false;
let _root = null;
const MAX_SIZE_BYTES = 1_000_000; // ~1MB rotation threshold

function initDiagnostics(root){
  if(_inited) return; // idempotent
  _inited = true;
  _root = root;
  try {
    const cfg = vscode.workspace.getConfiguration('copilotChief');
    _enabled = cfg.get('diagnosticsEnabled') !== false; // default true
    const rel = cfg.get('diagnosticsLogFile') || '.copilot-chief/diagnostics.log';
    _filePath = path.isAbsolute(rel) ? rel : path.join(root || process.cwd(), rel);
  } catch {
    _enabled = true;
    _filePath = path.join(root||process.cwd(), '.copilot-chief/diagnostics.log');
  }
  try { if(vscode && vscode.window && typeof vscode.window.createOutputChannel==='function') { _channel = vscode.window.createOutputChannel('Copilot Chief Diagnostics'); } } catch {}
  safeMkDir(path.dirname(_filePath));
  rotateIfNeeded();
  logDiag('diagnostics.init', { root: _root, file: _filePath, enabled: _enabled });
  try {
    process.on('unhandledRejection', (reason) => {
      logDiag('error.unhandledRejection', { reason: reason && reason.message || String(reason) });
    });
    process.on('uncaughtException', (err) => {
      logDiag('error.uncaughtException', { message: err.message, stack: err.stack && err.stack.split('\n').slice(0,4).join(' | ') });
    });
  } catch {}
}

function safeMkDir(dir){
  try { if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true }); } catch {}
}

function rotateIfNeeded(){
  try {
    if(!_filePath) return;
    if(fs.existsSync(_filePath)){
      const st = fs.statSync(_filePath);
      if(st.size > MAX_SIZE_BYTES){
        const rotated = _filePath.replace(/\.log$/, '') + '-' + new Date().toISOString().replace(/[:T]/g,'-').slice(0,19) + '.log';
        fs.renameSync(_filePath, rotated);
      }
    }
  } catch {}
}

function logDiag(type, data={}){
  try {
    const evt = { ts: new Date().toISOString(), type, ...data };
    if(_channel){
      try { _channel.appendLine(JSON.stringify(evt)); } catch {}
    }
    if(_enabled && _filePath){
      try { rotateIfNeeded(); fs.appendFileSync(_filePath, JSON.stringify(evt)+'\n', 'utf8'); } catch {}
    }
  } catch {}
}

function toggleDiagnostics(){
  _enabled = !_enabled;
  logDiag('diagnostics.toggle', { enabled:_enabled });
  vscode.window.showInformationMessage('Diagnostics ' + (_enabled ? 'activadas' : 'desactivadas'));
}

function openDiagnosticsFile(){
  if(!_filePath){ return vscode.window.showWarningMessage('Sin ruta de log configurada'); }
  try {
    if(!fs.existsSync(_filePath)) fs.writeFileSync(_filePath,'','utf8');
    vscode.workspace.openTextDocument(_filePath).then(doc=>vscode.window.showTextDocument(doc,{preview:false}));
  } catch(e){ vscode.window.showErrorMessage('No se pudo abrir log: '+e.message); }
}

module.exports = { initDiagnostics, logDiag, toggleDiagnostics, openDiagnosticsFile };
