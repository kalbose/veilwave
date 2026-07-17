package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"audio-cipher/internal/config"
	"audio-cipher/internal/engine"
	audioweb "audio-cipher/web"
)

// Handler обслуживает статику и REST API.
type Handler struct {
	cfg *config.Config
	web fs.FS
}

// New конструирует Handler.
func New(cfg *config.Config) (*Handler, error) {
	return &Handler{cfg: cfg, web: audioweb.Files}, nil
}

// Register монтирует маршруты.
func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/health", h.withMethod(http.MethodGet, h.health))
	mux.HandleFunc("/api/info", h.withMethod(http.MethodPost, h.withMaxBytes(h.handleInfo)))
	mux.HandleFunc("/api/verify", h.withMethod(http.MethodPost, h.withMaxBytes(h.handleVerify)))
	mux.HandleFunc("/api/scramble", h.withMethod(http.MethodPost, h.withMaxBytes(h.handleScramble)))
	mux.HandleFunc("/api/descramble", h.withMethod(http.MethodPost, h.withMaxBytes(h.handleDescramble)))
	mux.HandleFunc("/api/record", h.withMethod(http.MethodPost, h.withMaxBytes(h.handleRecord)))
	mux.HandleFunc("/api/status", h.withMethod(http.MethodGet, h.handleStatusStream))
	mux.Handle("/", h.static())
}

func (h *Handler) withMethod(method string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
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

func (h *Handler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"product": "veilwave",
		"version": "1.1",
	})
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

func (h *Handler) handleRecord(w http.ResponseWriter, r *http.Request) {
	h.handleTransform(w, r, "scramble")
}

func (h *Handler) handleInfo(w http.ResponseWriter, r *http.Request) {
	raw, err := h.readFileOnly(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	res, err := engine.Info(raw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, resultJSON(res))
}

func (h *Handler) handleVerify(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := r.ParseMultipartForm(h.cfg.MaxBodyBytes); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	pass := strings.TrimSpace(r.FormValue("passphrase"))
	if pass == "" {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("missing passphrase"))
		return
	}
	shroud, err := readFormFile(r, "file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	original, err := readFormFile(r, "original")
	if err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("missing original: %w", err))
		return
	}

	start := time.Now()
	match, oh, rh, err := engine.VerifyRoundtrip(ctx, h.cfg, original, shroud, pass)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			writeErr(w, http.StatusRequestTimeout, err)
			return
		}
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	w.Header().Set("X-Processing-Time-Ms", fmt.Sprintf("%d", time.Since(start).Milliseconds()))
	writeJSON(w, http.StatusOK, map[string]any{
		"match":            match,
		"original_sha256":  oh,
		"restored_sha256":  rh,
		"message":          verifyMessage(match),
	})
}

func verifyMessage(match bool) string {
	if match {
		return "PCM побитово совпадает с оригиналом"
	}
	return "PCM не совпадает — неверный ключ или повреждённый файл"
}

func (h *Handler) handleTransform(w http.ResponseWriter, r *http.Request, mode string) {
	ctx := r.Context()
	start := time.Now()
	pass, fileHeader, raw, err := h.readFormAudio(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}

	var res *engine.Result
	switch mode {
	case "scramble":
		res, err = engine.Scramble(ctx, h.cfg, raw, pass)
	case "descramble":
		res, err = engine.Descramble(ctx, h.cfg, raw, pass)
	default:
		writeErr(w, http.StatusInternalServerError, fmt.Errorf("unknown mode"))
		return
	}
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			writeErr(w, http.StatusRequestTimeout, err)
			return
		}
		slog.Error("pipeline failed", "err", err)
		writeErr(w, http.StatusBadRequest, err)
		return
	}

	name := strings.TrimSuffix(filepath.Base(fileHeader.Filename), filepath.Ext(fileHeader.Filename))
	if name == "" || name == "." {
		name = "audio"
	}
	suffix := ".out.wav"
	switch mode {
	case "scramble":
		suffix = ".veilwave-shroud.wav"
	case "descramble":
		suffix = ".veilwave-clear.wav"
	}

	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, name+suffix))
	w.Header().Set("X-PCM-Bytes", fmt.Sprintf("%d", res.PCMBytes))
	w.Header().Set("X-PCM-Sha256", res.PCMSha256)
	w.Header().Set("X-Duration-Sec", fmt.Sprintf("%.3f", res.DurationSec))
	w.Header().Set("X-Processing-Time-Ms", fmt.Sprintf("%d", time.Since(start).Milliseconds()))
	_, _ = w.Write(res.WAV)
}

func (h *Handler) readFormAudio(r *http.Request) (pass string, fh *multipart.FileHeader, raw []byte, err error) {
	if err := r.ParseMultipartForm(h.cfg.MaxBodyBytes); err != nil {
		return "", nil, nil, fmt.Errorf("parse multipart: %w", err)
	}
	pass = strings.TrimSpace(r.FormValue("passphrase"))
	if pass == "" {
		return "", nil, nil, fmt.Errorf("missing passphrase")
	}
	raw, fh, err = readFormFileHeader(r, "file")
	return pass, fh, raw, err
}

func (h *Handler) readFileOnly(r *http.Request) ([]byte, error) {
	if err := r.ParseMultipartForm(h.cfg.MaxBodyBytes); err != nil {
		return nil, fmt.Errorf("parse multipart: %w", err)
	}
	raw, _, err := readFormFileHeader(r, "file")
	return raw, err
}

func readFormFile(r *http.Request, field string) ([]byte, error) {
	b, _, err := readFormFileHeader(r, field)
	return b, err
}

func readFormFileHeader(r *http.Request, field string) ([]byte, *multipart.FileHeader, error) {
	file, header, err := r.FormFile(field)
	if err != nil {
		return nil, nil, fmt.Errorf("missing %s: %w", field, err)
	}
	defer file.Close()
	raw, err := io.ReadAll(file)
	if err != nil {
		return nil, nil, fmt.Errorf("read file: %w", err)
	}
	if len(raw) == 0 {
		return nil, nil, fmt.Errorf("empty file")
	}
	return raw, header, nil
}

func resultJSON(res *engine.Result) map[string]any {
	return map[string]any{
		"channels":     res.Channels,
		"sample_rate":  res.SampleRate,
		"duration_sec": res.DurationSec,
		"pcm_bytes":    res.PCMBytes,
		"pcm_sha256":   res.PCMSha256,
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	slog.Warn("request error", "code", code, "err", err)
	writeJSON(w, code, map[string]string{"error": err.Error()})
}
