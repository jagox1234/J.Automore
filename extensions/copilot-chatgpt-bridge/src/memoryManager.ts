import fs from 'fs';
import path from 'path';

export interface MemoryMessage { role: 'system' | 'user' | 'assistant'; content: string; }

function getMemoryPath(root: string) {
  const dir = path.join(root, '.copilot-bridge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'memory.json');
}

export function loadMemory(root: string): MemoryMessage[] {
  try {
    const p = getMemoryPath(root);
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error cargando memoria', e);
  }
  return [];
}

export function saveMemory(root: string, conversation: MemoryMessage[]) {
  try {
    const p = getMemoryPath(root);
    fs.writeFileSync(p, JSON.stringify(conversation, null, 2), 'utf8');
  } catch (e) {
    console.error('Error guardando memoria', e);
  }
}
