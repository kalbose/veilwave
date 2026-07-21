# RSWK — спецификация контейнера RuSamaraWave

Расширение файла: **`.rswk`**  
Magic: **`RSWK`** (4 байта ASCII)  
Версия контейнера: `1`

Little-endian.

```
magic[4]     = "RSWK"
version      u8 = 1
flags        u8 = 0
salt_len     u16
salt         salt_len bytes (обычно 16)
nonce        24 bytes
cipher_len   u32
ciphertext   cipher_len bytes   # XChaCha20-Poly1305(plaintext)
```

**KDF:** Argon2id(password, salt, t=2, m=65536 KiB, p=1) → 32-byte key

**Plaintext:**
```
sample_rate  u32
channels     u16
bits         u16 (=16)
pcm_len      u32
pcm          pcm_len bytes
```

Неверный пароль → ошибка AEAD (не «шумный» WAV).
