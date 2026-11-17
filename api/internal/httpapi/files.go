package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// File routes hand out short-lived storage links. The browser uploads and downloads the
// bytes directly from storage, so large files never pass through the API.

func (s *Server) fileRoutes(r chi.Router) {
	r.Post("/files/upload-url", s.uploadURL)
	r.Post("/files/signed-url", s.signedURL)
}

// uploadURL: {"folder": "exps", "name": "invoice.pdf", "size": 12345} -> {"path", "upload_url"}.
// The browser then PUTs the file to upload_url and stores {path, name, size} with the record.
func (s *Server) uploadURL(w http.ResponseWriter, r *http.Request) {
	b, err := s.body(w, r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	folder, _ := b["folder"].(string)
	name, _ := b["name"].(string)
	size := number(b["size"])
	up, err := s.Storage.SignedUpload(r.Context(), tokenOf(r), folder, name, size)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, up)
}

// signedURL: {"path": "...", "download": "name.pdf"} -> {"url"}. Without download the file opens in the browser.
func (s *Server) signedURL(w http.ResponseWriter, r *http.Request) {
	b, err := s.body(w, r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	path, _ := b["path"].(string)
	download, _ := b["download"].(string)
	link, err := s.Storage.SignedURL(r.Context(), tokenOf(r), path, download)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": link})
}

func number(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case interface{ Int64() (int64, error) }:
		n, _ := x.Int64()
		return n
	}
	return 0
}
