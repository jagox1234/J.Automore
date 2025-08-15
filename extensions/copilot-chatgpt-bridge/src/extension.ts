import * as vscode from 'vscode';
import { ChatPanel } from './chatPanel';
import { activateCopilotListener } from './copilotListener';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotBridge.start', () => {
      ChatPanel.createOrShow(context);
    }),
    vscode.commands.registerCommand('copilotBridge.setGoal', async () => {
      const goal = await vscode.window.showInputBox({ prompt: 'Objetivo general' });
      if (goal && ChatPanel.current) {
        ChatPanel.current['goal'] = goal; // quick set
      }
    }),
    vscode.commands.registerCommand('copilotBridge.toggle', () => {
      if (ChatPanel.current) {
        (ChatPanel.current as any).autoMode = !(ChatPanel.current as any).autoMode;
      }
    })
  );

  activateCopilotListener(context);
}

export function deactivate() {}
