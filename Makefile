.PHONY: dev test test-race build lint tidy

dev:
	go run ./cmd/server

tidy:
	go mod tidy

test:
	go test ./...

test-race:
	go test -race ./...

build:
	go build -ldflags="-s -w" -o bin/RuSamaraWave.exe ./cmd/server

.PHONY: win
win: build


lint:
	go vet ./...
	go fmt ./...
