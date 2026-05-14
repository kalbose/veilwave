package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultHTTPAddr       = ":8080"
	DefaultMaxBodyBytes   = 128 * 1024 * 1024 // 128 MiB
	DefaultReadTimeout    = 30 * time.Second
	DefaultWriteTimeout   = 5 * time.Minute
	DefaultIdleTimeout    = 120 * time.Second
	DefaultArgon2Time     = 2
	DefaultArgon2MemoryKiB = 64 * 1024
	DefaultArgon2Threads  = 4
)

// Config holds runtime parameters loaded from the environment.
type Config struct {
	HTTPAddr           string
	MaxBodyBytes       int64
	ReadTimeout        time.Duration
	WriteTimeout       time.Duration
	IdleTimeout        time.Duration
	Argon2Time         uint32
	Argon2MemoryKiB    uint32
	Argon2Threads      uint8
	ProcessBlockBytes  int // PCM block size for permutation pipeline (e.g. 64 KiB)
}

// Load reads configuration from environment variables with sane defaults.
func Load() (*Config, error) {
	cfg := &Config{
		HTTPAddr:          getEnv("HTTP_ADDR", DefaultHTTPAddr),
		MaxBodyBytes:      DefaultMaxBodyBytes,
		ReadTimeout:       DefaultReadTimeout,
		WriteTimeout:      DefaultWriteTimeout,
		IdleTimeout:       DefaultIdleTimeout,
		Argon2Time:        uint32(envInt("ARGON2_TIME", DefaultArgon2Time)),
		Argon2MemoryKiB:   uint32(envInt("ARGON2_MEMORY_KIB", DefaultArgon2MemoryKiB)),
		Argon2Threads:     uint8(envInt("ARGON2_THREADS", DefaultArgon2Threads)),
		ProcessBlockBytes: envInt("PROCESS_BLOCK_BYTES", 64*1024),
	}

	if cfg.MaxBodyBytes = envInt64("MAX_BODY_BYTES", DefaultMaxBodyBytes); cfg.MaxBodyBytes <= 0 {
		return nil, fmt.Errorf("MAX_BODY_BYTES must be positive: %w", ErrInvalid)
	}

	if err := validateHTTPAddr(cfg.HTTPAddr); err != nil {
		return nil, err
	}
	if cfg.ProcessBlockBytes < 512 || cfg.ProcessBlockBytes%2 != 0 {
		return nil, fmt.Errorf("PROCESS_BLOCK_BYTES must be even and >= 512: %w", ErrInvalid)
	}
	if cfg.Argon2Time == 0 || cfg.Argon2MemoryKiB < 32*1024 {
		return nil, fmt.Errorf("(Argon2Time, Argon2MemoryKiB) must meet minimum security defaults: %w", ErrInvalid)
	}

	return cfg, nil
}

var ErrInvalid = errors.New("invalid configuration")

func validateHTTPAddr(addr string) error {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return fmt.Errorf("HTTP_ADDR is empty: %w", ErrInvalid)
	}
	// Accept ":8080" or "127.0.0.1:9090"
	if strings.HasPrefix(addr, ":") {
		port := strings.TrimPrefix(addr, ":")
		return validatePort(port)
	}
	host, port, ok := strings.Cut(addr, ":")
	if !ok || host == "" || port == "" {
		return fmt.Errorf("HTTP_ADDR must be :port or host:port: %w", ErrInvalid)
	}
	return validatePort(port)
}

func validatePort(portStr string) error {
	p, err := strconv.Atoi(portStr)
	if err != nil || p < 1 || p > 65535 {
		return fmt.Errorf("invalid port in HTTP_ADDR: %w", ErrInvalid)
	}
	return nil
}

func getEnv(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func envInt64(key string, def int64) int64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return def
	}
	return n
}
