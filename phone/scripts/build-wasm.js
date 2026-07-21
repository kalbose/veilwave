const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cipher = path.resolve(root, '..', 'audio-cipher');
const outWasm = path.join(root, 'www', 'engine.wasm');
const outExec = path.join(root, 'www', 'wasm_exec.js');

const goroot = execSync('go env GOROOT', { encoding: 'utf8' }).trim();
const wasmExecSrc = path.join(goroot, 'lib', 'wasm', 'wasm_exec.js');

console.log('Building engine.wasm…');
execSync('go build -o "' + outWasm + '" ./cmd/wasm', {
  cwd: cipher,
  env: { ...process.env, GOOS: 'js', GOARCH: 'wasm' },
  stdio: 'inherit',
});

fs.copyFileSync(wasmExecSrc, outExec);
console.log('OK:', outWasm);
