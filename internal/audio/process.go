package audio

import (
	"context"
	"crypto/cipher"
	"errors"
	"fmt"
	"sync"

	"golang.org/x/sync/errgroup"

	audiocrypto "audio-cipher/internal/crypto"
)

// NOTE: Шифрование: C = P(XOR(M,K)), где P — блочная перестановка 16-битных сэмплов.
// Дешифрование: M = XOR(P^{-1}(C), K). Обе операции lossless и побитово обратимы при том же K.

var ErrOddBlock = errors.New("pcm length must be even")

var tmpBlockPool = sync.Pool{
	New: func() any {
		b := make([]byte, 64*1024)
		return &b
	},
}

// ScramblePCM: XOR по линейному порядку байт, затем Fisher–Yates внутри каждого блока `blockBytes`.
func ScramblePCM(ctx context.Context, pcm []byte, masterKey []byte, blockBytes int, ks cipher.Stream) error {
	if len(pcm)%2 != 0 {
		return ErrOddBlock
	}
	if blockBytes%2 != 0 || blockBytes < 2 {
		return fmt.Errorf("blockBytes: %w", ErrOddBlock)
	}

	ks.XORKeyStream(pcm, pcm)

	return permuteBlocks(ctx, pcm, masterKey, blockBytes, true)
}

// DescramblePCM: обратная перестановка, затем XOR тем же потоком.
func DescramblePCM(ctx context.Context, pcm []byte, masterKey []byte, blockBytes int, ks cipher.Stream) error {
	if len(pcm)%2 != 0 {
		return ErrOddBlock
	}
	if blockBytes%2 != 0 || blockBytes < 2 {
		return fmt.Errorf("blockBytes: %w", ErrOddBlock)
	}

	if err := permuteBlocks(ctx, pcm, masterKey, blockBytes, false); err != nil {
		return err
	}

	ks.XORKeyStream(pcm, pcm)
	return nil
}

func permuteBlocks(ctx context.Context, pcm []byte, masterKey []byte, blockBytes int, forward bool) error {
	g, _ := errgroup.WithContext(ctx)
	var blockIndex uint64
	for offset := 0; offset < len(pcm); offset += blockBytes {
		end := offset + blockBytes
		if end > len(pcm) {
			end = len(pcm)
		}
		blk := pcm[offset:end]
		samples := len(blk) / 2
		if samples == 0 {
			continue
		}

		idx := blockIndex
		blockIndex++
		fwd := forward

		g.Go(func() error {
			stream, err := audiocrypto.NewBlockShuffleStream(masterKey, idx, samples)
			if err != nil {
				return err
			}
			perm, err := fisherYatesPerm(samples, stream)
			if err != nil {
				return err
			}
			if fwd {
				permute16(blk, perm)
			} else {
				inv := permInverse(perm)
				permute16(blk, inv)
			}
			return nil
		})
	}

	return g.Wait()
}

func fisherYatesPerm(n int, stream cipher.Stream) ([]int, error) {
	p := make([]int, n)
	for i := range p {
		p[i] = i
	}
	for i := n - 1; i > 0; i-- {
		j64, err := audiocrypto.UniformUint32n(stream, uint32(i+1))
		if err != nil {
			return nil, err
		}
		j := int(j64)
		p[i], p[j] = p[j], p[i]
	}
	return p, nil
}

func permInverse(p []int) []int {
	inv := make([]int, len(p))
	for i, v := range p {
		inv[v] = i
	}
	return inv
}

func permute16(block []byte, perm []int) {
	n := len(perm)
	var tbuf []byte
	if len(block) <= 64*1024 {
		bp := tmpBlockPool.Get().(*[]byte)
		tmp := *bp
		if cap(tmp) < len(block) {
			tmp = make([]byte, len(block))
		} else {
			tmp = tmp[:len(block)]
		}
		tbuf = tmp
		defer func() {
			*bp = tbuf[:cap(tbuf)]
			tmpBlockPool.Put(bp)
		}()
	} else {
		tbuf = make([]byte, len(block))
	}

	for i := 0; i < n; i++ {
		j := perm[i]
		copy(tbuf[2*i:2*i+2], block[2*j:2*j+2])
	}
	copy(block, tbuf)
}
