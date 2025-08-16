const vscode = require('vscode');
// CI trigger: noop cambio para generar nueva release automática.
const { scanProject } = require('./projectScanner');
const { askChatGPT } = require('./openaiClient');
const { saveMemory, loadMemory } = require('./memoryManager');
const { nextStep, markStepComplete } = require('./stepManager');
const cp = require('child_process');

let workspaceRootPath = '';
let projectContext = '';
let steps = [];
let objectiveGlobal = '';
let activeListener = null;
let planning = false;
let running = false;

async function startAgent(objective) {
  if (planning) return;
  planning = true;
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

  vscode.window.setStatusBarMessage('Copilot Chief: Generando plan con OpenAI...', 4000);
  const max = vscode.workspace.getConfiguration('copilotChief').get('maxPlanSteps') || 15;
  const plan = await askChatGPT(`Eres un agente jefe que coordina a GitHub Copilot.\nObjetivo: ${objective}\nDevuelve una lista numerada de pasos concretos (máx ${max}) y orientada a commits atómicos.\nProyecto:\n${projectContext}`);
  steps = plan.split(/\n+/).map(s => s.replace(/^\d+[). -]\s*/, '').trim()).filter(Boolean).slice(0, max);

  const mem = { objective, steps, completed: [], startedAt: new Date().toISOString() };
  saveMemory(workspaceRootPath, mem);

  vscode.window.showInformationMessage('Agente iniciado. Plan creado (' + steps.length + ' pasos).');
  planning = false;
  running = true;
  executeNextStep();
}

async function executeNextStep() {
  const mem = loadMemory(workspaceRootPath);
  const step = nextStep(steps, mem.completed || []);
  if (!step) {
    vscode.window.showInformationMessage('Copilot Chief: Objetivo completado.');
  running = false;
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Abre un archivo para insertar instrucciones del paso: ' + step);
    return;
  }
  await editor.edit(editBuilder => {
    editBuilder.insert(editor.selection.active, `\n// Copilot Chief Paso: ${step}\n// Implementa este paso. Si necesitas aclaración, formula una pregunta.\n`);
  });

  if (activeListener) { activeListener.dispose(); }
  activeListener = vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (event.document !== editor.document) return;
    const change = event.contentChanges[0];
    if (!change) return;
    const text = change.text;
    if (!text.trim()) return;

    // Detect pregunta
  if (/[?¿]/.test(text) || /que\s+hago|como\s+hacer/i.test(text)) {
  const answer = await askChatGPT(`Objetivo global: ${objectiveGlobal}\nContexto:\n${projectContext}\nPregunta de Copilot o duda detectada en el código:\n${text}\nResponde de forma precisa en máximo 6 líneas y si procede da un mini ejemplo.`);
      await editor.edit(b => b.insert(editor.selection.active, `\n// Respuesta del Agente: ${answer.replace(/\n/g, ' ')}\n`));
      return;
    }

    // Consider code insertion as progress
    markStepComplete(workspaceRootPath, step);
    const autoCommit = vscode.workspace.getConfiguration('copilotChief').get('autoGitCommit');
    if (autoCommit) {
      try {
        await gitCommitStep(step);
        await editor.edit(b => b.insert(editor.selection.active, `\n// Copilot Chief: Paso completado y commit creado. Avanzando...\n`));
      } catch (e) {
        await editor.edit(b => b.insert(editor.selection.active, `\n// Copilot Chief: Paso completado pero falló commit (${e.message}). Avanzando...\n`));
      }
    } else {
      await editor.edit(b => b.insert(editor.selection.active, `\n// Copilot Chief: Paso marcado como completado. Avanzando...\n`));
    }
    activeListener.dispose();
    executeNextStep();
  });
}

function agentState() {
  return {
    planning,
    running,
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

module.exports = { startAgent, agentState, applyMemoryPlan, gitCommitStep, sanitizeCommitMessage };

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
