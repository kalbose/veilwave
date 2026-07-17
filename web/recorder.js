/* global MediaRecorder, AudioContext, OfflineAudioContext, fetch, Blob, File, DataTransfer, requestAnimationFrame, cancelAnimationFrame, crypto */
(() => {
  const SAMPLE_RATE = 44100;
  const $ = (id) => document.getElementById(id);

  const waveCanvas = $('waveCanvas');
  const waveWrap = $('waveWrap');
  const waveCtx = waveCanvas.getContext('2d');
  const recTimer = $('recTimer');
  const recDot = $('recDot');
  const passKey = $('passKey');
  const strengthBar = $('strengthBar');
  const strengthLabel = $('strengthLabel');
  const serverPill = $('serverPill');
  const metaPanel = $('metaPanel');
  const verifyOut = $('verifyOut');
  const btnVerify = $('btnVerify');

  let mediaRec, chunks = [], analyser, audioCtx, animId;
  let recStartTs = 0, recTickId = null;
  let originalFile = null, shroudBlob = null, clearBlob = null;
  let originalBlob = null;

  const state = { step: 1 };

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

  function setStep(n) {
    state.step = n;
    document.querySelectorAll('.pipe-step').forEach((el) => {
      const s = Number(el.dataset.step);
      el.classList.remove('active', 'done');
      if (s < n) el.classList.add('done');
      else if (s === n) el.classList.add('active');
    });
    const target = { 1: 'sec-capture', 2: 'sec-crypto', 3: 'sec-crypto', 4: 'sec-verify' }[n];
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  document.querySelectorAll('.pipe-step').forEach((btn) => {
    btn.addEventListener('click', () => setStep(Number(btn.dataset.step)));
  });

  async function pingServer() {
    try {
      const r = await fetch('/health', { signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error('bad');
      serverPill.className = 'server-pill online';
      serverPill.innerHTML = '<span class="dot"></span> онлайн';
    } catch {
      serverPill.className = 'server-pill offline';
      serverPill.innerHTML = '<span class="dot"></span> офлайн';
    }
  }
  pingServer();
  setInterval(pingServer, 30_000);

  function scorePassphrase(p) {
    if (!p) return { pct: 0, label: 'введите ключ', color: '#6b7280' };
    let score = Math.min(p.length * 4, 40);
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score += 10;
    if (/\d/.test(p)) score += 10;
    if (/[^a-zA-Z0-9]/.test(p)) score += 15;
    if (p.length >= 16) score += 15;
    if (p.length >= 24) score += 10;
    const pct = Math.min(100, score);
    if (pct < 35) return { pct, label: 'слабый — легко подобрать', color: '#fb7185' };
    if (pct < 65) return { pct, label: 'средний', color: '#fbbf24' };
    if (pct < 85) return { pct, label: 'хороший', color: '#22d3ee' };
    return { pct, label: 'сильный', color: '#34d399' };
  }

  passKey.addEventListener('input', () => {
    const s = scorePassphrase(passKey.value);
    strengthBar.style.width = `${s.pct}%`;
    strengthBar.style.background = s.color;
    strengthLabel.textContent = s.label;
  });

  $('btnGenPass').addEventListener('click', () => {
    const words = 'veil wave cipher noise signal ghost prism delta flux quantum sonic amber frost'.split(' ');
    const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
    const extra = crypto.getRandomValues(new Uint32Array(1))[0] % 9000 + 1000;
    passKey.value = `${pick()}-${pick()}-${pick()}-${extra}`;
    passKey.dispatchEvent(new Event('input'));
    toast('Сгенерирован случайный ключ');
  });

  $('btnTogglePass').addEventListener('click', () => {
    const show = passKey.type === 'password';
    passKey.type = show ? 'text' : 'password';
    $('btnTogglePass').textContent = show ? '🙈' : '👁';
  });

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
    waveCtx.strokeStyle = 'rgba(139,92,246,0.22)';
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
    g.addColorStop(0, '#fb7185'); g.addColorStop(0.5, '#a78bfa'); g.addColorStop(1, '#22d3ee');
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

  function drawWaveFromBuffer(audioBuffer) {
    const w = waveCanvas.parentElement.clientWidth;
    const h = waveCanvas.parentElement.clientHeight;
    const data = audioBuffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    waveCtx.clearRect(0, 0, w, h);
    const g = waveCtx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#22d3ee'); g.addColorStop(1, '#34d399');
    waveCtx.strokeStyle = g;
    waveCtx.lineWidth = 1.5;
    waveCtx.beginPath();
    for (let x = 0; x < w; x += 1) {
      const y = (1 - (data[x * step] + 1) / 2) * h;
      if (x === 0) waveCtx.moveTo(x, y);
      else waveCtx.lineTo(x, y);
    }
    waveCtx.stroke();
  }

  window.addEventListener('resize', () => { resizeCanvas(); if (!analyser) drawWaveIdle(); });
  resizeCanvas();
  drawWaveIdle();

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

  function setAudioPreview(el, blob) {
    if (!blob) { el.removeAttribute('src'); return; }
    el.src = URL.createObjectURL(blob);
  }

  async function fetchInfo(file) {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/info', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  function renderMeta(info) {
    metaPanel.innerHTML = `
      <p><b>${info.duration_sec.toFixed(2)}s</b> · ${info.sample_rate} Hz · ${info.channels} ch</p>
      <p>PCM: ${formatSize(info.pcm_bytes)}</p>
      <p style="word-break:break-all;font-family:var(--mono);font-size:0.68rem">sha256: ${info.pcm_sha256.slice(0, 16)}…</p>`;
  }

  function renderChips(el, info) {
    el.innerHTML = `
      <span class="chip">${info.duration_sec.toFixed(1)}s</span>
      <span class="chip">${info.sample_rate} Hz</span>
      <span class="chip">${info.channels} ch</span>
      <span class="chip">${formatSize(info.pcm_bytes)}</span>`;
  }

  async function onFileSelected(file, zone, metaEl, chipsEl, isOriginal) {
    if (!file) return;
    zone.classList.add('has-file');
    metaEl.textContent = `${file.name} · ${formatSize(file.size)}`;
    try {
      const info = await fetchInfo(file);
      renderChips(chipsEl, info);
      renderMeta(info);
      if (isOriginal) {
        originalFile = file;
        originalBlob = file;
        setAudioPreview($('previewOrig'), file);
        btnVerify.disabled = !shroudBlob;
      }
    } catch (e) {
      toast(`Формат: ${e.message}`, 'err');
    }
  }

  function wireDropzone(zone, input, metaEl, chipsEl, isOriginal) {
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (!f) return;
      const dt = new DataTransfer();
      dt.items.add(f);
      input.files = dt.files;
      onFileSelected(f, zone, metaEl, chipsEl, isOriginal);
      setStep(isOriginal ? 2 : 3);
    });
    input.addEventListener('change', () => {
      const f = input.files[0];
      if (f) {
        onFileSelected(f, zone, metaEl, chipsEl, isOriginal);
        setStep(isOriginal ? 2 : 3);
      }
    });
  }

  wireDropzone($('dropShroud'), $('fileShroud'), $('metaShroud'), $('chipsShroud'), true);
  wireDropzone($('dropReveal'), $('fileReveal'), $('metaReveal'), $('chipsReveal'), false);

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $('panel-' + tab.dataset.tab).classList.add('active');
    });
  });

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
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function audioBufferToMonoWav(blob) {
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
    return { blob: encodeWav16Mono(rendered.getChannelData(0)), buffer: rendered };
  }

  function startRecTimer() {
    recStartTs = Date.now();
    recTimer.hidden = false;
    recTickId = setInterval(() => {
      recTimer.textContent = fmtTime((Date.now() - recStartTs) / 1000);
    }, 200);
  }

  function stopRecTimer() {
    clearInterval(recTickId);
    recTickId = null;
  }

  async function startRecording() {
    chunks = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    mediaRec = new MediaRecorder(stream);
    mediaRec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mediaRec.onstop = async () => {
      cancelAnimationFrame(animId);
      stream.getTracks().forEach((t) => t.stop());
      if (audioCtx) await audioCtx.close();
      analyser = null;
      waveWrap.classList.remove('recording');
      recDot.classList.remove('on');
      stopRecTimer();

      try {
        setOverlay(true, 'Конвертация в WAV…');
        const { blob, buffer } = await audioBufferToMonoWav(new Blob(chunks, { type: mediaRec.mimeType || 'audio/webm' }));
        drawWaveFromBuffer(buffer);
        originalBlob = blob;
        originalFile = new File([blob], 'recording.wav', { type: 'audio/wav' });
        $('playerOrig').hidden = false;
        setAudioPreview($('playerOrig'), blob);
        setAudioPreview($('previewOrig'), blob);
        const dt = new DataTransfer();
        dt.items.add(originalFile);
        $('fileShroud').files = dt.files;
        await onFileSelected(originalFile, $('dropShroud'), $('metaShroud'), $('chipsShroud'), true);
        setStep(2);
        toast('Запись готова');
      } catch (err) {
        toast(`Ошибка: ${err.message}`, 'err');
        drawWaveIdle();
      } finally {
        setOverlay(false);
      }
    };
    mediaRec.start();
    resizeCanvas();
    drawWaveLive();
    waveWrap.classList.add('recording');
    recDot.classList.add('on');
    startRecTimer();
    $('btnRecStart').disabled = true;
    $('btnRecStop').disabled = false;
    setStep(1);
    toast('Запись…');
  }

  $('btnRecStart').addEventListener('click', () => startRecording().catch((e) => toast(`Микрофон: ${e.message}`, 'err')));
  $('btnRecStop').addEventListener('click', () => {
    if (mediaRec?.state !== 'inactive') mediaRec.stop();
    $('btnRecStart').disabled = false;
    $('btnRecStop').disabled = true;
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      if ($('btnRecStart').disabled) return;
      startRecording().catch(() => {});
    }
    if (e.key === 'Escape' && mediaRec?.state === 'recording') $('btnRecStop').click();
  });

  async function postTransform(path, file, pass) {
    const fd = new FormData();
    fd.append('file', file, file.name || 'input.wav');
    fd.append('passphrase', pass);
    const res = await fetch(path, { method: 'POST', body: fd });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch (_e) { /* noop */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const ms = res.headers.get('X-Processing-Time-Ms');
    const sha = res.headers.get('X-PCM-Sha256');
    return { blob, ms, sha };
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  }

  $('btnScramble').addEventListener('click', async () => {
    const pass = passKey.value.trim();
    const f = $('fileShroud').files[0];
    if (!pass || !f) { toast('Нужны WAV и ключ', 'err'); return; }
    $('btnScramble').disabled = true;
    setOverlay(true, 'Argon2 → ChaCha20 → перестановка', 'это может занять несколько секунд');
    try {
      const { blob, ms, sha } = await postTransform('/api/scramble', f, pass);
      shroudBlob = blob;
      setAudioPreview($('previewShroud'), blob);
      if ($('chkPreviewShroud').checked) {
        toast(`Завеса готова (${ms || '?'} ms) — слушайте в превью`);
      } else {
        download(blob, 'veilwave-shroud.wav');
        toast(`Скачан veilwave-shroud.wav · ${ms || '?'} ms`);
      }
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'veilwave-shroud.wav', { type: 'audio/wav' }));
      $('fileReveal').files = dt.files;
      $('dropReveal').classList.add('has-file');
      $('metaReveal').textContent = `veilwave-shroud.wav · ${formatSize(blob.size)}`;
      btnVerify.disabled = !originalFile;
      setStep(3);
      document.querySelector('.tab[data-tab="reveal"]').click();
    } catch (e) {
      toast(String(e.message), 'err');
    } finally {
      $('btnScramble').disabled = false;
      setOverlay(false);
    }
  });

  $('btnDescramble').addEventListener('click', async () => {
    const pass = passKey.value.trim();
    const f = $('fileReveal').files[0];
    if (!pass || !f) { toast('Нужны файл и ключ', 'err'); return; }
    $('btnDescramble').disabled = true;
    setOverlay(true, 'Снятие завесы…');
    try {
      const { blob, ms } = await postTransform('/api/descramble', f, pass);
      clearBlob = blob;
      setAudioPreview($('previewClear'), blob);
      if ($('chkPreviewClear').checked) {
        toast(`Восстановлено (${ms || '?'} ms) — слушайте в превью`);
      } else {
        download(blob, 'veilwave-clear.wav');
        toast(`Скачан veilwave-clear.wav`);
      }
      setStep(4);
      btnVerify.disabled = !originalFile;
    } catch (e) {
      toast(String(e.message), 'err');
    } finally {
      $('btnDescramble').disabled = false;
      setOverlay(false);
    }
  });

  $('btnVerify').addEventListener('click', async () => {
    const pass = passKey.value.trim();
    if (!originalFile || !shroudBlob || !pass) {
      toast('Нужны оригинал, завеса и ключ', 'err');
      return;
    }
    $('btnVerify').disabled = true;
    setOverlay(true, 'Проверка SHA256 PCM…');
    try {
      const fd = new FormData();
      fd.append('original', originalFile);
      fd.append('file', shroudBlob, 'veilwave-shroud.wav');
      fd.append('passphrase', pass);
      const r = await fetch('/api/verify', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      verifyOut.className = 'verify-out ' + (j.match ? 'ok' : 'fail');
      verifyOut.textContent = `${j.message}\n\noriginal:  ${j.original_sha256}\nrestored:  ${j.restored_sha256}`;
      toast(j.match ? '✓ PCM совпадает побитово' : '✗ Несовпадение', j.match ? 'ok' : 'err');
    } catch (e) {
      verifyOut.className = 'verify-out fail';
      verifyOut.textContent = String(e.message);
      toast(String(e.message), 'err');
    } finally {
      $('btnVerify').disabled = false;
      setOverlay(false);
    }
  });
})();
