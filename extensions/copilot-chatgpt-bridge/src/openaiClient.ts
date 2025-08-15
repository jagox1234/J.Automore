import OpenAI from 'openai';
import * as vscode from 'vscode';
import { loadMemory, saveMemory, MemoryMessage } from './memoryManager';
import { indexProject } from './projectIndexer';

let memory: MemoryMessage[] = [];
let rootPath = '';
let projectIndex = '';
let projectSummary = '';

export function initializeContext(root: string) {
  rootPath = root;
  memory = loadMemory(rootPath);
  const summaryEntry = memory.find(m => m.role === 'system' && m.content.startsWith('Resumen del proyecto:'));
  if (summaryEntry) projectSummary = summaryEntry.content;
  projectIndex = indexProject(rootPath);
}

function getApiKey(): string {
  const key = vscode.workspace.getConfiguration('copilotBridge').get<string>('openaiApiKey') || '';
  if (!key) throw new Error('Configura copilotBridge.openaiApiKey');
  return key;
}

async function ensureSummary(client: OpenAI) {
  if (memory.length <= 20) return;
  const res = await client.chat.completions.create({
    model: vscode.workspace.getConfiguration('copilotBridge').get('model', 'gpt-4o-mini') as string,
    messages: [
      { role: 'system', content: 'Eres un asistente que resume conversaciones conservando decisiones técnicas.' },
      { role: 'user', content: 'Resume (<500 palabras) manteniendo convenciones y arquitectura:\n' + JSON.stringify(memory) }
    ]
  });
  projectSummary = 'Resumen del proyecto: ' + (res.choices?.[0]?.message?.content || '');
  memory = [{ role: 'system', content: projectSummary }];
  saveMemory(rootPath, memory);
}

export async function askChatGPT(message: string): Promise<string> {
  const apiKey = getApiKey();
  const client = new OpenAI({ apiKey });
  memory.push({ role: 'user', content: message });
  await ensureSummary(client);
  const base: MemoryMessage[] = [
    { role: 'system', content: 'Eres el líder técnico. Responde de forma accionable y breve.' },
    { role: 'system', content: 'Contexto global del proyecto:\n' + projectIndex.slice(0, 120000) }
  ];
  if (projectSummary) base.push({ role: 'system', content: projectSummary });
  const res = await client.chat.completions.create({
    model: vscode.workspace.getConfiguration('copilotBridge').get('model', 'gpt-4o-mini') as string,
    messages: [...base, ...memory]
  });
  const reply = res.choices?.[0]?.message?.content || '';
  memory.push({ role: 'assistant', content: reply });
  saveMemory(rootPath, memory);
  return reply;
}

export function getConversation() { return memory.slice(-30); }
