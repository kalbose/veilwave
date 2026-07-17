package engine_test

import (
	"bytes"
	"context"
	"testing"

	"audio-cipher/internal/audio"
	"audio-cipher/internal/config"
	"audio-cipher/internal/engine"
)

func TestEngineRoundtrip(t *testing.T) {
	t.Parallel()
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	pcm := make([]byte, 8192)
	for i := range pcm {
		pcm[i] = byte(i * 3)
	}
	w := &audio.WAV16{
		NumChannels: 1, SampleRate: 44100, ByteRate: 88200,
		BlockAlign: 2, BitsPerSample: 16, PCM: pcm,
	}
	raw, err := audio.EncodeWAV16(w)
	if err != nil {
		t.Fatal(err)
	}
	pass := "test-passphrase-12345"
	ctx := context.Background()

	shroud, err := engine.Scramble(ctx, cfg, raw, pass)
	if err != nil {
		t.Fatal(err)
	}
	match, oh, rh, err := engine.VerifyRoundtrip(ctx, cfg, raw, shroud.WAV, pass)
	if err != nil {
		t.Fatal(err)
	}
	if !match || oh != rh {
		t.Fatalf("verify failed: match=%v oh=%s rh=%s", match, oh, rh)
	}
	clear, err := engine.Descramble(ctx, cfg, shroud.WAV, pass)
	if err != nil {
		t.Fatal(err)
	}
	orig, _ := audio.DecodeWAV16(bytes.NewReader(raw))
	rest, _ := audio.DecodeWAV16(bytes.NewReader(clear.WAV))
	if !bytes.Equal(orig.PCM, rest.PCM) {
		t.Fatal("pcm mismatch after descramble")
	}
}
