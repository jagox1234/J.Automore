const vscode = require('vscode'); // chore: trigger release workflow
// CI trigger: noop cambio para generar nueva release automática (bump attempt 2).
const { scanProject } = require('./projectScanner');
const { askChatGPT } = require('./openaiClient');
const { saveMemory, loadMemory } = require('./memoryManager');
const { nextStep, markStepComplete } = require('./stepManager');
const cp = require('child_process');
const { logDiag } = require('./diagnostics');

let workspaceRootPath = '';
let projectContext = '';
let steps = [];
let objectiveGlobal = '';
let activeListener = null;
let planning = false;
let running = false;
let paused = false;
let currentStep = null; // mantiene referencia al paso actual insertado
let waitingManual = false; // cuando confirmEachStep está activado y esperamos 'next'
let _repeatCounter = 0; // guard para evitar loops infinitos si markStepComplete no persiste
let _lastStepId = null;

async function startAgent(objective) {
  if (planning) return;
  if (paused) paused = false; // reset pause on fresh start
  planning = true;
  try { logDiag('agent.start', { objectiveLength: (objective||'').length }); } catch {}
  running = false;
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('No hay carpeta abierta en VS Code.');
    planning = false;
    return;
  }
  workspaceRootPath = workspaceFolders[0].uri.fsPath;
  objectiveGlobal = objective;

  vscode.window.setStatusBarMessage('Copilot Chief: Escaneando proyecto...', 3000);
  projectContext = scanProject(workspaceRootPath);
  try { logDiag('agent.scanned', { contextLength: (projectContext||'').length }); } catch {}

  vscode.window.setStatusBarMessage('Copilot Chief: Generando plan con OpenAI...', 4000);
  const max = vscode.workspace.getConfiguration('copilotChief').get('maxPlanSteps') || 15;
  const plan = await askChatGPT(`Eres un agente jefe que coordina a GitHub Copilot.\nObjetivo: ${objective}\nDevuelve una lista numerada de pasos concretos (máx ${max}) y orientada a commits atómicos.\nProyecto:\n${projectContext}`);
  steps = plan.split(/\n+/).map(s => s.replace(/^\d+[). -]\s*/, '').trim()).filter(Boolean).slice(0, max);
  try { logDiag('agent.plan.created', { steps: steps.length }); } catch {}

  const mem = { objective, steps, completed: [], startedAt: new Date().toISOString() };
  saveMemory(workspaceRootPath, mem);

  vscode.window.showInformationMessage('Agente iniciado. Plan creado (' + steps.length + ' pasos).');
  planning = false;
  running = true;
  try { logDiag('agent.running', { steps: steps.length }); } catch {}
  executeNextStep();
}

