package application

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"

	"github.com/google/uuid"
)

const MaxMediaBytes = 5 * 1024 * 1024

var ErrMediaLimit = errors.New("media limit reached")
var ErrMediaNotFound = errors.New("media not found")

type Storage interface {
	Put(context.Context, []byte) (string, error)
	Open(context.Context, string) (io.ReadCloser, error)
	Delete(context.Context, string) error
}
type StoredMedia struct {
	Media
	ContentType string `json:"content_type"`
	StorageKey  string `json:"-"`
	ByteSize    int64  `json:"-"`
}
type MediaStore interface {
	InsertMedia(context.Context, uuid.UUID, uuid.UUID, StoredMedia, []byte, Storage) (StoredMedia, error)
	FindMedia(context.Context, uuid.UUID) (StoredMedia, error)
}

// PrepareMedia inspects headers only; metadata is removed without touching compressed pixels.
func PrepareMedia(data []byte) ([]byte, string, int, int, string) {
	if len(data) > MaxMediaBytes {
		return nil, "", 0, 0, "payload_too_large"
	}
	typ := ""
	switch {
	case len(data) >= 3 && bytes.Equal(data[:3], []byte{255, 216, 255}):
		typ = "image/jpeg"
	case bytes.HasPrefix(data, []byte{137, 80, 78, 71, 13, 10, 26, 10}):
		typ = "image/png"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		typ = "image/webp"
	default:
		return nil, "", 0, 0, "unsupported_media_type"
	}
	var w, h int
	var out []byte
	var err error
	if typ == "image/webp" {
		out, w, h, err = stripWebP(data)
	} else {
		var cfg image.Config
		cfg, _, err = image.DecodeConfig(bytes.NewReader(data))
		w, h = cfg.Width, cfg.Height
		if err == nil {
			if typ == "image/jpeg" {
				out, err = stripJPEG(data)
			} else {
				out, err = stripPNG(data)
			}
		}
	}
	if err != nil || w == 0 || h == 0 {
		return nil, "", 0, 0, "unsupported_media_type"
	}
	if w < 200 || h < 200 {
		return nil, "", w, h, "image_too_small"
	}
	if w > 6000 || h > 6000 {
		return nil, "", w, h, "image_too_large"
	}
	return out, typ, w, h, ""
}

var errHeader = errors.New("invalid image header")

func stripJPEG(b []byte) ([]byte, error) {
	out := append([]byte{}, b[:2]...)
	for p := 2; p < len(b); {
		start := p
		if b[p] != 255 {
			return nil, errHeader
		}
		for p < len(b) && b[p] == 255 {
			p++
		}
		if p >= len(b) {
			return nil, errHeader
		}
		marker := b[p]
		p++
		if marker == 0xd9 {
			return append(out, b[start:p]...), nil
		}
		if marker == 0x01 || marker >= 0xd0 && marker <= 0xd7 {
			out = append(out, b[start:p]...)
			continue
		}
		if p+2 > len(b) {
			return nil, errHeader
		}
		n := int(binary.BigEndian.Uint16(b[p : p+2]))
		if n < 2 || n > len(b)-p {
			return nil, errHeader
		}
		if marker != 0xe1 && marker != 0xed && marker != 0xfe {
			out = append(out, b[start:p+n]...)
		}
		p += n
		if marker == 0xda {
			// Copy entropy-coded data verbatim, including stuffed FF bytes and
			// restart markers. A later scan may be preceded by metadata too.
			scan := p
			for p < len(b) {
				if b[p] != 0xff {
					p++
					continue
				}
				next := p + 1
				for next < len(b) && b[next] == 0xff {
					next++
				}
				if next >= len(b) {
					return nil, errHeader
				}
				if b[next] == 0 || b[next] >= 0xd0 && b[next] <= 0xd7 {
					p = next + 1
					continue
				}
				break
			}
			out = append(out, b[scan:p]...)
		}
	}
	return nil, errHeader
}
func stripPNG(b []byte) ([]byte, error) {
	out := append([]byte{}, b[:8]...)
	for p := 8; p < len(b); {
		if len(b)-p < 12 {
			return nil, errHeader
		}
		n := uint64(binary.BigEndian.Uint32(b[p:p+4])) + 12
		if n > uint64(len(b)-p) {
			return nil, errHeader
		}
		end := p + int(n)
		tag := string(b[p+4 : p+8])
		switch tag {
		case "eXIf", "tEXt", "iTXt", "zTXt":
		default:
			out = append(out, b[p:end]...)
		}
		p = end
		if tag == "IEND" {
			if p != len(b) {
				return nil, errHeader
			}
			return out, nil
		}
	}
	return nil, errHeader
}
func le24(b []byte) int { return int(b[0]) | int(b[1])<<8 | int(b[2])<<16 }
func stripWebP(b []byte) ([]byte, int, int, error) {
	if uint64(binary.LittleEndian.Uint32(b[4:8]))+8 != uint64(len(b)) {
		return nil, 0, 0, errHeader
	}
	out := append([]byte{}, b[:12]...)
	w, h := 0, 0
	canvasW, canvasH := 0, 0
	images := 0
	imageType := ""
	extended, alpha := false, false
	for p := 12; p < len(b); {
		if len(b)-p < 8 {
			return nil, 0, 0, errHeader
		}
		n := uint64(binary.LittleEndian.Uint32(b[p+4 : p+8]))
		end := uint64(p) + 8 + n + (n & 1)
		if end > uint64(len(b)) {
			return nil, 0, 0, errHeader
		}
		tag := string(b[p : p+4])
		v := b[p+8 : p+8+int(n)]
		switch tag {
		case "VP8X":
			if n != 10 || extended || p != 12 || v[0]&0x02 != 0 {
				return nil, 0, 0, errHeader
			}
			extended = true
			canvasW, canvasH = le24(v[4:7])+1, le24(v[7:10])+1
		case "ANIM", "ANMF":
			return nil, 0, 0, errHeader
		case "ALPH":
			if !extended || alpha || images != 0 || n == 0 {
				return nil, 0, 0, errHeader
			}
			alpha = true
		case "VP8 ":
			if n < 10 || !bytes.Equal(v[3:6], []byte{0x9d, 1, 0x2a}) || v[0]&1 != 0 {
				return nil, 0, 0, errHeader
			}
			images++
			imageType = tag
			w = int(binary.LittleEndian.Uint16(v[6:8]) & 0x3fff)
			h = int(binary.LittleEndian.Uint16(v[8:10]) & 0x3fff)
		case "VP8L":
			if n < 5 || v[0] != 0x2f || v[4]&0xe0 != 0 {
				return nil, 0, 0, errHeader
			}
			images++
			imageType = tag
			x := binary.LittleEndian.Uint32(v[1:5])
			w = int(x&0x3fff) + 1
			h = int((x>>14)&0x3fff) + 1
		}
		if tag != "EXIF" && tag != "XMP " {
			start := len(out)
			out = append(out, b[p:int(end)]...)
			if tag == "VP8X" {
				out[start+8] &^= 0x0c
			}
		}
		p = int(end)
	}
	if images != 1 || extended && (canvasW != w || canvasH != h) || alpha && (!extended || imageType != "VP8 ") {
		return nil, 0, 0, errHeader
	}
	binary.LittleEndian.PutUint32(out[4:8], uint32(len(out)-8))
	return out, w, h, nil
}
