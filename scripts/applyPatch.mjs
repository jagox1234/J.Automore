#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';

function run(cmd) {
  return execSync(cmd, { stdio: 'inherit' });
}

function main() {
  if (!fs.existsSync('review.patch')) {
    console.error('review.patch no existe. Genera primero con: npm run review:patches');
    process.exit(1);
  }
  try {
    console.log('Verificando patch...');
    execSync('git apply --check review.patch', { stdio: 'inherit' });
  } catch (e) {
    console.error('El patch no aplica limpio. Aborta.');
    process.exit(2);
  }
  if (process.env.DRY_RUN === '1') {
    console.log('DRY_RUN=1 -> No se aplica el patch, solo verificación OK.');
    return;
  }
  console.log('Aplicando patch...');
  execSync('git apply review.patch', { stdio: 'inherit' });
  console.log('Añadiendo cambios...');
  execSync('git add .', { stdio: 'inherit' });
  try {
    execSync('git diff --cached --quiet');
    console.log('No hay cambios después de aplicar el patch.');
    return;
  } catch {
    // staged changes exist
  }
  const message = process.env.COMMIT_MESSAGE || 'feat(ai): aplicar patch de revisión';
  run(`git commit -m "${message}"`);
  if (process.env.PUSH === '1') {
    console.log('Haciendo push...');
    run('git push');
  } else {
    console.log('Patch aplicado y commit creado (sin push).');
  }
}

main();
