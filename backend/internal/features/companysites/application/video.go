package application

import (
	"encoding/binary"
	"errors"
	"io"
	"math"
	"math/bits"
	"slices"
)

// Hero video (slice B, contract §2.4): an MP4 of at most 20 MiB and 30 s,
// validated structurally (no decoding, no ffmpeg).
const (
	MaxVideoBytes      = 20 * 1024 * 1024
	MaxVideoDurationMS = 30000
	// MaxSafeDurationMS caps the reported duration of absurd files at the
	// largest integer a JSON client reads exactly.
	MaxSafeDurationMS = 1<<53 - 1
	// MaxVideoSide bounds the tkhd dimensions kept; anything else is unknown.
	MaxVideoSide = 16384

	VideoContentType = "video/mp4"
	HeroVideoKind    = "hero_video"
)

// Hostile-input bounds: every box header is checked against its parent and
// the walk stops after a fixed number of headers.
const (
	maxTopLevelBoxes = 1024
	maxBoxHeaders    = 4096
	maxFtypBrands    = 64
)

// MP4 brands accepted in ftyp (major or compatible).
var videoBrands = []string{"isom", "iso2", "mp41", "mp42", "avc1"}

// VideoInfo is what InspectVideo reads from the boxes. Width and Height come
// from the first video track's tkhd and are nil when absent or implausible.
type VideoInfo struct {
	DurationMS int64
	Width      *int
	Height     *int
}

var errBox = errors.New("malformed mp4 box")

type box struct {
	typ          string
	payload, end int64
}

type mp4Reader struct {
	r       io.ReaderAt
	headers int
}

func (m *mp4Reader) read(off, n int64) ([]byte, error) {
	b := make([]byte, n)
	if _, err := m.r.ReadAt(b, off); err != nil {
		return nil, errBox
	}
	return b, nil
}

// box reads the header at off; the box must end at or before limit.
func (m *mp4Reader) box(off, limit int64) (box, error) {
	m.headers++
	if m.headers > maxBoxHeaders || limit-off < 8 {
		return box{}, errBox
	}
	h, err := m.read(off, 8)
	if err != nil {
		return box{}, err
	}
	size := uint64(binary.BigEndian.Uint32(h))
	header := int64(8)
	switch size {
	case 0: // extends to the end of the enclosing space
		size = uint64(limit - off)
	case 1:
		if limit-off < 16 {
			return box{}, errBox
		}
		large, err := m.read(off+8, 8)
		if err != nil {
			return box{}, err
		}
		size = binary.BigEndian.Uint64(large)
		header = 16
	}
	if string(h[4:8]) == "uuid" {
		header += 16
	}
	if size < uint64(header) || size > uint64(limit-off) {
		return box{}, errBox
	}
	return box{typ: string(h[4:8]), payload: off + header, end: off + int64(size)}, nil
}

// children calls fn for each box tiling [from, to) exactly.
func (m *mp4Reader) children(from, to int64, fn func(box) (bool, error)) error {
	for off := from; off < to; {
		b, err := m.box(off, to)
		if err != nil {
			return err
		}
		stop, err := fn(b)
		if err != nil || stop {
			return err
		}
		off = b.end
	}
	return nil
}

// InspectVideo validates an MP4 by its boxes: ftyp first with an accepted
// brand (else unsupported_media_type), then a moov (before or after mdat) with
// an mvhd giving a positive duration (else video_invalid). Codes: "",
// payload_too_large, unsupported_media_type, video_invalid, video_too_long
// (DurationMS is then the measured duration, saturated at MaxSafeDurationMS).
func InspectVideo(r io.ReaderAt, size int64) (VideoInfo, string) {
	if size > MaxVideoBytes {
		return VideoInfo{}, "payload_too_large"
	}
	m := &mp4Reader{r: r}
	ftyp, err := m.box(0, size)
	if err != nil || ftyp.typ != "ftyp" || !m.brandOK(ftyp) {
		return VideoInfo{}, "unsupported_media_type"
	}
	var info VideoInfo
	var moov *box
	top := 0
	err = m.children(ftyp.end, size, func(b box) (bool, error) {
		if top++; top > maxTopLevelBoxes {
			return true, errBox
		}
		if b.typ == "moov" && moov == nil {
			moov = &b
		}
		return false, nil
	})
	if err != nil || moov == nil {
		return VideoInfo{}, "video_invalid"
	}
	var timescale, duration uint64
	var haveMvhd, haveDims bool
	err = m.children(moov.payload, moov.end, func(b box) (bool, error) {
		switch {
		case b.typ == "mvhd" && !haveMvhd:
			haveMvhd = true
			ts, d, e := m.mvhd(b)
			timescale, duration = ts, d
			return false, e
		case b.typ == "trak" && !haveDims:
			w, h, video, err := m.trak(b)
			if err != nil {
				return true, err
			}
			if video {
				haveDims = true
				if w >= 1 && w <= MaxVideoSide && h >= 1 && h <= MaxVideoSide {
					info.Width, info.Height = &w, &h
				}
			}
		}
		return false, nil
	})
	if err != nil || !haveMvhd || timescale == 0 || duration == 0 {
		return VideoInfo{}, "video_invalid"
	}
	info.DurationMS = durationMS(duration, timescale)
	if info.DurationMS > MaxVideoDurationMS {
		return VideoInfo{DurationMS: info.DurationMS}, "video_too_long"
	}
	return info, ""
}

