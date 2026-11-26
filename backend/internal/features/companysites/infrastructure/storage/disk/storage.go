// Package disk stores company site media (images and hero videos) in the
// private CV_STORAGE_ROOT, with the same flat random 64-hex layout the CV
// adapter used for site images before slice B, so existing files stay
// readable. There is no static HTTP mount.
package disk

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
)

type Storage struct{ root *os.Root }

var _ app.Storage = (*Storage)(nil)

var errKey = errors.New("site media: invalid storage key")

// New opens (creating it 0700 if needed) the storage root.
func New(dir string) (*Storage, error) {
	if dir == "" {
		return nil, errors.New("site media storage root required")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	return &Storage{root}, nil
}

func (s *Storage) Close() error { return s.root.Close() }

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

// Put stores one image (at most app.MaxMediaBytes).
func (s *Storage) Put(ctx context.Context, data []byte) (string, error) {
	if len(data) > app.MaxMediaBytes {
		return "", app.ErrStorageUnavailable
	}
	return s.write(ctx, func(f *os.File) error {
		_, err := f.Write(data)
		return err
	})
}

// PutStream copies exactly size bytes (1..app.MaxVideoBytes) from body; a
// shorter or longer body removes the partial file.
func (s *Storage) PutStream(ctx context.Context, body io.ReadSeeker, size int64) (string, error) {
	if size < 1 || size > app.MaxVideoBytes {
		return "", app.ErrStorageUnavailable
	}
	return s.write(ctx, func(f *os.File) error {
		n, err := io.Copy(f, io.LimitReader(body, size+1))
		if err == nil && n != size {
			err = app.ErrStorageUnavailable
		}
		return err
	})
}

func (s *Storage) write(ctx context.Context, fill func(*os.File) error) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
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
	err = fill(f)
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = s.root.Remove(key)
		return "", err
	}
	return key, nil
}

// Open returns the stored file; it is seekable and read on demand.
func (s *Storage) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !validKey(key) {
		return nil, errKey
	}
	info, err := s.root.Lstat(key)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, app.ErrMediaNotFound
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errKey
	}
	f, err := s.root.Open(key)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, app.ErrMediaNotFound
	}
	return f, err
}

// OpenRange is Open: a file already serves any byte range without buffering.
func (s *Storage) OpenRange(ctx context.Context, key string, _ int64) (io.ReadSeekCloser, error) {
	return s.Open(ctx, key)
}

// Delete removes the file; a missing file is not an error.
func (s *Storage) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !validKey(key) {
		return errKey
	}
	err := s.root.Remove(key)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

// Keys lists the stored keys (every 64-hex regular file in the root, which in
// disk mode also holds CV files); used by tests and operator tooling.
func (s *Storage) Keys(ctx context.Context) ([]string, error) {
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
