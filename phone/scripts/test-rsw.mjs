import { encryptWavBytes, decryptToWavBytes, wavToPcm, pcmToWav } from '../src/rsw.js';
import assert from 'node:assert/strict';

const sampleRate = 44100;
const channels = 1;
const pcm = new Uint8Array(4096);
for (let i = 0; i < pcm.length; i += 2) {
  const s = Math.sin(i / 40) * 12000;
  pcm[i] = s & 0xff;
  pcm[i + 1] = (s >> 8) & 0xff;
}
const wav = pcmToWav(pcm, sampleRate, channels);
const pass = 'test-passphrase-rusamarawave';

const rsw = await encryptWavBytes(wav, pass);
assert.equal(String.fromCharCode(...rsw.subarray(0, 4)), 'RSWK');

const back = await decryptToWavBytes(rsw, pass);
const decoded = wavToPcm(back);
assert.equal(decoded.sampleRate, sampleRate);
assert.equal(decoded.channels, channels);
assert.equal(decoded.pcm.length, pcm.length);
assert.deepEqual(decoded.pcm, pcm);

let failed = false;
try {
  await decryptToWavBytes(rsw, 'wrong-password');
} catch {
  failed = true;
}
assert.equal(failed, true);

console.log('RSWK roundtrip OK, size=', rsw.length);
