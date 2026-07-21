/**
 * RuSamaraWave RSWK container (.rswk)
 *
 * Layout (little-endian):
 *   magic[4]   = "RSWK"
 *   version    u8 = 1
 *   flags      u8
 *   salt_len   u16
 *   salt       salt_len bytes
 *   nonce      24 bytes (XChaCha20)
 *   cipher_len u32
 *   ciphertext cipher_len bytes  (AEAD: plaintext || 16-byte Poly1305 tag)
 *
 * Plaintext payload:
 *   sample_rate u32
 *   channels    u16
 *   bits        u16  (must be 16)
 *   pcm_len     u32
 *   pcm         pcm_len bytes
 *
 * key = Argon2id(password, salt, t=2, m=65536 KiB, p=1, len=32)
 */

export const RSW_MAGIC = 'RSWK';
export const RSW_VERSION = 1;
export const ARGON_TIME = 2;
export const ARGON_MEM_KIB = 65536;
export const ARGON_PARALLEL = 1;
export const SALT_LEN = 16;
export const NONCE_LEN = 24;
export const KEY_LEN = 32;

import { argon2id } from 'hash-wasm';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

function teEncode(str) {
  return new TextEncoder().encode(str);
}

function u16le(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32le(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function concat(...parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function deriveKey(password, salt) {
  const hash = await argon2id({
    password,
    salt,
    parallelism: ARGON_PARALLEL,
    iterations: ARGON_TIME,
    memorySize: ARGON_MEM_KIB,
    hashLength: KEY_LEN,
    outputType: 'binary',
  });
  return new Uint8Array(hash);
}

/**
 * @param {object} opts
 * @param {Uint8Array} opts.pcm
 * @param {number} opts.sampleRate
 * @param {number} opts.channels
 * @param {string} opts.password
 * @returns {Promise<Uint8Array>}
 */
export async function encryptRsw({ pcm, sampleRate, channels, password }) {
  if (!password) throw new Error('пустой пароль');
  if (!(pcm instanceof Uint8Array) || pcm.length === 0) throw new Error('пустой PCM');
  if (pcm.length % 2 !== 0) throw new Error('PCM должен быть 16-bit (чётная длина)');
  if (!sampleRate || !channels) throw new Error('нужны sampleRate и channels');

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const key = await deriveKey(password, salt);

  const payload = concat(
    u32le(sampleRate >>> 0),
    u16le(channels & 0xffff),
    u16le(16),
    u32le(pcm.length >>> 0),
    pcm,
  );

  const aead = xchacha20poly1305(key, nonce);
  const ciphertext = aead.encrypt(payload);

  return concat(
    teEncode(RSW_MAGIC),
    new Uint8Array([RSW_VERSION, 0]),
    u16le(salt.length),
    salt,
    nonce,
    u32le(ciphertext.length),
    ciphertext,
  );
}

/**
 * @param {Uint8Array} bytes
 * @param {string} password
 * @returns {Promise<{ pcm: Uint8Array, sampleRate: number, channels: number, bits: number }>}
 */
export async function decryptRsw(bytes, password) {
  if (!password) throw new Error('пустой пароль');
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 + 1 + 1 + 2 + SALT_LEN + NONCE_LEN + 4) {
    throw new Error('файл слишком короткий');
  }

  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== RSW_MAGIC) throw new Error('не формат RSWK');

  const version = bytes[4];
  if (version !== RSW_VERSION) throw new Error(`неподдерживаемая версия RSW: ${version}`);

  let off = 6;
  const saltLen = new DataView(bytes.buffer, bytes.byteOffset + off, 2).getUint16(0, true);
  off += 2;
  if (saltLen < 8 || saltLen > 64) throw new Error('некорректная соль');
  const salt = bytes.subarray(off, off + saltLen);
  off += saltLen;

  const nonce = bytes.subarray(off, off + NONCE_LEN);
  off += NONCE_LEN;

  const cipherLen = new DataView(bytes.buffer, bytes.byteOffset + off, 4).getUint32(0, true);
  off += 4;
  if (off + cipherLen > bytes.length) throw new Error('обрезанный файл');
  const ciphertext = bytes.subarray(off, off + cipherLen);

  const key = await deriveKey(password, salt);
  const aead = xchacha20poly1305(key, nonce);
  let payload;
  try {
    payload = aead.decrypt(ciphertext);
  } catch {
    throw new Error('неверный пароль или повреждённый файл');
  }

  if (payload.length < 12) throw new Error('пустой payload');
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const sampleRate = dv.getUint32(0, true);
  const channels = dv.getUint16(4, true);
  const bits = dv.getUint16(6, true);
  const pcmLen = dv.getUint32(8, true);
  if (bits !== 16) throw new Error('поддерживается только 16-bit PCM');
  if (12 + pcmLen > payload.length) throw new Error('повреждённый payload');
  const pcm = payload.subarray(12, 12 + pcmLen);
  if (pcm.length % 2 !== 0) throw new Error('нечётный PCM');

  return { pcm: new Uint8Array(pcm), sampleRate, channels, bits };
}

/** Build a minimal WAV from PCM for preview/save */
export function pcmToWav(pcm, sampleRate, channels) {
  const dataSize = pcm.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (o, s) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

/** Parse WAV 16-bit PCM (fmt+data) */
export function wavToPcm(wavBytes) {
  if (wavBytes.length < 44) throw new Error('короткий WAV');
  const dv = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
  const riff = String.fromCharCode(...wavBytes.subarray(0, 4));
  const wave = String.fromCharCode(...wavBytes.subarray(8, 12));
  if (riff !== 'RIFF' || wave !== 'WAVE') throw new Error('не RIFF/WAVE');

  let off = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let pcm = null;

  while (off + 8 <= wavBytes.length) {
    const id = String.fromCharCode(...wavBytes.subarray(off, off + 4));
    const size = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (start + size > wavBytes.length) break;
    if (id === 'fmt ') {
      const fmt = new DataView(wavBytes.buffer, wavBytes.byteOffset + start, size);
      if (fmt.getUint16(0, true) !== 1) throw new Error('нужен PCM WAV');
      channels = fmt.getUint16(2, true);
      sampleRate = fmt.getUint32(4, true);
      bits = fmt.getUint16(14, true);
      if (bits !== 16) throw new Error('нужен 16-bit WAV');
    } else if (id === 'data') {
      pcm = wavBytes.subarray(start, start + size);
    }
    off = start + size + (size % 2);
  }
  if (!pcm || !sampleRate || !channels) throw new Error('нет fmt/data');
  if (pcm.length % 2 !== 0) throw new Error('нечётный data');
  return { pcm: new Uint8Array(pcm), sampleRate, channels, bits: 16 };
}

export async function encryptWavBytes(wavBytes, password) {
  const { pcm, sampleRate, channels } = wavToPcm(wavBytes);
  return encryptRsw({ pcm, sampleRate, channels, password });
}

export async function decryptToWavBytes(rswBytes, password) {
  const { pcm, sampleRate, channels } = await decryptRsw(rswBytes, password);
  return pcmToWav(pcm, sampleRate, channels);
}
