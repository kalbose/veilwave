/* global MediaRecorder, AudioContext, OfflineAudioContext, fetch, Blob, File, DataTransfer */
(() => {
  const logEl = document.getElementById('log');
  const player = document.getElementById('player');
  const btnStart = document.getElementById('btnRecStart');
  const btnStop = document.getElementById('btnRecStop');
  const file1 = document.getElementById('file1');
  const pass1 = document.getElementById('pass1');
  const btnScramble = document.getElementById('btnScramble');
  const file2 = document.getElementById('file2');
  const pass2 = document.getElementById('pass2');
  const btnDescramble = document.getElementById('btnDescramble');

  const SAMPLE_RATE = 44100;

  function log(...args) {
    logEl.textContent = args.map(String).join(' ');
  }

  let mediaRec;
  let chunks = [];

  function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /** NOTE: Сборка RIFF/WAVE 16-bit PCM — без дополнительного «крешинга», только квантование float→int16 как в обычном экспорте WAV. */
  function encodeWav16Mono(samples) {
    const numChannels = 1;
    const blockAlign = numChannels * 2;
    const byteRate = SAMPLE_RATE * blockAlign;
    const dataSize = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i += 1) {
      let s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function audioBufferToMonoWav(blob) {
    const arrayBuf = await blob.arrayBuffer();
    const ctx = new AudioContext();
    const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));

    const frames = Math.max(1, Math.ceil(audioBuf.duration * SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
    const src = offline.createBufferSource();

    if (audioBuf.numberOfChannels === 1) {
      src.buffer = audioBuf;
    } else {
      const mix = offline.createBuffer(1, audioBuf.length, audioBuf.sampleRate);
      const out = mix.getChannelData(0);
      for (let i = 0; i < out.length; i += 1) {
        let acc = 0;
        for (let c = 0; c < audioBuf.numberOfChannels; c += 1) {
          acc += audioBuf.getChannelData(c)[i];
        }
        out[i] = acc / audioBuf.numberOfChannels;
      }
      src.buffer = mix;
    }

    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    await ctx.close();

    const data = rendered.getChannelData(0);
    return encodeWav16Mono(data);
  }

  btnStart.addEventListener('click', async () => {
    chunks = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRec = new MediaRecorder(stream);
    mediaRec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const webm = new Blob(chunks, { type: mediaRec.mimeType || 'audio/webm' });
      try {
        const recordedWavBlob = await audioBufferToMonoWav(webm);
        const url = URL.createObjectURL(recordedWavBlob);
        player.src = url;
        log('Готово: WAV 16-bit mono', SAMPLE_RATE, 'Hz. Файл подставлен в поле scramble.');
        try {
          const dt = new DataTransfer();
          dt.items.add(new File([recordedWavBlob], 'recording.wav', { type: 'audio/wav' }));
          file1.files = dt.files;
        } catch (_e) {
          /* без DataTransfer пользователь выберет файл вручную */
        }
      } catch (err) {
        log('Ошибка конвертации:', err.message || err);
      }
    };
    mediaRec.start();
    btnStart.disabled = true;
    btnStop.disabled = false;
    log('Запись…');
  });

  btnStop.addEventListener('click', () => {
    if (mediaRec && mediaRec.state !== 'inactive') {
      mediaRec.stop();
    }
    btnStart.disabled = false;
    btnStop.disabled = true;
  });

  async function postTransform(path, wavBlob, pass) {
    const fd = new FormData();
    fd.append('file', wavBlob, 'input.wav');
    fd.append('passphrase', pass);
    const res = await fetch(path, { method: 'POST', body: fd });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return res.blob();
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  }

  btnScramble.addEventListener('click', async () => {
    const pass = pass1.value.trim();
    const f = file1.files[0];
    if (!pass || !f) {
      log('Нужны файл и кодовое слово');
      return;
    }
    btnScramble.disabled = true;
    try {
      const out = await postTransform('/api/scramble', f, pass);
      download(out, 'scrambled.wav');
      log('Скачан scrambled.wav');
    } catch (e) {
      log('Ошибка:', e.message || e);
    } finally {
      btnScramble.disabled = false;
    }
  });

  btnDescramble.addEventListener('click', async () => {
    const pass = pass2.value.trim();
    const f = file2.files[0];
    if (!pass || !f) {
      log('Нужны файл и кодовое слово');
      return;
    }
    btnDescramble.disabled = true;
    try {
      const out = await postTransform('/api/descramble', f, pass);
      download(out, 'restored.wav');
      log('Скачан restored.wav — сравните с оригиналом побитово.');
    } catch (e) {
      log('Ошибка:', e.message || e);
    } finally {
      btnDescramble.disabled = false;
    }
  });
})();
