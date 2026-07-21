# RuSamaraWave

Офлайн голосовые заметки в формате **`.rswk`** (Argon2id + XChaCha20-Poly1305).

- **Windows / браузер** — этот репозиторий (`go run ./cmd/server` → http://localhost:8080)
- **Android** — папка [`phone/`](phone/), сборка APK/AAB для RuStore

## Windows (быстрый старт)

```bat
dev.cmd
```

или:

```bat
go run ./cmd/server
```

Откройте http://localhost:8080

Сборка exe:

```bat
build-win.cmd
```

Появится `bin\RuSamaraWave.exe`.

## Формат RSWK

Файлы: `RuSamaraWaveKalimov_ГГГГ-ММ-ДД_ЧЧ-ММ-СС.rswk`  
Спека: [`phone/store/RSWK-SPEC.md`](phone/store/RSWK-SPEC.md)

## Legacy CLI (WAV scramble)

Старый lossless-пайплайн WAV по-прежнему в CLI:

```bat
go run ./cmd/server scramble  -in a.wav -out b.wav -pass "…"
go run ./cmd/server descramble -in b.wav -out c.wav -pass "…"
```

UI работает на **RSWK**, не на старом shroud WAV.

## Автор

https://vk.ru/kalboseof
