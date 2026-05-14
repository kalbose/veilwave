package audio_test

import (
	"bytes"
	"context"
	"testing"

	"audio-cipher/internal/audio"
	audiocrypto "audio-cipher/internal/crypto"
)

func TestRoundtrip_PCM(t *testing.T) {
	t.Parallel()
	pass := "correct-horse-battery-staple"
	pcm := make([]byte, 12800)
	for i := range pcm {
		pcm[i] = byte((i * 37) & 0xff)
	}
	orig := append([]byte(nil), pcm...)

	mk, err := audiocrypto.DeriveMasterKey(pass, len(pcm), 2, 64*1024, 4)
	if err != nil {
		t.Fatal(err)
	}
	ks, err := audiocrypto.NewPCMKeystreamFromMasterKey(mk, len(pcm))
	if err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	buf := append([]byte(nil), orig...)
	if err := audio.ScramblePCM(ctx, buf, mk, 1024, ks); err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(buf, orig) {
		t.Fatal("expected scrambled bytes to differ")
	}

	ks2, err := audiocrypto.NewPCMKeystreamFromMasterKey(mk, len(buf))
	if err != nil {
		t.Fatal(err)
	}
	if err := audio.DescramblePCM(ctx, buf, mk, 1024, ks2); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(buf, orig) {
		t.Fatalf("roundtrip mismatch")
	}
}
