package application

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/jpeg"
	"testing"
)

func TestJPEGTruncatesAtEOI(t *testing.T) {
	var b bytes.Buffer
	if err := jpeg.Encode(&b, image.NewRGBA(image.Rect(0, 0, 200, 200)), nil); err != nil {
		t.Fatal(err)
	}
	raw := append([]byte{}, b.Bytes()...)
	input := append(b.Bytes(), []byte{255, 225, 0, 8, 'E', 'x', 'i', 'f', 0, 0, 255, 237, 0, 3, 1, 255, 254, 0, 3, 2}...)
	input = append(input, []byte("trailing junk")...)
	out, _, _, _, code := PrepareMedia(input)
	if code != "" || !bytes.Equal(out, raw) || !bytes.HasSuffix(out, []byte{255, 217}) || bytes.Contains(out, []byte("Exif")) {
		t.Fatalf("trailing bytes retained: %s", code)
	}
	if _, _, err := image.Decode(bytes.NewReader(out)); err != nil {
		t.Fatal(err)
	}
}

// Header fixtures deliberately stop before entropy data: production reads
// dimensions, not pixels. VP8L packs width-1 and height-1 into 14 bits each.
func webLossless(w, h int) []byte {
	b := make([]byte, 5)
	b[0] = 0x2f
	binary.LittleEndian.PutUint32(b[1:], uint32(w-1)|uint32(h-1)<<14)
	return webChunk("VP8L", b)
}
func webCanvas(w, h int, flags byte) []byte {
	b := make([]byte, 10)
	b[0] = flags
	for i := 0; i < 3; i++ {
		b[4+i] = byte((w - 1) >> (8 * i))
		b[7+i] = byte((h - 1) >> (8 * i))
	}
	return webChunk("VP8X", b)
}
func TestWebPBitstreamContract(t *testing.T) {
	vp8 := webChunk("VP8 ", []byte{0, 0, 0, 0x9d, 1, 0x2a, 200, 0, 200, 0})
	alpha := webChunk("ALPH", []byte{0})
	for _, tc := range []struct {
		name   string
		chunks [][]byte
		code   string
	}{
		{"lossless", [][]byte{webLossless(200, 200)}, ""},
		{"extended lossless", [][]byte{webCanvas(200, 200, 0), webLossless(200, 200)}, ""},
		{"alpha lossy", [][]byte{webCanvas(200, 200, 0x10), alpha, vp8}, ""},
		{"canvas only", [][]byte{webCanvas(200, 200, 0)}, "unsupported_media_type"},
		{"canvas mismatch lossless", [][]byte{webCanvas(200, 200, 0), webLossless(6001, 200)}, "unsupported_media_type"},
		{"canvas mismatch lossy", [][]byte{webCanvas(201, 200, 0), vp8}, "unsupported_media_type"},
		{"duplicate image", [][]byte{webLossless(200, 200), webLossless(200, 200)}, "unsupported_media_type"},
		{"mixed images", [][]byte{vp8, webLossless(200, 200)}, "unsupported_media_type"},
		{"animation flag", [][]byte{webCanvas(200, 200, 2), webLossless(200, 200)}, "unsupported_media_type"},
		{"ANIM", [][]byte{webCanvas(200, 200, 0), webChunk("ANIM", make([]byte, 6)), webLossless(200, 200)}, "unsupported_media_type"},
		{"ANMF", [][]byte{webCanvas(200, 200, 0), webChunk("ANMF", make([]byte, 16)), webLossless(200, 200)}, "unsupported_media_type"},
		{"alpha without extended", [][]byte{alpha, vp8}, "unsupported_media_type"},
		{"alpha with lossless", [][]byte{webCanvas(200, 200, 0x10), alpha, webLossless(200, 200)}, "unsupported_media_type"},
		{"alpha after image", [][]byte{webCanvas(200, 200, 0x10), vp8, alpha}, "unsupported_media_type"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, _, _, code := PrepareMedia(webFixture(tc.chunks...))
			if code != tc.code {
				t.Fatalf("got %q want %q", code, tc.code)
			}
		})
	}
}
func TestWebPCodedDimensionBounds(t *testing.T) {
	for _, n := range []int{199, 200, 6000, 6001} {
		for _, extended := range []bool{false, true} {
			for _, axis := range []bool{false, true} {
				w, h := n, 200
				if axis {
					w, h = 200, n
				}
				chunks := [][]byte{webLossless(w, h)}
				if extended {
					chunks = append([][]byte{webCanvas(w, h, 0)}, chunks...)
				}
				_, _, gotW, gotH, code := PrepareMedia(webFixture(chunks...))
				want := ""
				if n == 199 {
					want = "image_too_small"
				}
				if n == 6001 {
					want = "image_too_large"
				}
				if code != want || gotW != w || gotH != h {
					t.Fatalf("%dx%d extended=%v: %s %dx%d", w, h, extended, code, gotW, gotH)
				}
			}
		}
	}
}
