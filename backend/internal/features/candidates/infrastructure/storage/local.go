// Package storage contains private CV storage adapters; no static HTTP mount.
package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/cvs"
)

type Local struct{ root *os.Root }

var _ cvs.Storage = (*Local)(nil)

func NewLocal(dir string) (*Local, error) {
	if dir == "" {
		return nil, errors.New("CV storage root required")
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
func (s *Local) Put(ctx context.Context, data []byte) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if len(data) > cvs.MaxBytes {
		return "", cvs.ErrTooLarge
	}
	var entropy [32]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return "", err
	}
	key := hex.EncodeToString(entropy[:])
	f, err := s.root.OpenFile(key, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = s.root.Remove(key)
		return "", err
	}
	return key, nil
}
func (s *Local) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !validKey(key) {
		return nil, cvs.ErrInvalidRequest
	}
	info, err := s.root.Lstat(key)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, cvs.ErrInvalidRequest
	}
	return s.root.Open(key)
}
func (s *Local) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !validKey(key) {
		return cvs.ErrInvalidRequest
	}
	err := s.root.Remove(key)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
func (s *Local) Keys(ctx context.Context) ([]string, error) {
	f, err := s.root.Open(".")
	if err != nil {
		return nil, err
	}
	defer f.Close()
	out := []string{}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		entries, err := f.ReadDir(256)
		for _, e := range entries {
			if e.Type().IsRegular() && validKey(e.Name()) {
				out = append(out, e.Name())
			}
		}
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return nil, err
		}
	}
}
