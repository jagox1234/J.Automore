import * as vscode from 'vscode';
import { ChatPanel } from './chatPanel';

// Heurística básica para detectar probable inserción de Copilot:
// - Cambio multilinea o contiene comentarios con interrogación.
function looksLikeCopilotInsertion(text: string) {
  if (text.includes('Copilot')) return true;
  if (text.split('\n').length > 3) return true;
  if (text.match(/\/\/.*\?/)) return true;
  if (text.includes('¿') || text.includes('?')) return true;
  return false;
}

export function activateCopilotListener(context: vscode.ExtensionContext) {
  const disposable = vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (event.contentChanges.length === 0) return;
    const change = event.contentChanges[0];
    const text = change.text;
    if (!text) return;
    if (!looksLikeCopilotInsertion(text)) return;
    if (!ChatPanel.current) return;
    await ChatPanel.current.handleCopilotQuestion(text);
  });
  context.subscriptions.push(disposable);
}
