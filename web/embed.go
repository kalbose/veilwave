package web

import "embed"

//go:embed index.html recorder.js style.css
var Files embed.FS
