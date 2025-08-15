import OpenAI from 'openai';
import * as vscode from 'vscode';

export class OpenAIClient {
  private client: OpenAI | null = null;

  private ensure() {
    if (this.client) return this.client;
    const apiKey = vscode.workspace.getConfiguration('copilotBridge').get<string>('openaiApiKey');
    if (!apiKey) {
      throw new Error('Configura copilotBridge.openaiApiKey en settings.');
    }
    this.client = new OpenAI({ apiKey });
    return this.client;
  }

  async ask(messages: { role: 'user' | 'assistant' | 'system'; content: string }[], model?: string): Promise<string> {
    const m = model || vscode.workspace.getConfiguration('copilotBridge').get<string>('model', 'gpt-4o-mini');
    const client = this.ensure();
    const prompt = messages.map(x => `${x.role.toUpperCase()}: ${x.content}`).join('\n');
    const res = await client.responses.create({ model: m, input: prompt });
    return res.output_text || '';
  }
}

export const openaiClient = new OpenAIClient();
