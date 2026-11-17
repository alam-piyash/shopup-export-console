package storage

import (
	"strings"
	"testing"
)

func TestNewPath(t *testing.T) {
	p, err := NewPath("exps", "Invoice (final) #2.pdf")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(p, "/")
	if len(parts) != 3 || parts[0] != "exps" || len(parts[1]) != 36 || parts[2] != "Invoice_final_2.pdf" {
		t.Fatalf("unexpected path %q", p)
	}
	for _, bad := range []string{"", "../etc", "a//b", "exps/../x", "with space"} {
		if _, err := NewPath(bad, "a.pdf"); err == nil {
			t.Errorf("folder %q accepted", bad)
		}
	}
	long := strings.Repeat("a", 300) + ".pdf"
	if p, _ := NewPath("x", long); len(strings.Split(p, "/")[2]) != 120 {
		t.Error("long name not shortened to 120 characters")
	}
}

func TestSignedURLRejectsBadPaths(t *testing.T) {
	c := New("http://127.0.0.1:1", "anon", "documents")
	for _, bad := range []string{"", "nofolder", "../x/y", "a/../b", "a/b c"} {
		if _, err := c.SignedURL(t.Context(), "tok", bad, ""); err == nil {
			t.Errorf("path %q accepted", bad)
		}
	}
}
