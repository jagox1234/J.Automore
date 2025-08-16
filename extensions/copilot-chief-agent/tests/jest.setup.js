/* eslint-disable no-undef */
process.env.COPILOT_CHIEF_TEST_TIMEOUT = '200';

// Mock básico de vscode para tests unitarios (evita depender del host de extensión)
try {
	require.resolve('vscode');
} catch {
	const mockVscode = {
		workspace: {
			workspaceFolders: null,
			getConfiguration: ()=> ({ get: ()=> undefined }),
			onDidChangeTextDocument: ()=> ({ dispose:()=>{} }),
			createFileSystemWatcher: ()=> ({ onDidChange:()=>{}, onDidCreate:()=>{}, dispose:()=>{} })
		},
		window: {
			createOutputChannel: ()=> ({ appendLine:()=>{} }),
			showInformationMessage: ()=>{},
			showWarningMessage: ()=>{},
			showErrorMessage: ()=>{},
			setStatusBarMessage: ()=>{},
			createWebviewPanel: ()=> ({ webview:{ html:'', postMessage:()=>{} }, onDidDispose:()=>{} }),
			createStatusBarItem: ()=> ({ show:()=>{}, hide:()=>{}, dispose:()=>{} })
		},
		Uri: { file: p=>({ fsPath:p }) },
		ProgressLocation: { Notification: 1 },
		RelativePattern: function(){},
		env: { clipboard:{ writeText:()=>{} }, openExternal:()=>{} },
		commands: { registerCommand: ()=> ({ dispose:()=>{} }), executeCommand: ()=>{} },
		ViewColumn: { Beside: 2 },
		workspaceFolders: null
	};
	// Inyectar en require cache bajo clave 'vscode'
	const Module = require('module');
	const m = new Module('vscode');
	m.exports = mockVscode;
	require.cache['vscode'] = m;
}
