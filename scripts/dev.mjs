import { spawn } from 'node:child_process'

const exe = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const shell = process.platform === 'win32'

const children = [
  spawn(exe, ['tsx', 'watch', 'server/index.ts'], {
    stdio: 'inherit',
    shell,
  }),
  spawn(exe, ['vite', ...process.argv.slice(2)], { stdio: 'inherit', shell }),
]

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 300).unref()
}

for (const child of children) {
  child.on('exit', (code) => stop(code ?? 0))
  child.on('error', () => stop(1))
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
