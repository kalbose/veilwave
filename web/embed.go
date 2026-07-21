package web

import "embed"

//go:embed index.html style.css app.js rsw.bundle.js privacy.html
var Files embed.FS
