const vscode = require('vscode');
const { startAgent } = require('./agent');
const https = require('https');
const cp = require('child_process');

function activate(context) {
    const output = vscode.window.createOutputChannel('Copilot Chief');
    output.appendLine('[activate] Iniciando extensión Copilot Chief');
    const disposable = vscode.commands.registerCommand('copilotChief.startAgent', async () => {
        output.appendLine('[command] startAgent invoked');
        const objective = await vscode.window.showInputBox({
            prompt: 'Escribe el objetivo general para el Agente Jefe de Copilot',
            placeHolder: 'Ej: Implementar autenticación JWT con refresco de tokens'
        });
        if (objective) {
            output.appendLine('[command] objective recibido: ' + objective);
            startAgent(objective);
        } else {
            output.appendLine('[command] cancelado sin objetivo');
        }
    });
    const manualUpdate = vscode.commands.registerCommand('copilotChief.checkUpdates', () => {
        checkForUpdate(output, context);
    });
    context.subscriptions.push(disposable, manualUpdate, output);
    output.appendLine('[activate] Comando registrado');

    // Chequeo de actualización
    const cfg = vscode.workspace.getConfiguration('copilotChief');
    if (cfg.get('autoUpdateCheck')) {
        scheduleUpdateChecks(cfg, output);
    }
}

function scheduleUpdateChecks(cfg, output) {
    const run = () => checkForUpdate(output, { silentInstall: cfg.get('autoUpdateSilent') });
    run(); // initial
    const minutes = cfg.get('updatePollMinutes');
    if (minutes > 0) {
        const ms = Math.max(1, minutes) * 60 * 1000;
        setInterval(run, ms);
        output.appendLine('[update] Polling cada ' + minutes + ' min');
    }
}

function checkForUpdate(output, opts={}) {
    return new Promise((resolve) => {
        const pkg = require('../package.json');
        const current = pkg.version;
        const options = {
            hostname: 'api.github.com',
            path: '/repos/jagox1234/J.Automore/releases/latest',
            headers: { 'User-Agent': 'copilot-chief-agent' }
        };
    https.get(options, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
            if (res.statusCode === 404) { output.appendLine('[update] No hay releases publicados aún (404).'); return resolve(); }
            if (res.statusCode !== 200) { output.appendLine('[update] HTTP ' + res.statusCode); return resolve(); }
                    const json = JSON.parse(data);
                    const asset = (json.assets||[]).find(a => a.name && a.name.endsWith('.vsix'));
                    const tag = json.tag_name || '';
                    const latestVer = (asset && /copilot-chief-agent-(\d+\.\d+\.\d+)\.vsix/.exec(asset.name))?.[1] || tag.replace(/^.*v/, '');
                    output.appendLine(`[update] Versión local ${current} - remota ${latestVer}`);
                                if (latestVer && isNewer(latestVer, current) && asset) {
                                                if (opts.silentInstall) {
                                    output.appendLine('[update] Nueva versión ' + latestVer + ' detectada. Instalación silenciosa...');
                                    downloadAndInstall(asset.browser_download_url, asset.name, output, latestVer).finally(resolve);
                                                } else {
                                                        vscode.window.showInformationMessage(`Copilot Chief Agent ${latestVer} disponible. ¿Actualizar ahora?`, 'Actualizar', 'Omitir')
                                                            .then(sel => {
                                                                if (sel === 'Actualizar') {
                                        downloadAndInstall(asset.browser_download_url, asset.name, output, latestVer).finally(resolve);
                                                                } else resolve();
                                                            });
                                                }
                    } else resolve();
                } catch (e) { output.appendLine('[update] parse error ' + e.message); resolve(); }
            });
        }).on('error', err => { output.appendLine('[update] req error ' + err.message); resolve(); });
    });
}

function isNewer(a, b) {
    const pa = a.split('.').map(n=>parseInt(n,10));
    const pb = b.split('.').map(n=>parseInt(n,10));
    for (let i=0;i<3;i++) { if (pa[i]>pb[i]) return true; if (pa[i]<pb[i]) return false; }
    return false;
}

function downloadAndInstall(url, name, output, versionHint) {
    return new Promise((resolve) => {
        const filePath = require('path').join(require('os').tmpdir(), name);
        output.appendLine('[update] Descargando ' + url);
        const fs = require('fs');
        const req = https.get(url, res => {
            if (res.statusCode !== 200) { output.appendLine('[update] descarga HTTP ' + res.statusCode); return resolve(); }
            const file = fs.createWriteStream(filePath);
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    output.appendLine('[update] Instalando VSIX ' + filePath);
                    try {
                        // Usa CLI de VS Code. Debe existir 'code' en PATH.
                        const cmd = process.platform.startsWith('win') ? `code --install-extension "${filePath}" --force` : `code --install-extension '${filePath}' --force`;
                        cp.exec(cmd, (err, stdout, stderr) => {
                            if (err) {
                                output.appendLine('[update] error instalación: ' + (stderr||err.message));
                            } else {
                                output.appendLine('[update] Instalado. Reinicia la ventana para aplicar.');
                                const verMsg = versionHint ? ' a ' + versionHint : '';
                                vscode.window.showInformationMessage('Copilot Chief actualizado' + verMsg + '. ¿Recargar ahora?', 'Recargar ahora', 'Luego')
                                  .then(choice => { if (choice === 'Recargar ahora') { vscode.commands.executeCommand('workbench.action.reloadWindow'); } });
                            }
                            resolve();
                        });
                    } catch(e) { output.appendLine('[update] excepción instalación: ' + e.message); resolve(); }
                });
            });
        });
        req.on('error', e => { output.appendLine('[update] error descarga: ' + e.message); resolve(); });
    });
}

function deactivate() {}

module.exports = { activate, deactivate };
