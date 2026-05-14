package handler

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"

	"audio-cipher/internal/audio"
	"audio-cipher/internal/config"
	audiocrypto "audio-cipher/internal/crypto"
	audioweb "audio-cipher/web"

	"golang.org/x/sync/errgroup"
)

// Handler обслуживает статику и REST API.
type Handler struct {
	cfg *config.Config
	web fs.FS
}

// New конструирует Handler с валидацией встроенной статики.
func New(cfg *config.Config) (*Handler, error) {
	return &Handler{cfg: cfg, web: audioweb.Files}, nil
}

// Register монтирует маршруты на mux.
func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/health", h.withMethod(http.MethodGet, h.health))
	mux.HandleFunc("/api/scramble", h.withMethod(http.MethodPost, h.withMaxBytes(h.handleScramble)))
	mux.HandleFunc("/api/descramble", h.withMethod(http.MethodPost, h.withMaxBytes(h.handleDescramble)))
	mux.HandleFunc("/api/record", h.withMethod(http.MethodPost, h.withMaxBytes(h.handleRecord)))
	mux.HandleFunc("/api/status", h.withMethod(http.MethodGet, h.handleStatusStream))
	mux.Handle("/", h.static())
}

func (h *Handler) withMethod(method string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		next(w, r)
	}
}

func (h *Handler) withMaxBytes(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, h.cfg.MaxBodyBytes)
		next(w, r)
	}
}

func (h *Handler) health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"status":"ok"}`)
}

func (h *Handler) static() http.Handler {
	return http.FileServer(http.FS(h.web))
}

func (h *Handler) handleScramble(w http.ResponseWriter, r *http.Request) {
	h.handleTransform(w, r, "scramble")
}

func (h *Handler) handleDescramble(w http.ResponseWriter, r *http.Request) {
	h.handleTransform(w, r, "descramble")
}

// handleRecord — семантический алиас для POST из браузерного рекордера (тот же контракт, что /api/scramble).
func (h *Handler) handleRecord(w http.ResponseWriter, r *http.Request) {
	h.handleTransform(w, r, "scramble")
}

func (h *Handler) handleTransform(w http.ResponseWriter, r *http.Request, mode string) {
	ctx := r.Context()
	pass, fileHeader, raw, err := h.readFormAudio(r)
	if err != nil {
		slog.Warn("bad request", "err", err)
		http.Error(w, "invalid form: need file+wav and passphrase", http.StatusBadRequest)
		return
	}

	out, err := h.pipeline(ctx, raw, pass, mode)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			http.Error(w, "canceled", http.StatusRequestTimeout)
			return
		}
		slog.Error("pipeline failed", "err", err)
		http.Error(w, "processing failed", http.StatusInternalServerError)
		return
	}

	name := strings.TrimSuffix(filepath.Base(fileHeader.Filename), filepath.Ext(fileHeader.Filename))
	if name == "" || name == "." {
		name = "audio"
	}
	var suffix string
	switch mode {
	case "scramble":
		suffix = ".veilwave-shroud.wav"
	case "descramble":
		suffix = ".veilwave-clear.wav"
	default:
		suffix = ".out.wav"
	}

	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, name+suffix))
	_, _ = w.Write(out)
}

func (h *Handler) readFormAudio(r *http.Request) (pass string, fh *multipart.FileHeader, raw []byte, err error) {
	if err := r.ParseMultipartForm(h.cfg.MaxBodyBytes); err != nil {
		return "", nil, nil, fmt.Errorf("parse multipart: %w", err)
	}
	pass = strings.TrimSpace(r.FormValue("passphrase"))
	if pass == "" {
		return "", nil, nil, fmt.Errorf("missing passphrase")
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return "", nil, nil, fmt.Errorf("missing file: %w", err)
	}
	defer file.Close()
	raw, err = io.ReadAll(file)
	if err != nil {
		return "", nil, nil, fmt.Errorf("read file: %w", err)
	}
	if len(raw) == 0 {
		return "", nil, nil, fmt.Errorf("empty file")
	}
	return pass, header, raw, nil
}

func (h *Handler) pipeline(ctx context.Context, raw []byte, passphrase, mode string) ([]byte, error) {
	g, gctx := errgroup.WithContext(ctx)

	var decoded *audio.WAV16

	g.Go(func() error {
		w, err := audio.DecodeWAV16(bytes.NewReader(raw))
		if err != nil {
			return fmt.Errorf("decode wav: %w", err)
		}
		decoded = w
		return nil
	})

	if err := g.Wait(); err != nil {
		return nil, err
	}

	mk, err := audiocrypto.DeriveMasterKey(passphrase, len(decoded.PCM), h.cfg.Argon2Time, h.cfg.Argon2MemoryKiB, h.cfg.Argon2Threads)
	if err != nil {
		return nil, err
	}
	ks, err := audiocrypto.NewPCMKeystreamFromMasterKey(mk, len(decoded.PCM))
	if err != nil {
		return nil, err
	}

	pcm := append([]byte(nil), decoded.PCM...)

	g2, g2ctx := errgroup.WithContext(gctx)
	g2.Go(func() error {
		switch mode {
		case "scramble":
			if err := audio.ScramblePCM(g2ctx, pcm, mk, h.cfg.ProcessBlockBytes, ks); err != nil {
				return fmt.Errorf("scramble: %w", err)
			}
		case "descramble":
			if err := audio.DescramblePCM(g2ctx, pcm, mk, h.cfg.ProcessBlockBytes, ks); err != nil {
				return fmt.Errorf("descramble: %w", err)
			}
		default:
			return fmt.Errorf("unknown mode %q", mode)
		}
		return nil
	})
	if err := g2.Wait(); err != nil {
		return nil, err
	}

	decoded.PCM = pcm
	return audio.EncodeWAV16(decoded)
}