func (m *mp4Reader) brandOK(b box) bool {
	n := b.end - b.payload
	if n < 8 || (n-8)%4 != 0 || (n-8)/4 > maxFtypBrands {
		return false
	}
	p, err := m.read(b.payload, n)
	if err != nil {
		return false
	}
	if slices.Contains(videoBrands, string(p[:4])) {
		return true
	}
	for i := 8; i < len(p); i += 4 {
		if slices.Contains(videoBrands, string(p[i:i+4])) {
			return true
		}
	}
	return false
}

// mvhd reads timescale and duration (version 0: 32-bit times, version 1:
// 64-bit). An all-ones duration means "unknown" and is rejected.
func (m *mp4Reader) mvhd(b box) (uint64, uint64, error) {
	if b.end-b.payload < 20 {
		return 0, 0, errBox
	}
	v, err := m.read(b.payload, 1)
	if err != nil {
		return 0, 0, err
	}
	switch v[0] {
	case 0:
		p, err := m.read(b.payload+12, 8)
		if err != nil {
			return 0, 0, err
		}
		d := uint64(binary.BigEndian.Uint32(p[4:8]))
		if d == math.MaxUint32 {
			d = 0
		}
		return uint64(binary.BigEndian.Uint32(p[0:4])), d, nil
	case 1:
		if b.end-b.payload < 32 {
			return 0, 0, errBox
		}
		p, err := m.read(b.payload+20, 12)
		if err != nil {
			return 0, 0, err
		}
		d := binary.BigEndian.Uint64(p[4:12])
		if d == math.MaxUint64 {
			d = 0
		}
		return uint64(binary.BigEndian.Uint32(p[0:4])), d, nil
	}
	return 0, 0, errBox
}

// trak returns the tkhd size (integer part of the 16.16 values) and whether
// mdia/hdlr declares a video handler.
func (m *mp4Reader) trak(t box) (int, int, bool, error) {
	w, h, video := 0, 0, false
	err := m.children(t.payload, t.end, func(b box) (bool, error) {
		switch b.typ {
		case "tkhd":
			var err error
			w, h, err = m.tkhd(b)
			return false, err
		case "mdia":
			return false, m.children(b.payload, b.end, func(c box) (bool, error) {
				if c.typ != "hdlr" {
					return false, nil
				}
				if c.end-c.payload < 12 {
					return true, errBox
				}
				p, err := m.read(c.payload+8, 4)
				video = err == nil && string(p) == "vide"
				return true, err
			})
		}
		return false, nil
	})
	return w, h, video, err
}

func (m *mp4Reader) tkhd(b box) (int, int, error) {
	v, err := m.read(b.payload, 1)
	if err != nil {
		return 0, 0, err
	}
	off := int64(76)
	switch v[0] {
	case 0:
	case 1:
		off = 88
	default:
		return 0, 0, errBox
	}
	if b.end-b.payload < off+8 {
		return 0, 0, errBox
	}
	p, err := m.read(b.payload+off, 8)
	if err != nil {
		return 0, 0, err
	}
	return int(binary.BigEndian.Uint32(p[0:4]) >> 16), int(binary.BigEndian.Uint32(p[4:8]) >> 16), nil
}

// durationMS is ceil(duration*1000/timescale) without overflow, saturated.
func durationMS(duration, timescale uint64) int64 {
	hi, lo := bits.Mul64(duration, 1000)
	if hi >= timescale {
		return MaxSafeDurationMS
	}
	q, rem := bits.Div64(hi, lo, timescale)
	if q >= MaxSafeDurationMS {
		return MaxSafeDurationMS
	}
	if rem != 0 {
		q++
	}
	return int64(q)
}
