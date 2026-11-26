package application

import (
	"bytes"
	"encoding/binary"
	"math"
	"math/rand"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/testsupport/mp4fixture"
)

func inspect(b []byte) (VideoInfo, string) {
	return InspectVideo(bytes.NewReader(b), int64(len(b)))
}

func dims(v VideoInfo) (int, int) {
	if v.Width == nil || v.Height == nil {
		return 0, 0
	}
	return *v.Width, *v.Height
}

func TestInspectVideoValid(t *testing.T) {
	for _, tc := range []struct {
		name   string
		o      mp4fixture.Options
		ms     int64
		w, h   int
		noDims bool
	}{
		{"moov before mdat", mp4fixture.Options{}, 5000, 1280, 720, false},
		{"moov after mdat", mp4fixture.Options{MoovLast: true}, 5000, 1280, 720, false},
		{"version 1 64-bit", mp4fixture.Options{Version1: true, Timescale: 90000, Duration: 90000 * 12, Width: 1920, Height: 1080}, 12000, 1920, 1080, false},
		{"exactly 30 s", mp4fixture.Options{Timescale: 600, Duration: 600 * 30}, 30000, 1280, 720, false},
		{"sub-ms rounds up", mp4fixture.Options{Timescale: 3000, Duration: 1}, 1, 1280, 720, false},
		{"brand iso2", mp4fixture.Options{Brand: "iso2"}, 5000, 1280, 720, false},
		{"brand mp41", mp4fixture.Options{Brand: "mp41"}, 5000, 1280, 720, false},
		{"brand mp42", mp4fixture.Options{Brand: "mp42"}, 5000, 1280, 720, false},
		{"brand avc1", mp4fixture.Options{Brand: "avc1"}, 5000, 1280, 720, false},
		{"compatible brand", mp4fixture.Options{Brand: "M4V ", Compatible: []string{"M4V ", "mp42"}}, 5000, 1280, 720, false},
		{"audio track first", mp4fixture.Options{AudioFirst: true, Width: 640, Height: 360}, 5000, 640, 360, false},
		{"no video track", mp4fixture.Options{NoVideo: true}, 5000, 0, 0, true},
		{"absurd width is unknown", mp4fixture.Options{Width: 20000, Height: 720}, 5000, 0, 0, true},
		{"zero height is unknown", mp4fixture.Options{Width: 1280, Height: 0, Version1: true}, 5000, 0, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v, code := inspect(mp4fixture.Build(tc.o))
			if code != "" || v.DurationMS != tc.ms {
				t.Fatalf("code=%q v=%+v", code, v)
			}
			if tc.noDims != (v.Width == nil && v.Height == nil) {
				t.Fatalf("dims %+v", v)
			}
			if w, h := dims(v); !tc.noDims && (w != tc.w || h != tc.h) {
				t.Fatalf("dims %dx%d", w, h)
			}
		})
	}
}

func TestInspectVideoLastBoxToEndOfFile(t *testing.T) {
	b := mp4fixture.Build(mp4fixture.Options{})
	mdat := len(b) - (8 + 64)
	binary.BigEndian.PutUint32(b[mdat:], 0) // size 0 = extends to the end of the file
	if _, code := inspect(b); code != "" {
		t.Fatal(code)
	}
}

func TestInspectVideoLargeSize(t *testing.T) {
	// A 64-bit largesize mdat (size field 1).
	mdat := make([]byte, 16+32)
	binary.BigEndian.PutUint32(mdat, 1)
	copy(mdat[4:8], "mdat")
	binary.BigEndian.PutUint64(mdat[8:16], uint64(len(mdat)))
	b := append(append(mp4fixture.Ftyp("isom"), mp4fixture.Box("moov", mp4fixture.Mvhd(false, 1000, 1000))...), mdat...)
	if v, code := inspect(b); code != "" || v.DurationMS != 1000 {
		t.Fatal(code, v)
	}
}

