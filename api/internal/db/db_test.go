package db

import (
	"context"
	"strings"
	"testing"
)

func TestOpenNeverLeaksTheConnectionString(t *testing.T) {
	url := "postgresql://postgres.ref:[s3cretpw]@host.example:6543/postgres"
	_, err := Open(context.Background(), url)
	if err == nil {
		t.Fatal("expected an error for an invalid connection string")
	}
	if strings.Contains(err.Error(), "s3cretpw") || strings.Contains(err.Error(), "host.example") {
		t.Fatalf("error leaks the connection string: %v", err)
	}
}
