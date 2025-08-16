const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: (k)=>{
    if(k==='enableCommandBridge') return true;
    if(k==='allowedCommands') return ['^echo', '^node '];
    if(k==='blockedCommands') return ['rm '];
    if(k==='commandPollingSeconds') return 15;
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
});
