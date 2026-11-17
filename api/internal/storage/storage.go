// Package storage creates short-lived links for the private documents bucket.
//
// Calls go to Supabase Storage with the signed-in user's own token, so the bucket's RLS
// policies (members read and upload, admins delete) still decide what is allowed.
// No service-role key is needed.
package storage

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// MaxFileSize matches the bucket limit (25 MB).
const MaxFileSize = 25 * 1024 * 1024

// Client talks to Supabase Storage.
type Client struct {
	base    string // https://<ref>.supabase.co/storage/v1
	anonKey string
	bucket  string
	http    *http.Client
}

// New returns a storage client.
func New(supabaseURL, anonKey, bucket string) *Client {
	return &Client{base: supabaseURL + "/storage/v1", anonKey: anonKey, bucket: bucket, http: &http.Client{Timeout: 10 * time.Second}}
}

// Error is a refusal from Supabase Storage.
type Error struct {
	Status int
	Msg    string
}

func (e *Error) Error() string { return e.Msg }

var (
	unsafeName   = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)
	validFolder  = regexp.MustCompile(`^[a-zA-Z0-9_-]+(/[a-zA-Z0-9_-]+)*$`)
	validPath    = regexp.MustCompile(`^[a-zA-Z0-9_-]+(/[a-zA-Z0-9._-]+)+$`)
	errBadFolder = errors.New("invalid folder")
)

// Upload is a place to upload one file to.
type Upload struct {
	Path      string `json:"path"`
	UploadURL string `json:"upload_url"`
}

// NewPath builds the storage path for a new file: <folder>/<random id>/<safe file name>.
func NewPath(folder, name string) (string, error) {
	folder = strings.Trim(folder, "/")
	if !validFolder.MatchString(folder) {
		return "", errBadFolder
	}
	safe := unsafeName.ReplaceAllString(name, "_")
	if len(safe) > 120 {
		safe = safe[len(safe)-120:]
	}
	if safe == "" || safe == "." || safe == ".." {
		safe = "file"
	}
	return fmt.Sprintf("%s/%s/%s", folder, uuid(), safe), nil
}

// SignedUpload returns a one-time upload URL for a new file. The browser PUTs the file to it.
func (c *Client) SignedUpload(ctx context.Context, token, folder, name string, size int64) (Upload, error) {
	if size <= 0 {
		return Upload{}, &Error{Status: 400, Msg: "File is empty"}
	}
	if size > MaxFileSize {
		return Upload{}, &Error{Status: 400, Msg: "File is larger than 25 MB"}
	}
	path, err := NewPath(folder, name)
	if err != nil {
		return Upload{}, &Error{Status: 400, Msg: err.Error()}
	}
	var out struct {
		URL string `json:"url"`
	}
	if err := c.post(ctx, token, "/object/upload/sign/"+c.bucket+"/"+escape(path), nil, &out); err != nil {
		return Upload{}, err
	}
	return Upload{Path: path, UploadURL: c.base + out.URL}, nil
}

// SignedURL returns a link that opens (or downloads, when download is set) a stored file for two minutes.
func (c *Client) SignedURL(ctx context.Context, token, path, download string) (string, error) {
	if !validPath.MatchString(path) || strings.Contains(path, "..") {
		return "", &Error{Status: 400, Msg: "invalid file path"}
	}
	var out struct {
		SignedURL string `json:"signedURL"`
	}
	if err := c.post(ctx, token, "/object/sign/"+c.bucket+"/"+escape(path), map[string]any{"expiresIn": 120}, &out); err != nil {
		return "", err
	}
	link := c.base + out.SignedURL
	if download != "" {
		sep := "?"
		if strings.Contains(link, "?") {
			sep = "&"
		}
		link += sep + "download=" + url.QueryEscape(download)
	}
	return link, nil
}

func (c *Client) post(ctx context.Context, token, path string, body any, out any) error {
	var rdr io.Reader = http.NoBody
	if body != nil {
		raw, _ := json.Marshal(body)
		rdr = bytes.NewReader(raw)
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, rdr)
	req.Header.Set("apikey", c.anonKey)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		var e struct {
			Message string `json:"message"`
			Error   string `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		msg := e.Message
		if msg == "" {
			msg = "File storage refused the request"
		}
		status := res.StatusCode
		if status >= 500 {
			status = http.StatusBadGateway
		}
		return &Error{Status: status, Msg: msg}
	}
	return json.Unmarshal(raw, out)
}

func escape(path string) string {
	parts := strings.Split(path, "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return strings.Join(parts, "/")
}

func uuid() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}
