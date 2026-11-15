// VPS artifact only. Never overwrites the ordinary/local dist directory.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const env = { ...process.env, VITE_VPS_SOLO: '1' };
for (const args of [['node_modules/typescript/bin/tsc', '--noEmit'], ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'dist-vps']]) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
writeFileSync('dist-vps/deployment.json', JSON.stringify({ mode: 'solo', target: 'vps' }));
