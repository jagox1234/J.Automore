const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

function bridgeFile(root){ return path.join(root, '.copilot-chief', 'requests.json'); }
function ensureDir(root){ const dir = path.join(root, '.copilot-chief'); if(!fs.existsSync(dir)) { try { fs.mkdirSync(dir, { recursive:true }); } catch {} } }

function loadRequests(root){
  try {
    const file = bridgeFile(root);
    if(!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file,'utf8'));
  } catch { return []; }
}

function saveRequests(root, arr){
  try {
    ensureDir(root);
    const tmp = bridgeFile(root)+'.tmp';
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), 'utf8');
    fs.renameSync(tmp, bridgeFile(root));
  } catch (e){ console.error('[commandBridge] save error', e.message); }
}

function sanitizeCommand(cmd){
  // rudimentary safety: block shell metacharacters ; | & ` > <
  if(/[;|&`><]/.test(cmd)) return null;
  return cmd.trim();
}

function decide(request, cfg){
  const blocked = (cfg.get('blockedCommands')||[]).some(b => request.command.includes(b));
  if(blocked) return { decision:'cancel', reason:'blocked pattern' };
  const allowedPatterns = cfg.get('allowedCommands')||[];
  const ok = allowedPatterns.some(rx => { try { return new RegExp(rx).test(request.command); } catch { return false; } });
  if(!ok) return { decision:'cancel', reason:'no whitelist match' };
  return { decision:'confirm' };
}

async function processBridge(root, output){
  const cfg = vscode.workspace.getConfiguration('copilotChief');
  if(!cfg.get('enableCommandBridge')) return;
  const reqs = loadRequests(root);
  let changed = false;
  for(const req of reqs){
    if(req.status === 'pending'){
      const sanitized = sanitizeCommand(req.command);
      if(!sanitized){
        req.status = 'rejected'; req.decision='cancel'; req.result='command rejected (unsafe characters)'; req.updatedAt = new Date().toISOString(); changed=true; continue;
      }
      const dec = decide(req, cfg);
      if(dec.decision === 'cancel'){
        req.status='rejected'; req.decision='cancel'; req.result=dec.reason; req.updatedAt=new Date().toISOString(); changed=true; continue;
      }
      // confirm and execute
      req.status='running'; req.decision='confirm'; req.updatedAt=new Date().toISOString(); changed=true; saveRequests(root, reqs);
      try {
        output.appendLine('[bridge] ejecutando: '+sanitized);
        const exec = require('child_process').exec;
        await new Promise((resolve)=>{
          exec(sanitized, { cwd: root, timeout: 60000 }, (err, stdout, stderr)=>{
            if(err){ req.status='error'; req.result=stderr.trim()||err.message; }
            else { req.status='done'; req.result = summarize(stdout); }
            req.updatedAt=new Date().toISOString();
            changed=true; resolve();
          });
        });
      } catch(e){ req.status='error'; req.result=e.message; req.updatedAt=new Date().toISOString(); changed=true; }
    }
  }
  if(changed) saveRequests(root, reqs);
}

function summarize(text){
  const lines = (text||'').split(/\r?\n/).filter(Boolean);
  if(!lines.length) return 'ok (no output)';
  if(lines.length<=5) return lines.join('\n');
  return lines.slice(-5).join('\n');
}

function openBridgeFile(root){
  ensureDir(root);
  const file = bridgeFile(root);
  if(!fs.existsSync(file)) fs.writeFileSync(file, '[]', 'utf8');
  vscode.workspace.openTextDocument(file).then(doc=>vscode.window.showTextDocument(doc));
}

module.exports = { processBridge, openBridgeFile };
