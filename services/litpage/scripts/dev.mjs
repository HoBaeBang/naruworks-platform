// Runs the API server (3001) and the Vite dev server (5173) together.
import { spawn } from 'node:child_process';
const procs = [
  ['server', ['--filter', '@nc/server', 'dev']],
  ['web', ['--filter', '@nc/web', 'dev']],
].map(([name, args]) => {
  const p = spawn('pnpm', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const tag = (s) => s.toString().split('\n').filter(Boolean).map((l) => `[${name}] ${l}`).join('\n') + '\n';
  p.stdout.on('data', (d) => process.stdout.write(tag(d)));
  p.stderr.on('data', (d) => process.stderr.write(tag(d)));
  return p;
});
const stop = () => { for (const p of procs) p.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
