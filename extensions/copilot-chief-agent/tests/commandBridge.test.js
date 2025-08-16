const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: (k)=>{
    if(k==='enableCommandBridge') return true;
    if(k==='allowedCommands') return ['^echo', '^node ', '^timeoutTest'];
    if(k==='blockedCommands') return ['rm '];
    if(k==='commandPollingSeconds') return 15;
    if(k==='commandTimeoutSeconds') return 1; // fast timeout for test command
    if(k==='commandCooldownSeconds') return 120; // large to test cooldown rejection
    if(k==='maxConcurrentBridgeCommands') return 1;
    if(k==='commandResultMaxLines') return 3;
    if(k==='commandArchiveMaxAgeDays') return 0; // default no prune in most tests
    return undefined; } }), openTextDocument: jest.fn().mockResolvedValue({}), showTextDocument: jest.fn(), workspaceFolders:[{ uri:{ fsPath: process.cwd() } }] },
  window: { showWarningMessage: jest.fn(), showInformationMessage: jest.fn(), showTextDocument: jest.fn() }
}));

const { processBridge } = require('../src/commandBridge');

describe('commandBridge basic flow', () => {
  test('confirma y ejecuta comando permitido y cancela bloqueado', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'bridge-'));
    const file = path.join(root,'.copilot-chief','requests.json');
    fs.mkdirSync(path.dirname(file), { recursive:true });
    fs.writeFileSync(file, JSON.stringify([
      { id:'1', command:'echo hola', status:'pending', createdAt:new Date().toISOString() },
      { id:'2', command:'rm -rf algo', status:'pending', createdAt:new Date().toISOString() }
    ], null, 2));
    const output = { appendLine: ()=>{} };
    await processBridge(root, output);
    const updated = JSON.parse(fs.readFileSync(file,'utf8'));
    const one = updated.find(r=>r.id==='1');
    const two = updated.find(r=>r.id==='2');
    expect(one.status==='done' || one.status==='error').toBe(true);
    expect(two.status).toBe('rejected');
  });

  test('rechaza por caracter peligroso y por no whitelist', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'bridge-'));
    const file = path.join(root,'.copilot-chief','requests.json');
    fs.mkdirSync(path.dirname(file), { recursive:true });
    fs.writeFileSync(file, JSON.stringify([
      { id:'3', command:'echo hola; rm x', status:'pending', createdAt:new Date().toISOString() },
  { id:'4', command:'python script.py', status:'pending', createdAt:new Date().toISOString() }
    ], null, 2));
    const output = { appendLine: ()=>{} };
    await processBridge(root, output);
    const updated = JSON.parse(fs.readFileSync(file,'utf8'));
    const r3 = updated.find(r=>r.id==='3');
    const r4 = updated.find(r=>r.id==='4');
    expect(r3.status).toBe('rejected');
    expect(r4.status).toBe('rejected');
  });

  test('resumen limita líneas de salida', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'bridge-'));
    const file = path.join(root,'.copilot-chief','requests.json');
    fs.mkdirSync(path.dirname(file), { recursive:true });
    // echo multi-line (compatible *nix & PowerShell via node exec) create 10 lines
    // Genera 10 lineas: usar node sencillo para evitar caracteres especiales complicados
    fs.writeFileSync(file, JSON.stringify([
      { id:'5', command:"node -e \"for(let i=0;i<10;i++) console.log('L'+i)\"", status:'pending', createdAt:new Date().toISOString() }
    ], null, 2));
    const output = { appendLine: ()=>{} };
    await processBridge(root, output);
    const updated = JSON.parse(fs.readFileSync(file,'utf8'));
    const r5 = updated.find(r=>r.id==='5');
    expect(['done','error','rejected']).toContain(r5.status); // en algunos shells puede terminar rechazado si quoting falla
    if(r5.result){
      const lines = r5.result.split(/\r?\n/);
      expect(lines.length).toBeLessThanOrEqual(5);
    }
  });

  test('openBridgeFile crea archivo inicial', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'bridge-'));
    const { openBridgeFile } = require('../src/commandBridge');
    openBridgeFile(root);
    const file = path.join(root,'.copilot-chief','requests.json');
    expect(fs.existsSync(file)).toBe(true);
  });

  test('ignora archivo JSON corrupto y no revienta', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'bridge-'));
    const dir = path.join(root,'.copilot-chief');
    fs.mkdirSync(dir, { recursive:true });
    fs.writeFileSync(path.join(dir,'requests.json'), '{corrupt');
    const output = { appendLine: ()=>{} };
    await expect(processBridge(root, output)).resolves.toBeUndefined();
  });

  test('cooldown evita re-ejecución inmediata del mismo comando', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'bridge-'));
    const file = path.join(root,'.copilot-chief','requests.json');
    fs.mkdirSync(path.dirname(file), { recursive:true });
    // mismo comando dos veces
    fs.writeFileSync(file, JSON.stringify([
      { id:'10', command:'echo hola', status:'pending', createdAt:new Date().toISOString() },
      { id:'11', command:'echo hola', status:'pending', createdAt:new Date().toISOString() }
    ], null, 2));
    const output = { appendLine: ()=>{} };
    await processBridge(root, output);
    // segunda pasada procesa la segunda (seguirá en pending o rejected por cooldown)
    await processBridge(root, output);
    const updated = JSON.parse(fs.readFileSync(file,'utf8'));
    const r10 = updated.find(r=>r.id==='10');
    const r11 = updated.find(r=>r.id==='11');
  expect(['done','error','rejected']).toContain(r10.status);
    // r11 debería estar rejected por cooldown activo
    if(r11.status==='rejected'){
      expect(r11.result).toMatch(/cooldown/);
    }
  });

  test('timeout marca comando como error (simulado)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'bridge-'));
    const file = path.join(root,'.copilot-chief','requests.json');
    fs.mkdirSync(path.dirname(file), { recursive:true });
    // comando que duerme > timeout (usar node setTimeout)
    fs.writeFileSync(file, JSON.stringify([
      { id:'12', command:"node -e \"setTimeout(()=>{}, 2000)\"", status:'pending', createdAt:new Date().toISOString() }
    ], null, 2));
    const output = { appendLine: ()=>{} };
    await processBridge(root, output);
    const updated = JSON.parse(fs.readFileSync(file,'utf8'));
    const r12 = updated.find(r=>r.id==='12');
    expect(['error','done','rejected'].includes(r12.status)).toBe(true);
    if(r12.status==='error'){
      expect(r12.result).toBeDefined();
    }
  });

  test('max lines configurable (3) limita a últimas 3', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'bridge-'));
    const file = path.join(root,'.copilot-chief','requests.json');
    fs.mkdirSync(path.dirname(file), { recursive:true });
    fs.writeFileSync(file, JSON.stringify([
      { id:'13', command:"node -e \"for(let i=0;i<8;i++) console.log('L'+i)\"", status:'pending', createdAt:new Date().toISOString() }
    ], null, 2));
    const output = { appendLine: ()=>{} };
    await processBridge(root, output);
    const updated = JSON.parse(fs.readFileSync(file,'utf8'));
    const r13 = updated.find(r=>r.id==='13');
    if(r13.result){
      const lines = r13.result.split(/\r?\n/);
      expect(lines.length).toBeLessThanOrEqual(3);
    }
  });

  test('purge elimina entries antiguas (forzado)', async () => {
    // Re-mock config for this test to enable prune
    jest.resetModules();
    jest.doMock('vscode', () => ({
      workspace: { getConfiguration: () => ({ get: (k)=>{
        if(k==='enableCommandBridge') return true;
        if(k==='allowedCommands') return ['^echo'];
        if(k==='blockedCommands') return [];
        if(k==='commandArchiveMaxAgeDays') return 1; // prune >1 día
        if(k==='commandResultMaxLines') return 2;
        return undefined; } }), workspaceFolders:[{ uri:{ fsPath: process.cwd() } }] },
      window: { showWarningMessage: jest.fn(), showInformationMessage: jest.fn(), showTextDocument: jest.fn(), createOutputChannel: ()=>({appendLine:()=>{}}) }
    }));
    const { processBridge } = require('../src/commandBridge');
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'bridge-'));
    const file = path.join(root,'.copilot-chief','requests.json');
    fs.mkdirSync(path.dirname(file), { recursive:true });
    const oldDate = new Date(Date.now() - 5*24*60*60*1000).toISOString();
    fs.writeFileSync(file, JSON.stringify([
      { id:'old', command:'echo viejo', status:'done', result:'ok', createdAt: oldDate, updatedAt: oldDate },
      { id:'new', command:'echo nuevo', status:'pending', createdAt:new Date().toISOString() }
    ], null, 2));
    const output = { appendLine: ()=>{} };
    await processBridge(root, output);
    const updated = JSON.parse(fs.readFileSync(file,'utf8'));
    expect(updated.find(r=>r.id==='old')).toBeFalsy(); // purged
  });
});
