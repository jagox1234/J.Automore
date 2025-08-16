#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-undef */
// Descarga e instala automáticamente el último VSIX publicado en GitHub Releases.
// Uso: npm run update:latest  (variable PRE=1 para incluir prereleases)
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const OWNER='jagox1234';
const REPO='J.Automore';
const INCLUDE_PRE= !!process.env.PRE; // PRE=1 para considerar prerelease

function get(url){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{ headers:{'User-Agent':'copilot-chief-agent-updater','Accept':'application/vnd.github+json'}},res=>{
      if(res.statusCode>=300 && res.statusCode<400 && res.headers.location){
        return resolve(get(res.headers.location.startsWith('http')? res.headers.location: new URL(res.headers.location,url).toString()));
      }
      if(res.statusCode>=400){ return reject(new Error('HTTP '+res.statusCode+' '+url)); }
      let buf=''; res.on('data',d=>buf+=d); res.on('end',()=>resolve(buf));
    }); req.on('error',reject);
  });
}

async function main(){
  process.stdout.write('[update] Consultando releases...\n');
  let release;
  try{
    if(INCLUDE_PRE){
      const list=JSON.parse(await get(`https://api.github.com/repos/${OWNER}/${REPO}/releases`));
      release=list.find(r=>!r.draft);
    } else {
      release=JSON.parse(await get(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`));
    }
  }catch(e){ console.error('[update] Error obteniendo releases:', e.message); process.exit(1); }
  if(!release||!release.assets){ console.error('[update] Release inválida'); process.exit(1); }
  const vsix=release.assets.find(a=>/\.vsix$/i.test(a.name));
  if(!vsix){ console.error('[update] No se encontró asset VSIX'); process.exit(1); }
  const tmpFile=path.join(os.tmpdir(), vsix.name);
  process.stdout.write('[update] Descargando '+vsix.name+'...\n');
  const fileBuf = await new Promise((resolve,reject)=>{
    https.get(vsix.browser_download_url,{ headers:{'User-Agent':'copilot-chief-agent-updater','Accept':'application/octet-stream'}},res=>{
      if(res.statusCode>=300 && res.statusCode<400 && res.headers.location){
        return https.get(res.headers.location, r2=>{ const chunks=[]; r2.on('data',c=>chunks.push(c)); r2.on('end',()=>resolve(Buffer.concat(chunks))); r2.on('error',reject); });
      }
      if(res.statusCode>=400) return reject(new Error('HTTP '+res.statusCode));
      const chunks=[]; res.on('data',c=>chunks.push(c)); res.on('end',()=>resolve(Buffer.concat(chunks))); res.on('error',reject);
    }).on('error',reject);
  });
  fs.writeFileSync(tmpFile,fileBuf);
  process.stdout.write('[update] Guardado en '+tmpFile+' ('+fileBuf.length+' bytes)\n');
  const codeCmd = process.platform.startsWith('win')? 'code.cmd':'code';
  process.stdout.write('[update] Instalando VSIX con '+codeCmd+'...\n');
  try{
    cp.execSync(`${codeCmd} --install-extension "${tmpFile}"`, { stdio:'inherit' });
  }catch(e){ console.error('[update] Error instalando VSIX:', e.message); process.exit(1); }
  process.stdout.write('[update] Instalación completada. Si no se recarga sola la ventana, usa: Reload Window.\n');
  process.stdout.write('[update] Versión release: '+(release.tag_name||'?')+'\n');
}

main();