func TestInspectVideoRejections(t *testing.T) {
	valid := mp4fixture.Build(mp4fixture.Options{})
	ftyp := mp4fixture.Ftyp("isom")
	mvhd := mp4fixture.Mvhd(false, 1000, 1000)
	allOnes := mp4fixture.Build(mp4fixture.Options{Duration: math.MaxUint32})
	largeTooSmall := append(append([]byte{}, ftyp...), 0, 0, 0, 1, 'm', 'd', 'a', 't', 0, 0, 0, 0, 0, 0, 0, 8)
	largeOverflow := append(append([]byte{}, ftyp...), 0, 0, 0, 1, 'm', 'd', 'a', 't', 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xf0)
	trakLie := append(append([]byte{}, ftyp...), mp4fixture.Box("moov", mvhd, mp4fixture.Box("trak", []byte{0, 0, 1, 0, 't', 'k', 'h', 'd'}))...)
	moovLie := append(append([]byte{}, ftyp...), mp4fixture.Box("moov", mvhd)...)
	binary.BigEndian.PutUint32(moovLie[len(ftyp):], 4096)
	headerLie := append(append([]byte{}, ftyp...), 0, 0, 0, 4, 'f', 'r', 'e', 'e')
	shortMvhd := append(append([]byte{}, ftyp...), mp4fixture.Box("moov", mp4fixture.Box("mvhd", make([]byte, 12)))...)
	badVersion := append(append([]byte{}, ftyp...), mp4fixture.Box("moov", append([]byte{}, mvhd...))...)
	badVersion[len(ftyp)+16] = 2
	shortTkhd := append(append([]byte{}, ftyp...), mp4fixture.Box("moov", mvhd, mp4fixture.Box("trak", mp4fixture.Box("tkhd", make([]byte, 40)), mp4fixture.Box("mdia", mp4fixture.Hdlr("vide"))))...)
	trailing := append(append([]byte{}, valid...), 0, 0, 0)
	frees := func(n int) []byte {
		out := []byte{}
		for range n {
			out = append(out, mp4fixture.Box("free")...)
		}
		return out
	}
	topBomb := append(append(append([]byte{}, ftyp...), mp4fixture.Box("moov", mvhd)...), frees(5000)...)
	nestedBomb := append(append([]byte{}, ftyp...), mp4fixture.Box("moov", mvhd, frees(5000))...)
	deep := mvhd
	for range 64 {
		deep = mp4fixture.Box("trak", deep)
	}
	deepNest := append(append([]byte{}, ftyp...), mp4fixture.Box("moov", mvhd, deep)...)
	for _, tc := range []struct {
		name string
		data []byte
		code string
	}{
		{"empty", nil, "unsupported_media_type"},
		{"png", []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR"), "unsupported_media_type"},
		{"quicktime brand", mp4fixture.Build(mp4fixture.Options{Brand: "qt  "}), "unsupported_media_type"},
		{"quicktime compatible only", mp4fixture.Build(mp4fixture.Options{Brand: "qt  ", Compatible: []string{"qt  "}}), "unsupported_media_type"},
		{"ftyp not first", append(mp4fixture.Box("free"), valid...), "unsupported_media_type"},
		{"ftyp too short", append(mp4fixture.Box("ftyp", []byte("iso")), valid[len(ftyp):]...), "unsupported_media_type"},
		{"ftyp ragged brands", append(mp4fixture.Box("ftyp", []byte("isom\x00\x00\x00\x00mp4")), valid[len(ftyp):]...), "unsupported_media_type"},
		{"ftyp only", ftyp, "video_invalid"},
		{"no moov", append(append([]byte{}, ftyp...), mp4fixture.Box("mdat", make([]byte, 16))...), "video_invalid"},
		{"moov without mvhd", append(append([]byte{}, ftyp...), mp4fixture.Box("moov", mp4fixture.Trak(false, "vide", 10, 10))...), "video_invalid"},
		{"zero timescale", mp4fixture.Build(mp4fixture.Options{ZeroTimescale: true, Duration: 10}), "video_invalid"},
		{"zero duration", append(append([]byte{}, ftyp...), mp4fixture.Box("moov", mp4fixture.Mvhd(false, 1000, 0))...), "video_invalid"},
		{"unknown duration v0", allOnes, "video_invalid"},
		{"unknown duration v1", mp4fixture.Build(mp4fixture.Options{Version1: true, Duration: math.MaxUint64}), "video_invalid"},
		{"mvhd truncated payload", shortMvhd, "video_invalid"},
		{"mvhd version 2", badVersion, "video_invalid"},
		{"tkhd truncated payload", shortTkhd, "video_invalid"},
		{"largesize below header", largeTooSmall, "video_invalid"},
		{"largesize overflow", largeOverflow, "video_invalid"},
		{"header size below 8", headerLie, "video_invalid"},
		{"child larger than parent", trakLie, "video_invalid"},
		{"moov larger than file", moovLie, "video_invalid"},
		{"trailing bytes", trailing, "video_invalid"},
		{"top-level box bomb", topBomb, "video_invalid"},
		{"nested box bomb", nestedBomb, "video_invalid"},
		// The parser only descends moov/trak/mdia: deep nesting elsewhere is skipped, not walked.
		{"nesting is not walked", deepNest, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v, code := inspect(tc.data)
			if code != tc.code {
				t.Fatalf("code=%q v=%+v", code, v)
			}
		})
	}
}

