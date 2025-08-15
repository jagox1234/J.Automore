const vscode = require('vscode');
const { startAgent } = require('./agent');

function activate(context) {
    const output = vscode.window.createOutputChannel('Copilot Chief');
    output.appendLine('[activate] Iniciando extensión Copilot Chief');
    const disposable = vscode.commands.registerCommand('copilotChief.startAgent', async () => {
        output.appendLine('[command] startAgent invoked');
        const objective = await vscode.window.showInputBox({
            prompt: 'Escribe el objetivo general para el Agente Jefe de Copilot',
            placeHolder: 'Ej: Implementar autenticación JWT con refresco de tokens'
        });
        if (objective) {
            output.appendLine('[command] objective recibido: ' + objective);
            startAgent(objective);
        } else {
            output.appendLine('[command] cancelado sin objetivo');
        }
    });
    context.subscriptions.push(disposable, output);
    output.appendLine('[activate] Comando registrado');
}

function deactivate() {}

module.exports = { activate, deactivate };