async function executeNextStep() {
  if (paused) { return; }
  try { logDiag('agent.nextStep.attempt', {}); } catch {}
  const mem = loadMemory(workspaceRootPath);
  const step = nextStep(steps, mem.completed || []);
  if (!step) {
    vscode.window.showInformationMessage('Copilot Chief: Objetivo completado.');
  running = false;
  try { logDiag('agent.completed', {}); } catch {}
    return;
  }
  if (step === _lastStepId) {
    _repeatCounter++;
  } else {
    _repeatCounter = 0;
    _lastStepId = step;
  }
  if (_repeatCounter > 5) {
    vscode.window.showWarningMessage('Copilot Chief: detectado bucle en el mismo paso, abortando.');
    running = false;
  try { logDiag('agent.loopAbort', { step }); } catch {}
    return;
  }
  // Si confirmEachStep está activo y ya hemos insertado uno, esperar confirmación manual antes de avanzar
  if (waitingManual) { return; }
  let editor = vscode.window.activeTextEditor;
  if (!editor) {
    // Crear/abrir un archivo sandbox para asegurar que el usuario vea actividad
    try {
      const path = require('path');
      const fs = require('fs');
      const sandboxDir = path.join(workspaceRootPath, '.copilot-chief');
      const sandboxFile = path.join(sandboxDir, 'agent-sandbox.txt');
      if(!fs.existsSync(sandboxDir)) fs.mkdirSync(sandboxDir, { recursive:true });
      if(!fs.existsSync(sandboxFile)) fs.writeFileSync(sandboxFile, '// Archivo sandbox de Copilot Chief\n','utf8');
      const doc = await vscode.workspace.openTextDocument(sandboxFile);
      editor = await vscode.window.showTextDocument(doc, { preview:false, preserveFocus:false });
      vscode.window.showInformationMessage('Copilot Chief: usando sandbox .copilot-chief/agent-sandbox.txt para ejecutar pasos.');
      try { logDiag('agent.sandbox.opened', {}); } catch {}
    } catch (e) {
      vscode.window.showWarningMessage('No se pudo crear sandbox: ' + e.message);
      return;
    }
  }
  // Feedback visual del paso
  try { vscode.window.setStatusBarMessage('Copilot Chief: ejecutando paso "' + step + '"', 5000); } catch {}
  vscode.window.showInformationMessage('Copilot Chief: ejecutando paso -> ' + step);
  await editor.edit(editBuilder => {
    editBuilder.insert(editor.selection.active, `\n// Copilot Chief Paso: ${step}\n// Implementa este paso. Si necesitas aclaración, formula una pregunta.\n`);
  });
  try { logDiag('agent.step.inserted', { step }); } catch {}

  currentStep = step;
  if (activeListener) { activeListener.dispose(); }
  activeListener = vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (event.document !== editor.document) return;
    const change = event.contentChanges[0];
    if (!change) return;
    const text = change.text;
    if (!text.trim()) return; // ignore whitespace
    const trimmed = text.trim();
    // Ignore pure comment lines (js/ts style) for completion trigger
    if (/^\/\//.test(trimmed) || /^\/\*/.test(trimmed)) {
      return; // do not mark complete on comments alone
    }
  if (paused) { return; }

    // Detect pregunta
  if (/[?¿]/.test(text) || /que\s+hago|como\s+hacer/i.test(text)) {
  try { logDiag('agent.question.detected', { step, snippet: text.slice(0,120) }); } catch {}
  const answer = await askChatGPT(`Objetivo global: ${objectiveGlobal}\nContexto:\n${projectContext}\nPregunta de Copilot o duda detectada en el código:\n${text}\nResponde de forma precisa en máximo 6 líneas y si procede da un mini ejemplo.`);
      await editor.edit(b => b.insert(editor.selection.active, `\n// Respuesta del Agente: ${answer.replace(/\n/g, ' ')}\n`));
      return;
    }

  // Consider code insertion as progress (non-comment)
    markStepComplete(workspaceRootPath, step);
  try { logDiag('agent.step.completed', { step }); } catch {}
    const autoCommit = vscode.workspace.getConfiguration('copilotChief').get('autoGitCommit');
    if (autoCommit) {
      try {
        await gitCommitStep(step);
    try { logDiag('agent.git.commit.ok', { step }); } catch {}
        await editor.edit(b => b.insert(editor.selection.active, `\n// Copilot Chief: Paso completado y commit creado. Avanzando...\n`));
      } catch (e) {
    try { logDiag('agent.git.commit.error', { step, error: e.message }); } catch {}
        await editor.edit(b => b.insert(editor.selection.active, `\n// Copilot Chief: Paso completado pero falló commit (${e.message}). Avanzando...\n`));
      }
    } else {
      await editor.edit(b => b.insert(editor.selection.active, `\n// Copilot Chief: Paso marcado como completado. Avanzando...\n`));
    }
    activeListener.dispose();
	if (!paused) {
      const confirmEach = vscode.workspace.getConfiguration('copilotChief').get('confirmEachStep');
      if (confirmEach) {
        waitingManual = true;
  try { logDiag('agent.waitingManual', { step }); } catch {}
        vscode.window.showInformationMessage('Paso completado. Usa "Copilot Chief: Siguiente Paso" para continuar.');
      } else {
        executeNextStep();
      }
    }
  });
}

function agentState() {
  return {
    planning,
    running,
  paused,
    objective: objectiveGlobal,
    remaining: steps.length - (loadMemory(workspaceRootPath).completed || []).length,
    total: steps.length
  };
}
const { parsePlanSteps } = require('./planParser');
let lastFeedback = '';
// Apply plan updates from external memory file modifications
function applyMemoryPlan(mem){
  try {
    if(mem && mem.objective) objectiveGlobal = mem.objective;
    let incoming = [];
    if (mem && mem.steps) incoming = parsePlanSteps(mem.steps);
    if (incoming.length) {
      // Preserve already completed steps order, append remaining
      const completed = (mem.completed||[]).slice();
      const remaining = incoming.filter(s => !completed.includes(s));
      steps = [...completed.filter(c=>incoming.includes(c)), ...remaining];
      lastFeedback = `Plan sincronizado (${incoming.length} pasos, ${completed.length} completados).`;
    } else {
      lastFeedback = 'No se detectaron pasos parseables en el archivo de memoria.';
    }
    // Write back metadata
    if (workspaceRootPath) {
      const { saveMemory } = require('./memoryManager');
      const current = loadMemory(workspaceRootPath);
      current.meta = current.meta || {};
      current.meta.lastSync = new Date().toISOString();
      current.meta.feedback = lastFeedback;
      current.steps = mem.steps; // Keep original representation
      saveMemory(workspaceRootPath, current);
    }
  } catch (e){ lastFeedback = 'Error aplicando plan: '+e.message; }
}

function pauseAgent(){
  if (!running) { vscode.window.showInformationMessage('Agente no está en ejecución.'); return; }
  paused = true;
  vscode.window.showInformationMessage('Copilot Chief: Pausado.');
  try { logDiag('agent.paused', {}); } catch {}
}
function resumeAgent(){
  if (!paused) { vscode.window.showInformationMessage('Agente no está pausado.'); return; }
  paused = false;
  try { logDiag('agent.resumed', {}); } catch {}
  // seguir con el siguiente paso si no está completado todo
  const mem = loadMemory(workspaceRootPath);
  const remainingCount = steps.length - (mem.completed||[]).length;
  if (remainingCount > 0) {
    running = true;
    executeNextStep();
  } else {
    vscode.window.showInformationMessage('No hay pasos restantes.');
  }
}

function stopAgent(){
  if(!running && !planning){ vscode.window.showInformationMessage('Agente ya está detenido.'); return; }
  planning = false; running = false; paused = false; waitingManual = false; currentStep = null;
  try { logDiag('agent.stopped', {}); } catch {}
  if (activeListener) { try { activeListener.dispose(); } catch {} activeListener = null; }
  vscode.window.showInformationMessage('Copilot Chief: Agente detenido.');
}

function skipCurrentStep(){
  if(!running){ vscode.window.showInformationMessage('Agente no está en ejecución.'); return; }
  if(!currentStep){ vscode.window.showInformationMessage('No hay paso actual que saltar.'); return; }
  // Marcarlo como completado para no regresar
  try { markStepComplete(workspaceRootPath, currentStep); } catch {}
  currentStep = null;
  waitingManual = false;
  vscode.window.showInformationMessage('Paso saltado.');
  executeNextStep();
  try { logDiag('agent.step.skipped', {}); } catch {}
}

async function regeneratePlan(){
  if(!workspaceRootPath || !objectiveGlobal){ vscode.window.showWarningMessage('No hay plan activo para regenerar.'); return; }
  if(planning){ vscode.window.showInformationMessage('Ya se está planificando.'); return; }
  planning = true;
  try { logDiag('agent.plan.regenerating', {}); } catch {}
  vscode.window.showInformationMessage('Regenerando plan...');
  const max = vscode.workspace.getConfiguration('copilotChief').get('maxPlanSteps') || 15;
  const plan = await askChatGPT(`Regenera un plan de pasos numerados (máx ${max}) refinado basándote en que ya existen commits y contexto actual. Objetivo: ${objectiveGlobal}. Manten pasos atómicos.`);
  const newSteps = plan.split(/\n+/).map(s=>s.replace(/^\d+[). -]\s*/, '').trim()).filter(Boolean).slice(0,max);
  if(newSteps.length){
    // Mantener completados existentes
    const mem = loadMemory(workspaceRootPath);
    const completed = mem.completed||[];
    const remaining = newSteps.filter(s=>!completed.includes(s));
    steps = [...completed.filter(c=>newSteps.includes(c)), ...remaining];
    mem.steps = steps;
    saveMemory(workspaceRootPath, mem);
    vscode.window.showInformationMessage('Plan regenerado ('+steps.length+' pasos totales).');
  try { logDiag('agent.plan.regenerated', { steps: steps.length }); } catch {}
  } else {
    vscode.window.showWarningMessage('No se pudo regenerar el plan (respuesta vacía).');
  try { logDiag('agent.plan.regenEmpty', {}); } catch {}
  }
  planning = false;
  if(running && !paused && !waitingManual) executeNextStep();
}

function manualAdvanceStep(){
  if(!waitingManual){ vscode.window.showInformationMessage('No se está esperando confirmación manual.'); return; }
  waitingManual = false;
  executeNextStep();
}

module.exports = { startAgent, agentState, applyMemoryPlan, gitCommitStep, sanitizeCommitMessage, pauseAgent, resumeAgent, stopAgent, skipCurrentStep, regeneratePlan, manualAdvanceStep };

async function gitCommitStep(step) {
  return new Promise((resolve, reject) => {
    // Simple add & commit all changes; could be refined to only changed files.
    const msg = sanitizeCommitMessage(step);
    const cmd = process.platform.startsWith('win')
      ? `git add -A && git commit -m "feat(step): ${msg}"`
      : `git add -A && git commit -m 'feat(step): ${msg}'`;
    cp.exec(cmd, { cwd: workspaceRootPath }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr.trim() || err.message));
      }
      resolve(stdout.trim());
    });
  });
}

function sanitizeCommitMessage(step) {
  return step.replace(/"/g, '\\"').replace(/\s+/g, ' ').slice(0, 80);
}
