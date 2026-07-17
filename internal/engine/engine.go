package engine

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"audio-cipher/internal/audio"
	"audio-cipher/internal/config"
	audiocrypto "audio-cipher/internal/crypto"
)

// Result описывает итог обработки WAV.
type Result struct {
	WAV         []byte
	PCMBytes    int
	PCMSha256   string
	DurationSec float64
	Channels    uint16
	SampleRate  uint32
}

// Info возвращает метаданные WAV без преобразования.
func Info(raw []byte) (*Result, error) {
	w, err := audio.DecodeWAV16(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	return metaFromWAV(w, raw), nil
}

// Scramble применяет завесу к PCM.
func Scramble(ctx context.Context, cfg *config.Config, raw []byte, passphrase string) (*Result, error) {
	return transform(ctx, cfg, raw, passphrase, true)
}

// Descramble снимает завесу.
func Descramble(ctx context.Context, cfg *config.Config, raw []byte, passphrase string) (*Result, error) {
	return transform(ctx, cfg, raw, passphrase, false)
}

// VerifyRoundtrip проверяет, что shroud при descramble совпадает с original по PCM.
func VerifyRoundtrip(ctx context.Context, cfg *config.Config, originalRaw, shroudRaw []byte, passphrase string) (match bool, origHash, restoredHash string, err error) {
	orig, err := audio.DecodeWAV16(bytes.NewReader(originalRaw))
	if err != nil {
		return false, "", "", fmt.Errorf("decode original: %w", err)
	}
	out, err := Descramble(ctx, cfg, shroudRaw, passphrase)
	if err != nil {
		return false, "", "", err
	}
	restored, err := audio.DecodeWAV16(bytes.NewReader(out.WAV))
	if err != nil {
		return false, "", "", fmt.Errorf("decode restored: %w", err)
	}
	origHash = sha256Hex(orig.PCM)
	restoredHash = sha256Hex(restored.PCM)
	return origHash == restoredHash && len(orig.PCM) == len(restored.PCM), origHash, restoredHash, nil
}

func transform(ctx context.Context, cfg *config.Config, raw []byte, passphrase string, scramble bool) (*Result, error) {
	decoded, err := audio.DecodeWAV16(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("decode wav: %w", err)
	}

	mk, err := audiocrypto.DeriveMasterKey(passphrase, len(decoded.PCM), cfg.Argon2Time, cfg.Argon2MemoryKiB, cfg.Argon2Threads)
	if err != nil {
		return nil, err
	}
	ks, err := audiocrypto.NewPCMKeystreamFromMasterKey(mk, len(decoded.PCM))
	if err != nil {
		return nil, err
	}

	pcm := append([]byte(nil), decoded.PCM...)
	if scramble {
		if err := audio.ScramblePCM(ctx, pcm, mk, cfg.ProcessBlockBytes, ks); err != nil {
			return nil, fmt.Errorf("scramble: %w", err)
		}
	} else {
		if err := audio.DescramblePCM(ctx, pcm, mk, cfg.ProcessBlockBytes, ks); err != nil {
			return nil, fmt.Errorf("descramble: %w", err)
		}
	}

	decoded.PCM = pcm
	out, err := audio.EncodeWAV16(decoded)
	if err != nil {
		return nil, err
	}
	return metaFromWAV(decoded, out), nil
}

func metaFromWAV(w *audio.WAV16, wavBytes []byte) *Result {
	samples := len(w.PCM) / 2 / int(maxU16(w.NumChannels, 1))
	dur := float64(samples) / float64(maxU32(w.SampleRate, 1))
	return &Result{
		WAV:         wavBytes,
		PCMBytes:    len(w.PCM),
		PCMSha256:   sha256Hex(w.PCM),
		DurationSec: dur,
		Channels:    w.NumChannels,
		SampleRate:  w.SampleRate,
	}
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func maxU16(v, def uint16) uint16 {
	if v == 0 {
		return def
	}
	return v
}

func maxU32(v, def uint32) uint32 {
	if v == 0 {
		return def
	}
	return v
}
