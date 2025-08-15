import * as vscode from 'vscode';
import { askChatGPT } from './openaiClient';
import { getGlobalContext } from './extension';

function looksLikeCopilotQuestion(text: string) {
  if (!text) return false;
  if (text.includes('?') || text.includes('¿')) return true;
  if (/should|do you want|prefer|usar/i.test(text)) return true;
  return false;
}

export function activateCopilotListener(context: vscode.ExtensionContext) {
  const listener = vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (!event.contentChanges.length) return;
    const text = event.contentChanges[0].text;
    if (!looksLikeCopilotQuestion(text)) return;
    try {
      const answer = await askChatGPT(text + '\n(Responde alineado al objetivo y contexto del proyecto)');
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        editor.edit(edit => edit.insert(editor.selection.active, '\n// ' + answer.split('\n').join('\n// ') + '\n'));
      }
    } catch (e: any) {
      console.error('Error en respuesta ChatGPT', e.message);
    }
  });
  context.subscriptions.push(listener);
}
