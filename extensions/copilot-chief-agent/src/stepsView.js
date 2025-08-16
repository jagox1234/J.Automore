const vscode = require('vscode');
const { loadMemory } = require('./memoryManager');

class StepsTreeDataProvider {
  constructor(getState, getRoot){
    this.getState = getState; // function returning { objective, total, remaining }
    this.getRoot = getRoot; // function returning root path
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }
  refresh(){ this._onDidChangeTreeData.fire(); }
  getTreeItem(element){ return element; }
  getChildren(){
    const root = this.getRoot();
    if(!root) return [];
    const mem = loadMemory(root);
    const stepsRaw = mem.steps || mem.stepsRaw || [];
    const completed = new Set(mem.completed||[]);
    const items = [];
    const stepMeta = mem.stepMeta || {};
    const now = Date.now();
    for(const s of stepsRaw){
      const meta = stepMeta[s]||{};
      let desc = '';
      if(meta.startedAt && !meta.completedAt){
        const ms = now - Date.parse(meta.startedAt);
        desc = 'En progreso '+Math.round(ms/1000)+'s';
      } else if(meta.completedAt){
        const dur = (Date.parse(meta.completedAt) - Date.parse(meta.startedAt||meta.completedAt)) / 1000;
        desc = 'Completado ('+Math.max(0,Math.round(dur))+'s)';
      }
      const icon = completed.has(s) ? 'check' : (meta.startedAt ? 'loading~spin' : 'circle-large-outline');
      const item = new vscode.TreeItem(s, vscode.TreeItemCollapsibleState.None);
      item.description = desc;
      item.iconPath = new vscode.ThemeIcon(icon);
      if(!completed.has(s)){
        item.command = { command:'copilotChief.skipCurrentStep', title:'Marcar completado' };
        item.contextValue = 'pendingStep';
      } else {
        item.contextValue = 'doneStep';
      }
      items.push(item);
    }
    return items;
  }
}

module.exports = { StepsTreeDataProvider };
