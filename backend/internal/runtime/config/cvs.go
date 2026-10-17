package config

import (
	"errors"
	"path/filepath"
	"strings"
)

const EnvCVStorageRoot = "CV_STORAGE_ROOT"

type CVConfig struct{ Root string }

func LoadCVConfig(getenv func(string) string) (CVConfig, error) {
	if getenv == nil {
		return CVConfig{}, errors.New("CV configuration lookup required")
	}
	root := strings.TrimSpace(getenv(EnvCVStorageRoot))
	if root == "" || !filepath.IsAbs(root) || filepath.Clean(root) == string(filepath.Separator) || strings.ContainsRune(root, 0) {
		return CVConfig{}, errors.New("CV_STORAGE_ROOT must be an absolute private directory")
	}
	return CVConfig{filepath.Clean(root)}, nil
}
