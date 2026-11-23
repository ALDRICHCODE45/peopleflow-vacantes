// Package storage contains the private local-disk adapter of the documents Storage port. It has its own root,
// separate from CV storage (D24); there is no static HTTP mount.
package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
)

// Local stores each object as a 0600 file named by a random 64-hex key inside one os.Root, so no key can
// escape the directory.
type Local struct{ root *os.Root }

var _ documents.Storage = (*Local)(nil)

// NewLocal creates dir (0700) when missing and opens it as a root.
func NewLocal(dir string) (*Local, error) {
	if dir == "" {
		return nil, errors.New("document storage root required")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	return &Local{root}, nil
}

// Close releases the root.
func (s *Local) Close() error { return s.root.Close() }

func validKey(key string) bool {
	if len(key) != 64 {
		return false
	}
	for _, c := range key {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// Put streams r into a new O_EXCL file and fsyncs it. A partial file is removed on any error.
func (s *Local) Put(ctx context.Context, r io.Reader, maxBytes int64) (string, int64, error) {
	if maxBytes <= 0 {
		return "", 0, errors.New("document size limit must be positive")
	}
	if err := ctx.Err(); err != nil {
		return "", 0, err
	}
	var entropy [32]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return "", 0, documents.ErrStorageUnavailable
	}
	key := hex.EncodeToString(entropy[:])
	f, err := s.root.OpenFile(key, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", 0, documents.ErrStorageUnavailable
	}
	bounded := documents.NewBoundedReader(ctx, r, maxBytes)
	_, err = io.Copy(f, bounded)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = s.root.Remove(key)
		if cause := bounded.Err(); cause != nil {
			// The caller's body (or its context, or the size cap) failed, not the disk.
			return "", 0, cause
		}
		return "", 0, documents.ErrStorageUnavailable
	}
	return key, bounded.N(), nil
}

// Open returns the file as a stream; a missing key is ErrNotFound and anything that is not a regular file is
// treated as missing.
func (s *Local) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !validKey(key) {
		return nil, documents.ErrInvalidKey
	}
	info, err := s.root.Lstat(key)
	if err != nil {
		return nil, localError(err)
	}
	if !info.Mode().IsRegular() {
		return nil, documents.ErrNotFound
	}
	f, err := s.root.Open(key)
	if err != nil {
		return nil, localError(err)
	}
	return f, nil
}

// Delete removes the file; a missing key is not an error.
func (s *Local) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !validKey(key) {
		return documents.ErrInvalidKey
	}
	err := s.root.Remove(key)
	if err == nil || errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return documents.ErrStorageUnavailable
}

// Objects lists the regular files whose name is a valid key; foreign entries are never reported, so Reconcile can
// never delete them.
func (s *Local) Objects(ctx context.Context) ([]documents.Object, error) {
	dir, err := s.root.Open(".")
	if err != nil {
		return nil, documents.ErrStorageUnavailable
	}
	defer dir.Close()
	out := []documents.Object{}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		entries, err := dir.ReadDir(256)
		for _, e := range entries {
			if !e.Type().IsRegular() || !validKey(e.Name()) {
				continue
			}
			info, infoErr := e.Info()
			if infoErr != nil {
				if errors.Is(infoErr, os.ErrNotExist) {
					continue // removed while listing
				}
				return nil, documents.ErrStorageUnavailable
			}
			out = append(out, documents.Object{Key: e.Name(), ModTime: info.ModTime()})
		}
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return nil, documents.ErrStorageUnavailable
		}
	}
}

func localError(err error) error {
	if errors.Is(err, os.ErrNotExist) {
		return documents.ErrNotFound
	}
	return documents.ErrStorageUnavailable
}
