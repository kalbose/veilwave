package audio

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

var (
	ErrNotRIFF     = errors.New("not a RIFF/WAVE file")
	ErrMissingFmt  = errors.New("missing fmt chunk")
	ErrMissingData = errors.New("missing data chunk")
	ErrFormat      = errors.New("unsupported WAV format (need PCM 16-bit)")
)

// WAV16 описывает распакованный PCM и параметры, необходимые для безопасной пересборки заголовка.
type WAV16 struct {
	NumChannels   uint16
	SampleRate    uint32
	ByteRate      uint32
	BlockAlign    uint16
	BitsPerSample uint16
	PCM           []byte
}

// DecodeWAV16 читает WAV 16-bit PCM, игнорируя необязательные чанки (LIST, fact и т.д.).
// NOTE: Восстановление на 100% требует сохранить исходные значения fmt; здесь мы их явно парсим.
func DecodeWAV16(r io.Reader) (*WAV16, error) {
	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("read wav: %w", err)
	}
	if len(raw) < 12 {
		return nil, fmt.Errorf("truncated header: %w", ErrNotRIFF)
	}
	if string(raw[0:4]) != "RIFF" || string(raw[8:12]) != "WAVE" {
		return nil, ErrNotRIFF
	}

	off := 12
	var (
		fmtFound  bool
		dataFound bool
		w         WAV16
	)

	for off+8 <= len(raw) {
		id := string(raw[off : off+4])
		size := int(binary.LittleEndian.Uint32(raw[off+4 : off+8]))
		payloadStart := off + 8
		if payloadStart+size > len(raw) {
			break
		}
		payload := raw[payloadStart : payloadStart+size]

		switch id {
		case "fmt ":
			if len(payload) < 16 {
				return nil, fmt.Errorf("short fmt chunk: %w", ErrMissingFmt)
			}
			audioFormat := binary.LittleEndian.Uint16(payload[0:2])
			w.NumChannels = binary.LittleEndian.Uint16(payload[2:4])
			w.SampleRate = binary.LittleEndian.Uint32(payload[4:8])
			w.ByteRate = binary.LittleEndian.Uint32(payload[8:12])
			w.BlockAlign = binary.LittleEndian.Uint16(payload[12:14])
			w.BitsPerSample = binary.LittleEndian.Uint16(payload[14:16])
			if audioFormat != 1 {
				return nil, fmt.Errorf("compression format %d: %w", audioFormat, ErrFormat)
			}
			if w.BitsPerSample != 16 {
				return nil, fmt.Errorf("bits %d: %w", w.BitsPerSample, ErrFormat)
			}
			if w.BlockAlign != uint16(w.NumChannels)*2 {
				return nil, fmt.Errorf("blockAlign mismatch: %w", ErrFormat)
			}
			fmtFound = true
		case "data":
			w.PCM = make([]byte, size)
			copy(w.PCM, payload)
			dataFound = true
		default:
			// пропускаем необязательные чанки
		}

		// выравнивание чанка по чётному смещению
		off = payloadStart + size
		if size%2 == 1 {
			off++
		}
	}

	if !fmtFound {
		return nil, ErrMissingFmt
	}
	if !dataFound {
		return nil, ErrMissingData
	}
	if len(w.PCM)%2 != 0 {
		return nil, fmt.Errorf("odd pcm byte length: %w", ErrFormat)
	}

	return &w, nil
}

// EncodeWAV16 собирает валидный RIFF/WAVE с одним data-чанком (без копирования необязательных метаданных).
func EncodeWAV16(w *WAV16) ([]byte, error) {
	if w.BitsPerSample != 16 {
		return nil, fmt.Errorf("bits: %w", ErrFormat)
	}
	if len(w.PCM)%2 != 0 {
		return nil, fmt.Errorf("odd pcm: %w", ErrFormat)
	}

	subchunk1Size := uint32(16)
	audioFormat := uint16(1)

	var fmtChunk bytes.Buffer
	fmtChunk.Grow(24)
	_, _ = fmtChunk.WriteString("fmt ")
	_ = binary.Write(&fmtChunk, binary.LittleEndian, subchunk1Size)
	_ = binary.Write(&fmtChunk, binary.LittleEndian, audioFormat)
	_ = binary.Write(&fmtChunk, binary.LittleEndian, w.NumChannels)
	_ = binary.Write(&fmtChunk, binary.LittleEndian, w.SampleRate)
	_ = binary.Write(&fmtChunk, binary.LittleEndian, w.ByteRate)
	_ = binary.Write(&fmtChunk, binary.LittleEndian, w.BlockAlign)
	_ = binary.Write(&fmtChunk, binary.LittleEndian, w.BitsPerSample)

	dataChunkSize := uint32(len(w.PCM))
	var dataChunk bytes.Buffer
	dataChunk.Grow(8 + len(w.PCM))
	_, _ = dataChunk.WriteString("data")
	_ = binary.Write(&dataChunk, binary.LittleEndian, dataChunkSize)
	_, _ = dataChunk.Write(w.PCM)

	riffSize := uint32(fmtChunk.Len() + dataChunk.Len() + 4) // + "WAVE"

	var out bytes.Buffer
	out.Grow(12 + int(riffSize))
	_, _ = out.WriteString("RIFF")
	_ = binary.Write(&out, binary.LittleEndian, riffSize)
	_, _ = out.WriteString("WAVE")
	_, _ = out.Write(fmtChunk.Bytes())
	_, _ = out.Write(dataChunk.Bytes())

	return out.Bytes(), nil
}
