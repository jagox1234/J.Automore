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

function decide(request, cfg, context){
  const blocked = (cfg.get('blockedCommands')||[]).some(b => request.command.includes(b));
  if(blocked) return { decision:'cancel', reason:'blocked pattern' };
  const allowedPatterns = cfg.get('allowedCommands')||[];
  const ok = allowedPatterns.some(rx => { try { return new RegExp(rx).test(request.command); } catch { return false; } });
  if(!ok) return { decision:'cancel', reason:'no whitelist match' };
  // Cooldown check (exact same command executed recently)
  try {
    const cooldown = parseInt(cfg.get('commandCooldownSeconds')||0,10);
    if(cooldown>0 && context && context.recent){
      const prev = context.recent[request.command];
      if(prev && (Date.now() - prev < cooldown*1000)){
        return { decision:'cancel', reason:'cooldown active' };
      }
    }
  } catch{}
  return { decision:'confirm' };
}

// Simple in-memory context to track recent executions (not persisted across reloads)
const _bridgeContext = { recent:{} };

async function processBridge(root, output){
  const cfg = vscode.workspace.getConfiguration('copilotChief');
  if(!cfg.get('enableCommandBridge')) return;
  const reqs = loadRequests(root);
  let changed = false;
  // Archive / prune old entries
  try {
    const maxAgeDays = parseInt(cfg.get('commandArchiveMaxAgeDays')||0,10);
    if(maxAgeDays>0){
      const cutoff = Date.now() - maxAgeDays*24*60*60*1000;
      const before = reqs.length;
      for(let i=reqs.length-1;i>=0;i--){
        const r = reqs[i];
        if(r.status && r.status!=='pending' && r.updatedAt){
          const ts = Date.parse(r.updatedAt || r.createdAt || '');
          if(!isNaN(ts) && ts < cutoff){
            reqs.splice(i,1); changed=true;
          }
        }
      }
      if(before !== reqs.length){ output.appendLine('[bridge] purged '+(before-reqs.length)+' old entries'); }
    }
  } catch{}
  const maxConcurrent = parseInt(cfg.get('maxConcurrentBridgeCommands')||1,10);
  const runningCount = reqs.filter(r=>r.status==='running').length;
  const timeoutMs = Math.max(1, parseInt(cfg.get('commandTimeoutSeconds')||60,10))*1000;
  for(const req of reqs){
    if(req.status === 'pending'){
      if(runningCount >= maxConcurrent){
        continue; // defer until next poll
      }
      const sanitized = sanitizeCommand(req.command);
      if(!sanitized){
        req.status = 'rejected'; req.decision='cancel'; req.result='command rejected (unsafe characters)'; req.updatedAt = new Date().toISOString(); changed=true; continue;
      }
      const dec = decide(req, cfg, _bridgeContext);
      if(dec.decision === 'cancel'){
        req.status='rejected'; req.decision='cancel'; req.result=dec.reason; req.updatedAt=new Date().toISOString(); changed=true; continue;
      }
      // confirm and execute
      req.status='running'; req.decision='confirm'; req.startedAt=new Date().toISOString(); req.updatedAt=req.startedAt; changed=true; saveRequests(root, reqs);
      try {
        output.appendLine('[bridge] ejecutando: '+sanitized);
        const exec = require('child_process').exec;
        await new Promise((resolve)=>{
          exec(sanitized, { cwd: root, timeout: timeoutMs }, (err, stdout, stderr)=>{
            if(err){
              const timedOut = err.killed && /ETIMEDOUT|timeout/i.test(err.message);
              req.status='error'; req.result = (stderr && stderr.trim()) || (timedOut ? 'timeout' : err.message);
            } else {
              req.status='done'; req.result = summarize(stdout, cfg);
              _bridgeContext.recent[req.command] = Date.now();
            }
            req.finishedAt=new Date().toISOString();
            req.updatedAt=req.finishedAt;
            changed=true; resolve();
          });
        });
      } catch(e){ req.status='error'; req.result=e.message; req.updatedAt=new Date().toISOString(); changed=true; }
    }
  }
  if(changed) {
    saveRequests(root, reqs);
    // Notifications (lightweight) after persisting
    if(cfg.get('commandBridgeNotify')){
      try {
        for(const r of reqs){
          if(r._notified) continue; // avoid duplicates
          if(['done','error','rejected'].includes(r.status)){
            const preview = (r.result||'').split(/\r?\n/)[0];
            if(r.status==='done') vscode.window.showInformationMessage('Bridge ✅ '+r.command+' -> '+preview);
            else if(r.status==='error') vscode.window.showErrorMessage('Bridge ❌ '+r.command+' -> '+preview);
            else if(r.status==='rejected') vscode.window.showWarningMessage('Bridge ⚠ '+r.command+' -> '+preview);
            r._notified = true;
          }
        }
      } catch{}
    }
  }
}

function summarize(text, cfg){
  const maxLines = parseInt(cfg?.get?.('commandResultMaxLines') || 5, 10);
  const lines = (text||'').split(/\r?\n/).filter(Boolean);
  if(!lines.length) return 'ok (no output)';
  if(lines.length<=maxLines) return lines.join('\n');
  return lines.slice(-maxLines).join('\n');
}

function openBridgeFile(root){
  ensureDir(root);
  const file = bridgeFile(root);
  if(!fs.existsSync(file)) fs.writeFileSync(file, '[]', 'utf8');
  vscode.workspace.openTextDocument(file).then(doc=>vscode.window.showTextDocument(doc));
}

module.exports = { processBridge, openBridgeFile };
