import * as vscode from 'vscode';
import { activateCopilotListener } from './copilotListener';
import { indexProject } from './projectIndexer';
import { initializeContext } from './openaiClient';
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
    vscode.commands.registerCommand('copilotBridge.openChatPanel', () => activateChatPanel(context))
  );
  activateCopilotListener(context);
}

export function deactivate() {}
