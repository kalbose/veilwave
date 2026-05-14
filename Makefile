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
	go build -o bin/audio-cipher ./cmd/server

lint:
	go vet ./...
	go fmt ./...
