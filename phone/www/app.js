/* global MediaRecorder, AudioContext, OfflineAudioContext, RSW */
(() => {
  const SAMPLE_RATE = 44100;
  const $ = (id) => document.getElementById(id);

  let mediaRec, chunks = [], analyser, audioCtx, animId;
  let recStartTs = 0, recTickId = null;
  let hideFile = null; // File | Blob
  let openFile = null;
  let clearWavBytes = null;

  const waveCanvas = $('waveCanvas');
  const waveWrap = $('waveWrap');
  const waveCtx = waveCanvas.getContext('2d');

  function toast(msg, kind = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4500);
  }

  function setOverlay(show, text = 'Обработка…', sub = '') {
    $('overlayText').textContent = text;
    $('overlaySub').textContent = sub;
    $('overlay').classList.toggle('show', show);
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $(`panel-${tab.dataset.panel}`).classList.add('active');
    });
  });

  function goPanel(name) {
    document.querySelector(`.tab[data-panel="${name}"]`)?.click();
  }

  function scorePassphrase(p) {
    if (!p) return { pct: 0, label: 'введите ключ', color: '#6b8588' };
    let score = Math.min(p.length * 4, 40);
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score += 10;
    if (/\d/.test(p)) score += 10;
    if (/[^a-zA-Z0-9]/.test(p)) score += 15;
    if (p.length >= 16) score += 15;
    if (p.length >= 24) score += 10;
    const pct = Math.min(100, score);
    if (pct < 35) return { pct, label: 'слабый', color: '#e07a6a' };
    if (pct < 65) return { pct, label: 'средний', color: '#e2b87a' };
    if (pct < 85) return { pct, label: 'хороший', color: '#3db8b0' };
    return { pct, label: 'сильный', color: '#6bcf9a' };
  }

  $('passHide').addEventListener('input', () => {
    const s = scorePassphrase($('passHide').value);
    $('strengthBar').style.width = `${s.pct}%`;
    $('strengthBar').style.background = s.color;
    $('strengthLabel').textContent = s.label;
  });

  $('btnGenPass').addEventListener('click', () => {
    const words = 'volga samara wave cipher note river amber frost delta signal quiet harbor'.split(' ');
    const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
    const extra = crypto.getRandomValues(new Uint32Array(1))[0] % 9000 + 1000;
    $('passHide').value = `${pick()}-${pick()}-${pick()}-${pick()}-${extra}`;
    $('passHide').dispatchEvent(new Event('input'));
    $('passOpen').value = $('passHide').value;
    toast('Сгенерирован ключ — сохраните его отдельно');
  });

  function wireToggle(btnId, inputId) {
    $(btnId).addEventListener('click', () => {
      const inp = $(inputId);
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      $(btnId).textContent = show ? '🙈' : '👁';
    });
  }
  wireToggle('btnToggleHide', 'passHide');
  wireToggle('btnToggleOpen', 'passOpen');

  $('btnCopyCard')?.addEventListener('click', async () => {
    const card = $('btnCopyCard').dataset.card || '';
    try {
      await navigator.clipboard.writeText(card);
      toast('Номер карты скопирован');
    } catch {
      toast(card);
    }
  });

  function formatSize(b) {
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1048576).toFixed(2)} MB`;
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function resizeCanvas() {
    const rect = waveCanvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    waveCanvas.width = Math.floor(rect.width * dpr);
    waveCanvas.height = Math.floor(rect.height * dpr);
    waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawWaveIdle() {
    const w = waveCanvas.parentElement.clientWidth;
    const h = waveCanvas.parentElement.clientHeight;
    waveCtx.clearRect(0, 0, w, h);
    waveCtx.strokeStyle = 'rgba(61,184,176,0.25)';
    waveCtx.beginPath();
    waveCtx.moveTo(0, h / 2);
    waveCtx.lineTo(w, h / 2);
    waveCtx.stroke();
  }

  function drawWaveLive() {
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(buf);
    const w = waveCanvas.parentElement.clientWidth;
    const h = waveCanvas.parentElement.clientHeight;
    waveCtx.clearRect(0, 0, w, h);
    const g = waveCtx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#e2b87a');
    g.addColorStop(1, '#3db8b0');
    waveCtx.strokeStyle = g;
    waveCtx.lineWidth = 2;
    waveCtx.beginPath();
    const slice = w / buf.length;
    for (let i = 0, x = 0; i < buf.length; i += 1, x += slice) {
      const y = (buf[i] / 128) * h / 2;
      if (i === 0) waveCtx.moveTo(x, y);
      else waveCtx.lineTo(x, y);
    }
    waveCtx.stroke();
    animId = requestAnimationFrame(drawWaveLive);
  }

  window.addEventListener('resize', () => { resizeCanvas(); if (!analyser) drawWaveIdle(); });
  resizeCanvas();
  drawWaveIdle();

  function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  }

  function encodeWav16Mono(samples) {
    const dataSize = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    let off = 44;
    for (let i = 0; i < samples.length; i += 1) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return new Uint8Array(buffer);
  }

  async function audioBlobToMonoWav(blob) {
    const ctx = new AudioContext();
    const audioBuf = await ctx.decodeAudioData(await blob.arrayBuffer());
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
        for (let c = 0; c < audioBuf.numberOfChannels; c += 1) acc += audioBuf.getChannelData(c)[i];
        out[i] = acc / audioBuf.numberOfChannels;
      }
      src.buffer = mix;
    }
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    await ctx.close();
    return encodeWav16Mono(rendered.getChannelData(0));
  }

  async function startRecording() {
    chunks = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    mediaRec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    mediaRec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mediaRec.onstop = async () => {
      cancelAnimationFrame(animId);
      stream.getTracks().forEach((t) => t.stop());
      if (audioCtx) await audioCtx.close();
      analyser = null;
      waveWrap.classList.remove('recording');
      $('recDot').classList.remove('on');
      clearInterval(recTickId);
      try {
        setOverlay(true, 'Конвертация в WAV…');
        const wavBytes = await audioBlobToMonoWav(new Blob(chunks, { type: mediaRec.mimeType || 'audio/webm' }));
        hideFile = new File([wavBytes], 'recording.wav', { type: 'audio/wav' });
        $('metaHide').textContent = `${hideFile.name} · ${formatSize(hideFile.size)}`;
        $('dropHide').classList.add('has-file');
        const url = URL.createObjectURL(hideFile);
        $('playerRec').hidden = false;
        $('playerRec').src = url;
        drawWaveIdle();
        goPanel('hide');
        toast('Запись готова — можно скрыть в .rswk');
      } catch (e) {
        toast(String(e.message || e), 'err');
        drawWaveIdle();
      } finally {
        setOverlay(false);
      }
    };
    mediaRec.start();
    resizeCanvas();
    drawWaveLive();
    waveWrap.classList.add('recording');
    $('recDot').classList.add('on');
    recStartTs = Date.now();
    $('recTimer').hidden = false;
    recTickId = setInterval(() => {
      $('recTimer').textContent = fmtTime((Date.now() - recStartTs) / 1000);
    }, 200);
    $('btnRecStart').disabled = true;
    $('btnRecStop').disabled = false;
    toast('Запись…');
  }

  $('btnRecStart').addEventListener('click', () => startRecording().catch((e) => toast(`Микрофон: ${e.message}`, 'err')));
  $('btnRecStop').addEventListener('click', () => {
    if (mediaRec?.state !== 'inactive') mediaRec.stop();
    $('btnRecStart').disabled = false;
    $('btnRecStop').disabled = true;
  });

  function wireFile(zone, input, onFile) {
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    });
    input.addEventListener('change', () => {
      const f = input.files[0];
      if (f) onFile(f);
    });
  }

  wireFile($('dropHide'), $('fileHide'), (f) => {
    hideFile = f;
    $('dropHide').classList.add('has-file');
    $('metaHide').textContent = `${f.name} · ${formatSize(f.size)}`;
  });

  wireFile($('dropOpen'), $('fileOpen'), (f) => {
    openFile = f;
    $('dropOpen').classList.add('has-file');
    $('metaOpen').textContent = `${f.name} · ${formatSize(f.size)}`;
  });

  async function blobToBase64(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(await bytes.arrayBuffer?.() || bytes);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      binary += String.fromCharCode(...u8.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function saveNative(name, bytes, mime) {
    const Save = window.Capacitor?.Plugins?.RswSave;
    if (Save && window.Capacitor?.isNativePlatform?.()) {
      const b64 = await blobToBase64(bytes);
      return Save.saveFile({ name, data: b64, mime: mime || 'application/octet-stream' });
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    return { path: name, folder: 'Download/RuSamaraWave' };
  }

  async function ensureWavBytes(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf.length >= 12) {
      const head = String.fromCharCode(...buf.subarray(0, 4));
      const wave = String.fromCharCode(...buf.subarray(8, 12));
      if (head === 'RIFF' && wave === 'WAVE') return buf;
    }
    setOverlay(true, 'Конвертация в WAV…');
    try {
      return await audioBlobToMonoWav(file);
    } finally {
      setOverlay(false);
    }
  }

  function fileStamp(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }

  function rswkName(d = new Date()) {
    return `RuSamaraWaveKalimov_${fileStamp(d)}.rswk`;
  }

  $('btnHide').addEventListener('click', async () => {
    const pass = $('passHide').value.trim();
    if (!pass || pass.length < 8) { toast('Ключ слишком короткий', 'err'); return; }
    if (!hideFile) { toast('Нужна запись или WAV', 'err'); return; }
    if (typeof RSW?.encryptWavBytes !== 'function') { toast('Движок RSW не загружен', 'err'); return; }
    $('btnHide').disabled = true;
    setOverlay(true, 'Argon2 + XChaCha20-Poly1305', 'создание .rswk…');
    try {
      const wavBytes = await ensureWavBytes(hideFile);
      setOverlay(true, 'Шифрование RSWK…', 'подождите несколько секунд');
      const rsw = await RSW.encryptWavBytes(wavBytes, pass);
      const name = rswkName();
      const saved = await saveNative(name, rsw, 'application/octet-stream');
      toast(`Сохранено: ${saved.path || name}`);
      openFile = new File([rsw], name, { type: 'application/octet-stream' });
      $('dropOpen').classList.add('has-file');
      $('metaOpen').textContent = `${name} · ${formatSize(rsw.length)}`;
      $('passOpen').value = pass;
    } catch (e) {
      toast(String(e.message || e), 'err');
    } finally {
      $('btnHide').disabled = false;
      setOverlay(false);
    }
  });

  $('btnOpen').addEventListener('click', async () => {
    const pass = $('passOpen').value.trim();
    if (!pass) { toast('Введите ключ', 'err'); return; }
    if (!openFile) { toast('Выберите .rswk', 'err'); return; }
    if (typeof RSW?.decryptToWavBytes !== 'function') { toast('Движок RSW не загружен', 'err'); return; }
    $('btnOpen').disabled = true;
    setOverlay(true, 'Снятие защиты…', 'Argon2 на устройстве');
    try {
      const rswBytes = new Uint8Array(await openFile.arrayBuffer());
      clearWavBytes = await RSW.decryptToWavBytes(rswBytes, pass);
      const url = URL.createObjectURL(new Blob([clearWavBytes], { type: 'audio/wav' }));
      $('playerClear').hidden = false;
      $('playerClear').src = url;
      $('btnSaveClear').disabled = false;
      toast('Файл открыт');
    } catch (e) {
      toast(String(e.message || e), 'err');
      $('btnSaveClear').disabled = true;
      clearWavBytes = null;
    } finally {
      $('btnOpen').disabled = false;
      setOverlay(false);
    }
  });

  $('btnSaveClear').addEventListener('click', async () => {
    if (!clearWavBytes) return;
    try {
      const stamp = fileStamp();
      const saved = await saveNative(`RuSamaraWaveKalimov_${stamp}_clear.wav`, clearWavBytes, 'audio/wav');
      toast(`WAV: ${saved.path || 'сохранён'}`);
    } catch (e) {
      toast(String(e.message || e), 'err');
    }
  });
})();
