const vscode = require('vscode');
// We will mock modules AFTER capturing originals where needed

// Mock OpenAI: base plan vs regenerate plan
jest.mock('../src/openaiClient', ()=> ({ askChatGPT: jest.fn().mockImplementation(async (p)=> /Regenera un plan/.test(p) ? '1. Paso A\n2. Paso B\n3. Paso Nuevo' : '1. Paso A\n2. Paso B') }));

// Simple in-memory memory store keyed by root path
const memStore = {};
jest.mock('../src/memoryManager', ()=> ({
  saveMemory: (root, data)=> { memStore[root] = JSON.parse(JSON.stringify(data)); },
  loadMemory: (root)=> memStore[root] || { completed: [], steps: [] }
}));

// stepManager uses list of steps + completed; we replicate logic
jest.mock('../src/stepManager', ()=> ({
  nextStep: (steps, completed)=> steps.find(s=> !completed.includes(s)),
  markStepComplete: (root, step)=>{ const m = memStore[root] || (memStore[root]={ completed:[], steps:[] }); if(!m.completed.includes(step)) m.completed.push(step); }
}));

jest.mock('../src/projectScanner', ()=> ({ scanProject: ()=> 'CTX'}));

const { startAgent, pauseAgent, stopAgent, skipCurrentStep, regeneratePlan, manualAdvanceStep, agentState, gitCommitStep } = require('../src/agent');

// VS Code mocks
vscode.window.showInformationMessage = ()=>{};
vscode.window.showWarningMessage = ()=>{};
vscode.window.showErrorMessage = ()=>{};
vscode.window.setStatusBarMessage = ()=>{};

// Test root folder
vscode.workspace.workspaceFolders = [{ uri:{ fsPath: __dirname } }];

// Configuration toggles handled via getConfiguration
let config = { maxPlanSteps: 5, autoGitCommit: false, confirmEachStep: true };
vscode.workspace.getConfiguration = ()=> ({ get: (k)=> config[k] });

// Basic editor + listener plumbing
let changeListener = null;
vscode.workspace.onDidChangeTextDocument = (cb)=> { changeListener = cb; return { dispose:()=>{} }; };
const editor = { selection:{ active:{} }, edit: async (fn)=> fn({ insert: ()=>{} }), document: {} };
vscode.window.activeTextEditor = editor;

function fireChange(text){ changeListener && changeListener({ document: editor.document, contentChanges:[{ text }] }); }

describe('agent control flows', () => {
  test('confirmEachStep sets waitingManual until manualAdvanceStep', async () => {
    await startAgent('Obj');
    // First change completes Paso A, should now wait manual advance (no auto progression to Paso B)
    fireChange('codigo paso A');
    await new Promise(r=>setImmediate(r));
    const before = memStore[__dirname];
    expect(before.completed).toContain('Paso A');
    // Not yet completed Paso B
    expect(before.completed).not.toContain('Paso B');
  manualAdvanceStep(); // should insert next step
  // allow executeNextStep to finish editor insertion + listener registration
  await new Promise(r=>setImmediate(r));
  fireChange('codigo paso B');
    await new Promise(r=>setImmediate(r));
    const after = memStore[__dirname];
    expect(after.completed).toContain('Paso B');
  });

  test('skipCurrentStep marks and advances', async () => {
    // Reset state via new start
    config.confirmEachStep = false;
    await startAgent('Obj Skip');
    fireChange('algo para completar Paso A');
    await new Promise(r=>setImmediate(r));
    // Start again to simulate another run where we skip immediately after insertion of Paso B
    config.confirmEachStep = true; // reinstate manual to freeze on next step insertion
  manualAdvanceStep(); // proceed to Paso B insertion
  await new Promise(r=>setImmediate(r));
    // Instead of editing, we skip it
    skipCurrentStep();
    // Should have Paso B marked complete due to skip and now waiting insertion for next (none left so running false eventually)
    const mem = memStore[__dirname];
    expect(mem.completed).toContain('Paso B');
  });

  test('regeneratePlan appends new step and continues when running', async () => {
    // Ensure we have completed first two steps
    const mem = memStore[__dirname];
    mem.completed = ['Paso A','Paso B'];
    // Running state may be false; force a resume scenario
    config.confirmEachStep = false;
    regeneratePlan();
    await new Promise(r=>setTimeout(r,10));
    const mem2 = memStore[__dirname];
    expect(mem2.steps.length >= 3).toBe(true);
  });

  test('pause and stop prevent further progression', async () => {
    await startAgent('Obj Stop');
    pauseAgent();
    const statePaused = agentState();
    expect(statePaused.paused).toBe(true);
    stopAgent();
    const stateStopped = agentState();
    expect(stateStopped.running).toBe(false);
  });

  test('gitCommitStep non-windows branch executes', async () => {
    // Temporarily spoof platform if currently windows
    const original = process.platform;
    const isWin = original.startsWith('win');
    if (isWin) {
      Object.defineProperty(process, 'platform', { value: 'linux' });
    }
    const cp = require('child_process');
    jest.spyOn(cp, 'exec').mockImplementation((cmd, opts, cb)=> cb(null,'ok'));
    const out = await gitCommitStep('Paso C');
    expect(out).toBe('ok');
    // restore
    if (isWin) Object.defineProperty(process, 'platform', { value: original });
  });
});
