const { startAgent } = require('../src/agent');
const vscode = require('vscode');

describe('agent early return without workspace', () => {
  test('no workspaceFolders', async () => {
    const prev = vscode.workspace.workspaceFolders;
    vscode.workspace.workspaceFolders = null;
    vscode.window.showErrorMessage = jest.fn();
    await startAgent('x');
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    vscode.workspace.workspaceFolders = prev;
  });
});
