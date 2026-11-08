// Starts the FastAPI backend on :8000 from backend/, using backend/.venv when it exists.
// Extra arguments (e.g. --reload) are passed to uvicorn.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend');
const venvPython = process.platform === 'win32'
  ? join(backend, '.venv', 'Scripts', 'python.exe')
  : join(backend, '.venv', 'bin', 'python');
const python = existsSync(venvPython) ? venvPython : process.platform === 'win32' ? 'python' : 'python3';

const child = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--port', '8000', ...process.argv.slice(2)], {
  cwd: backend,
  stdio: 'inherit',
});
child.on('error', e => {
  console.error(`Could not start the backend with "${python}": ${e.message}`);
  console.error('Create backend/.venv and run: pip install -r backend/requirements.txt');
  process.exit(1);
});
child.on('exit', code => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
