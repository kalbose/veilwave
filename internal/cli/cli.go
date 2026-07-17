package cli

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"audio-cipher/internal/config"
	"audio-cipher/internal/engine"
)

// Run выполняет подкоманду CLI. Пустой args[0] или "serve" — HTTP-сервер (возвращает "", nil).
func Run(args []string) (subcommand string, err error) {
	if len(args) == 0 {
		return "serve", nil
	}
	switch args[0] {
	case "serve", "server":
		return "serve", nil
	case "scramble", "descramble", "verify", "info":
		return "", runFileCmd(args[0], args[1:])
	default:
		return "", fmt.Errorf("unknown command %q (try: serve, scramble, descramble, verify, info)", args[0])
	}
}

func runFileCmd(name string, args []string) error {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	in := fs.String("in", "", "input WAV path")
	out := fs.String("out", "", "output WAV path (except info)")
	pass := fs.String("pass", "", "passphrase")
	orig := fs.String("original", "", "original WAV for verify")
	fs.SetOutput(os.Stderr)
	if err := fs.Parse(args); err != nil {
		return err
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	switch name {
	case "info":
		if *in == "" {
			return fmt.Errorf("-in required")
		}
		raw, err := os.ReadFile(*in)
		if err != nil {
			return err
		}
		res, err := engine.Info(raw)
		if err != nil {
			return err
		}
		fmt.Printf("channels=%d sample_rate=%d duration_sec=%.3f pcm_bytes=%d sha256=%s\n",
			res.Channels, res.SampleRate, res.DurationSec, res.PCMBytes, res.PCMSha256)
		return nil
	case "verify":
		if *in == "" || *orig == "" || *pass == "" {
			return fmt.Errorf("-in (shroud), -original and -pass required")
		}
		shroud, err := os.ReadFile(*in)
		if err != nil {
			return err
		}
		original, err := os.ReadFile(*orig)
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		match, oh, rh, err := engine.VerifyRoundtrip(ctx, cfg, original, shroud, *pass)
		if err != nil {
			return err
		}
		if match {
			fmt.Println("OK: PCM match")
		} else {
			fmt.Println("FAIL: PCM mismatch")
		}
		fmt.Printf("original_sha256=%s\nrestored_sha256=%s\n", oh, rh)
		if !match {
			os.Exit(2)
		}
		return nil
	}

	if *in == "" || *out == "" || *pass == "" {
		return fmt.Errorf("-in, -out and -pass required")
	}
	raw, err := os.ReadFile(*in)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	var res *engine.Result
	switch name {
	case "scramble":
		res, err = engine.Scramble(ctx, cfg, raw, *pass)
	case "descramble":
		res, err = engine.Descramble(ctx, cfg, raw, *pass)
	}
	if err != nil {
		return err
	}
	if err := os.WriteFile(*out, res.WAV, 0o644); err != nil {
		return err
	}
	fmt.Printf("wrote %s (%d bytes, pcm_sha256=%s)\n", *out, len(res.WAV), res.PCMSha256)
	return nil
}
