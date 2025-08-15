import * as vscode from 'vscode';
import { activateCopilotListener } from './copilotListener';
import { indexProject } from './projectIndexer';
import { initializeContext, summarizeNow, getMemoryStats } from './openaiClient';
import { activateChatPanel } from './panelCompat';

let globalContextCache = '';
export function getGlobalContext() { return globalContextCache; }

export async function activate(context: vscode.ExtensionContext) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root) {
    initializeContext(root);
    setTimeout(() => { try { globalContextCache = indexProject(root); } catch (e) { console.error('Index error', e); } }, 25);
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotBridge.openChatPanel', () => activateChatPanel(context)),
    vscode.commands.registerCommand('copilotBridge.reindex', async () => {
      if (root) {
        globalContextCache = indexProject(root);
        vscode.window.showInformationMessage('Proyecto reindexado.');
      }
    }),
    vscode.commands.registerCommand('copilotBridge.summarizeMemory', async () => {
      const summary = await summarizeNow();
      if (summary) vscode.window.showInformationMessage('Memoria resumida.');
      else vscode.window.showInformationMessage('Nada que resumir.');
    }),
    vscode.commands.registerCommand('copilotBridge.showMetrics', () => {
      const stats = getMemoryStats();
      vscode.window.showInformationMessage(`Mensajes: ${stats.messages} | Chars: ${stats.chars} | Resumen: ${stats.hasSummary}`);
    })
  );
  activateCopilotListener(context);
}

export function deactivate() {}
