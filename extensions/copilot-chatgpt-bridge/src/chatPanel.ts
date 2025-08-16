import * as vscode from 'vscode';
import { askChatGPT } from './openaiClient';

interface ChatItem { role: 'user' | 'assistant'; content: string; timestamp: number; }

export class ChatPanel {
  public static current: ChatPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private chat: ChatItem[] = [];
  private goal: string = '';
  private autoMode = true;

  static createOrShow(context: vscode.ExtensionContext) {
    if (ChatPanel.current) {
      ChatPanel.current.panel.reveal();
      return ChatPanel.current;
    }
    const panel = vscode.window.createWebviewPanel('copilotBridge', 'Copilot ↔ ChatGPT Bridge', vscode.ViewColumn.Beside, {
      enableScripts: true
    });
    ChatPanel.current = new ChatPanel(panel, context);
    return ChatPanel.current;
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.panel.webview.html = this.render();
  this.panel.webview.onDidReceiveMessage(async (msg: any) => {
      if (msg.type === 'setGoal') {
        this.goal = msg.value;
        this.append('user', `OBJETIVO: ${this.goal}`);
        this.panel.webview.postMessage({ type: 'state', chat: this.chat });
        await this.seedGoal();
      } else if (msg.type === 'ask') {
        await this.handleUserPrompt(msg.value);
      } else if (msg.type === 'toggleAuto') {
        this.autoMode = !this.autoMode;
        this.panel.webview.postMessage({ type: 'autoMode', value: this.autoMode });
      }
    }, undefined, this.disposables);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private render() {
    const script = `
      const vscodeApi = acquireVsCodeApi();
      function send(type, value){ vscodeApi.postMessage({ type, value }); }
      window.addEventListener('message', ev => {
        const data = ev.data;
        if(!data) return;
        const type = data.type;
        if(type==='state'){ render(data.chat || []); }
        if(type==='autoMode'){ document.getElementById('autoState').textContent = data.value ? 'ON' : 'OFF'; }
      });
      function render(chat){
        const wrap = document.getElementById('chat');
        wrap.innerHTML = (chat||[]).map(c => '<div class="msg '+c.role+'"><b>'+c.role+':</b> '+c.content+'</div>').join('');
        wrap.scrollTop = wrap.scrollHeight;
      }
      document.getElementById('goalForm').addEventListener('submit', e => { e.preventDefault(); send('setGoal', (document.getElementById('goal')||{}).value); });
      document.getElementById('askForm').addEventListener('submit', e => { e.preventDefault(); const el = (document.getElementById('prompt')||{}); send('ask', el.value); el.value=''; });
      document.getElementById('toggleAuto').addEventListener('click', ()=> send('toggleAuto'));
    `;
    const html = `<!DOCTYPE html><html><head><style>
  body { font-family: sans-serif; margin:0; padding:10px; }
  #chat { max-height:55vh; overflow:auto; background:#111; color:#eee; padding:8px; font-size:12px; }
  .msg.user { color:#9cdcfe; }
  .msg.assistant { color:#c3e88d; }
  .bar { display:flex; gap:4px; }
  input[type=text] { width:100%; }
  button { cursor:pointer; }
  </style></head><body>
  <h3>Copilot ↔ ChatGPT Bridge <small>Auto:<span id="autoState">ON</span></small></h3>
  <form id="goalForm" class="bar"><input id="goal" placeholder="Objetivo general" /><button>Set</button></form>
  <div id="chat"></div>
  <form id="askForm" class="bar"><input id="prompt" placeholder="Mensaje manual" /><button>Enviar</button><button type="button" id="toggleAuto">Auto</button></form>
  <script>${script}</script>
  </body></html>`;
    return html;
  }

  private append(role: 'user' | 'assistant', content: string) {
    this.chat.push({ role, content, timestamp: Date.now() });
    this.panel.webview.postMessage({ type: 'state', chat: this.chat });
  }

  private lastN(n: number) {
    return this.chat.slice(-n).map(c => ({ role: c.role, content: c.content }));
  }

  private async seedGoal() {
    if (!this.goal) return;
    const system = [{ role: 'user' as const, content: `Estructura el objetivo en pasos numerados y primera instrucción para empezar: ${this.goal}` }];
  const answer = await askChatGPT(system[0].content);
    this.append('assistant', answer.trim());
    this.insertInEditor(`// OBJETIVO:\n// ${this.goal}\n// PASOS INICIALES:\n${answer.split('\n').map(l => '// ' + l).join('\n')}`);
  }

  private async handleUserPrompt(prompt: string) {
    if (!prompt) return;
    this.append('user', prompt);
  const answer = await askChatGPT(prompt);
    this.append('assistant', answer.trim());
    this.insertInEditor(this.wrapAnswer(answer));
  }

  public async handleCopilotQuestion(text: string) {
    if (!this.autoMode) return;
    this.append('user', '[Copilot] ' + text.trim());
  const answer = await askChatGPT(text);
    this.append('assistant', answer.trim());
    this.insertInEditor(this.wrapAnswer(answer));
  }

  private wrapAnswer(answer: string) {
    const mode = vscode.workspace.getConfiguration('copilotBridge').get('insertMode');
    if (mode === 'inline') return answer + '\n';
    return answer.split('\n').map(l => `// ${l}`).join('\n') + '\n';
  }

  private insertInEditor(text: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    editor.edit((edit: vscode.TextEditorEdit) => {
      edit.insert(editor.selection.active, '\n' + text + '\n');
    });
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
    ChatPanel.current = undefined;
  }
}
