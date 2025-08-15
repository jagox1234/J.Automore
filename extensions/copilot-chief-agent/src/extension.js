const vscode = require('vscode');
const { startAgent } = require('./agent');

function activate(context) {
    const disposable = vscode.commands.registerCommand('copilotChief.startAgent', async () => {
        const objective = await vscode.window.showInputBox({
            prompt: 'Escribe el objetivo general para el Agente Jefe de Copilot',
            placeHolder: 'Ej: Implementar autenticación JWT con refresco de tokens'
        });
        if (objective) {
            startAgent(objective);
        }
    });
    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };
