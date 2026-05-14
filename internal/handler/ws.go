package handler

import (
	"fmt"
	"net/http"
	"time"
)

// handleStatusStream — упрощённый поток состояния через SSE (без внешнего WebSocket-модуля).
// NOTE: Полноценный WebSocket из стандартной библиотеки недоступен; для лёгкого «опционального» статуса используем text/event-stream.
func (h *Handler) handleStatusStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "stream unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	t := time.NewTicker(2 * time.Second)
	defer t.Stop()

	fmt.Fprintf(w, "event: ping\ndata: {\"ts\":%d}\n\n", time.Now().Unix())
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-t.C:
			fmt.Fprintf(w, "event: ping\ndata: {\"ts\":%d}\n\n", time.Now().Unix())
			flusher.Flush()
		}
	}
}