func TestInspectVideoTooLong(t *testing.T) {
	for _, tc := range []struct {
		name string
		o    mp4fixture.Options
		ms   int64
	}{
		{"30001 ms", mp4fixture.Options{Duration: 30001}, 30001},
		{"rounding up past the limit", mp4fixture.Options{Timescale: 3000, Duration: 90001}, 30001},
		{"one hour v1", mp4fixture.Options{Version1: true, Timescale: 90000, Duration: 90000 * 3600}, 3600000},
		{"huge v1 duration saturates", mp4fixture.Options{Version1: true, Timescale: 1, Duration: math.MaxUint64 - 1}, MaxSafeDurationMS},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v, code := inspect(mp4fixture.Build(tc.o))
			if code != "video_too_long" || v.DurationMS != tc.ms {
				t.Fatalf("code=%q v=%+v", code, v)
			}
		})
	}
}

type sizedReader struct{}

func (sizedReader) ReadAt(p []byte, _ int64) (int, error) { return len(p), nil }

func TestInspectVideoSizeCap(t *testing.T) {
	if _, code := InspectVideo(sizedReader{}, MaxVideoBytes+1); code != "payload_too_large" {
		t.Fatal(code)
	}
}

// Every strict prefix of a valid file is rejected (a truncated upload never
// passes) and nothing panics; the only exception is cutting exactly the whole
// trailing mdat off, which leaves a complete (if empty) file.
func TestInspectVideoTruncated(t *testing.T) {
	for _, o := range []mp4fixture.Options{{}, {MoovLast: true}, {Version1: true, AudioFirst: true}} {
		b := mp4fixture.Build(o)
		for n := range len(b) {
			if !o.MoovLast && n == len(b)-(8+64) {
				continue
			}
			if _, code := inspect(b[:n]); code != "unsupported_media_type" && code != "video_invalid" {
				t.Fatalf("prefix %d/%d: %q", n, len(b), code)
			}
		}
	}
}

// Random byte corruption and random size fields never panic and always map to
// a known outcome.
func TestInspectVideoMutations(t *testing.T) {
	seeds := [][]byte{mp4fixture.Build(mp4fixture.Options{}), mp4fixture.Build(mp4fixture.Options{MoovLast: true, Version1: true, AudioFirst: true})}
	rng := rand.New(rand.NewSource(67))
	for i := range 20000 {
		b := append([]byte{}, seeds[i%len(seeds)]...)
		for range 1 + rng.Intn(4) {
			p := rng.Intn(len(b))
			if rng.Intn(3) == 0 && p+4 <= len(b) {
				binary.BigEndian.PutUint32(b[p:], rng.Uint32())
			} else {
				b[p] = byte(rng.Intn(256))
			}
		}
		switch _, code := inspect(b); code {
		case "", "unsupported_media_type", "video_invalid", "video_too_long":
		default:
			t.Fatalf("unexpected code %q", code)
		}
	}
}

func FuzzInspectVideo(f *testing.F) {
	f.Add(mp4fixture.Build(mp4fixture.Options{}))
	f.Add(mp4fixture.Build(mp4fixture.Options{MoovLast: true, Version1: true}))
	f.Add([]byte{})
	f.Fuzz(func(t *testing.T, b []byte) {
		v, code := inspect(b)
		if code == "" && (v.DurationMS < 1 || v.DurationMS > MaxVideoDurationMS) {
			t.Fatalf("accepted %+v", v)
		}
	})
}
