package crypto

import (
	"crypto/cipher"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/binary"
	"errors"
	"fmt"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/chacha20"
)

// NOTE: Обратимость аудио не зависит от криптостойкости — XOR самодвойственен, перестановка — строго обратима.
// Argon2id + ChaCha20 дают детерминированный поток и ключ, привязанный к паролю и размеру PCM: без секрета
// нельзя воспроизвести те же искажения; при верном секрете обращение математически точное.

var ErrInvalidLength = errors.New("invalid pcm length")

// NewPCMKeystream возвращает ChaCha20-поток, синхронный с линейным порядком PCM-байт.
// Детерминизм: одна и та же фраза и len(pcmBytes) → тот же поток (требование спецификации).
func NewPCMKeystream(passphrase string, pcmByteLen int, argonTime uint32, memoryKiB uint32, threads uint8) (cipher.Stream, error) {
	if pcmByteLen < 0 {
		return nil, fmt.Errorf("pcm byte len: %w", ErrInvalidLength)
	}
	if passphrase == "" {
		return nil, fmt.Errorf("empty passphrase: %w", ErrInvalidLength)
	}

	key, err := DeriveMasterKey(passphrase, pcmByteLen, argonTime, memoryKiB, threads)
	if err != nil {
		return nil, err
	}

	var nonce [12]byte
	h := sha256.Sum256(append(append(key[:0:0], key...), binary.LittleEndian.AppendUint64(nil, uint64(pcmByteLen))...))
	copy(nonce[:], h[:12])

	stream, err := chacha20.NewUnauthenticatedCipher(key, nonce[:])
	if err != nil {
		return nil, fmt.Errorf("chacha20 pcm stream: %w", err)
	}
	return stream, nil
}

// DeriveMasterKey — Argon2id; соль детерминирована от размера PCM (не от пароля), пароль — только вход KDF.
func DeriveMasterKey(passphrase string, pcmByteLen int, argonTime uint32, memoryKiB uint32, threads uint8) ([]byte, error) {
	if pcmByteLen < 0 {
		return nil, fmt.Errorf("pcm byte len: %w", ErrInvalidLength)
	}

	const label = "audio-cipher:v1|argon2id|"
	pre := append([]byte(label), binary.LittleEndian.AppendUint64(nil, uint64(pcmByteLen))...)
	sum := sha256.Sum256(pre)
	salt := sum[:16]

	key := argon2.IDKey([]byte(passphrase), salt, argonTime, memoryKiB, threads, 32)
	return key, nil
}

// NewBlockShuffleStream — ChaCha20 для Fisher–Yates внутри блока: уникальная пара (subkey, nonce)
// на каждую пару (blockIndex, sampleCount), чтобы хвостовые блоки разной длины не делили перестановку.
func NewBlockShuffleStream(masterKey []byte, blockIndex uint64, blockSampleCount int) (cipher.Stream, error) {
	if blockSampleCount <= 0 {
		return nil, fmt.Errorf("block sample count: %w", ErrInvalidLength)
	}

	seed := binary.LittleEndian.AppendUint64(nil, blockIndex)
	seed = binary.LittleEndian.AppendUint64(seed, uint64(blockSampleCount))
	seed = append(seed, masterKey...)

	d := sha512.Sum512(seed)
	subKey := d[:32]
	var nonce [12]byte
	copy(nonce[:], d[32:44])

	stream, err := chacha20.NewUnauthenticatedCipher(subKey, nonce[:])
	if err != nil {
		return nil, fmt.Errorf("chacha20 block stream: %w", err)
	}
	return stream, nil
}

// UniformUint32n — равномерное целое в [0, n) из ChaCha-потока (rejection sampling).
func UniformUint32n(stream cipher.Stream, n uint32) (uint32, error) {
	if n == 0 {
		return 0, fmt.Errorf("n must be > 0: %w", ErrInvalidLength)
	}
	if n == 1 {
		return 0, nil
	}

	var buf [4]byte
	const max32 = uint32(1<<32 - 1)
	limit := max32 - (max32 % n)

	for {
		stream.XORKeyStream(buf[:], buf[:])
		v := binary.LittleEndian.Uint32(buf[:])
		if v < limit {
			return v % n, nil
		}
	}
}

// NewPCMKeystreamFromMasterKey строит ChaCha20-поток без повторного Argon2.
func NewPCMKeystreamFromMasterKey(masterKey []byte, pcmByteLen int) (cipher.Stream, error) {
	if len(masterKey) != 32 {
		return nil, fmt.Errorf("master key must be 32 bytes: %w", ErrInvalidLength)
	}
	if pcmByteLen < 0 {
		return nil, fmt.Errorf("pcm byte len: %w", ErrInvalidLength)
	}
	var nonce [12]byte
	h := sha256.Sum256(append(append(masterKey[:0:0], masterKey...), binary.LittleEndian.AppendUint64(nil, uint64(pcmByteLen))...))
	copy(nonce[:], h[:12])
	stream, err := chacha20.NewUnauthenticatedCipher(masterKey, nonce[:])
	if err != nil {
		return nil, fmt.Errorf("chacha20 pcm stream from key: %w", err)
	}
	return stream, nil
}
