import * as vscode from 'vscode';
import { askChatGPT } from './openaiClient';
import { getGlobalContext } from './extension';

export function activateChatPanel(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel('chatgptProjectLeader', 'ChatGPT Project Leader', vscode.ViewColumn.Beside, { enableScripts: true });
  panel.webview.html = getHtml();
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.command === 'sendObjective') {
      const plan = await askChatGPT('Divide este objetivo en pasos para Copilot:\n' + msg.text, getGlobalContext());
      panel.webview.postMessage({ command: 'showPlan', text: plan });
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        editor.edit(edit => edit.insert(editor.selection.active, '\n// PLAN INICIAL\n' + plan.split('\n').map(l => '// ' + l).join('\n') + '\n'));
      }
    }
  });
}

function getHtml() {
  return `<!DOCTYPE html><html><body>
  <h3>Objetivo del Proyecto</h3>
  <textarea id="objective" rows="4" style="width:100%"></textarea><br/><br/>
  <button onclick="sendObjective()">Enviar a ChatGPT</button>
  <h3>Plan generado:</h3>
  <pre id="plan"></pre>
  <script>
    const vscode = acquireVsCodeApi();
    function sendObjective(){ const text = document.getElementById('objective').value; vscode.postMessage({ command: 'sendObjective', text }); }
    window.addEventListener('message', ev => { if(ev.data.command==='showPlan'){ document.getElementById('plan').innerText = ev.data.text; }});
  </script>
  </body></html>`;
}
