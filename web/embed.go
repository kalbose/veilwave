package web

import "embed"

//go:embed index.html recorder.js
var Files embed.FS
