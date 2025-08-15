#!/usr/bin/env node
/**
 * Descarga e instala la última versión del VSIX del agente desde Releases.
 * Requiere: node >=18 (fetch global) y que tengas 'code' en PATH.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'jagox1234/J.Automore';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

async function main() {
  const res = await fetch(API, { headers: { 'User-Agent': 'chief-agent-updater' }});
  if (!res.ok) {
    console.error('Error obteniendo release:', res.status, await res.text());
    process.exit(1);
  }
  const json = await res.json();
  const asset = (json.assets || []).find(a => a.name && a.name.endsWith('.vsix'));
  if (!asset) {
    console.error('No se encontró asset VSIX en el último release.');
    process.exit(1);
  }
  const url = asset.browser_download_url;
  const fileName = path.join(process.cwd(), asset.name);
  console.log('Descargando', url);
  const bin = await fetch(url);
  if (!bin.ok) {
    console.error('Fallo descarga VSIX:', bin.status, await bin.text());
    process.exit(1);
  }
  const arrayBuffer = await bin.arrayBuffer();
  fs.writeFileSync(fileName, Buffer.from(arrayBuffer));
  console.log('Guardado:', fileName);
  try {
    execSync(`code --install-extension "${fileName}" --force`, { stdio: 'inherit' });
    console.log('Extensión instalada/actualizada.');
  } catch (e) {
    console.error('Error instalando VSIX con code CLI:', e.message);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
