// Starts the server and the Vite dev server together (watch mode).
import { spawn } from 'node:child_process';

const targets = ['packages/server', 'packages/web'];
const children = targets.map((workspace) =>
  spawn('npm', ['run', 'dev', '--workspace', workspace], { stdio: 'inherit' }),
);

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) {
  child.on('exit', (code) => {
    if (code) {
      stop();
      process.exitCode = code;
    }
  });
}
