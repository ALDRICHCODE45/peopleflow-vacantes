package application

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func alphaPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.NRGBA{R: 255, A: 128})
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// Logos (sections v2): PNG or WebP only (alpha kept), at least 64 px per side,
// same metadata stripping as every other kind. Other kinds keep 200 px.
func TestPrepareMediaKindLogo(t *testing.T) {
	withText := func(p []byte) []byte {
		return append(append(append([]byte{}, p[:33]...), pngChunk("tEXt", []byte("secret\x00gps"))...), p[33:]...)
	}
	var j bytes.Buffer
	if err := jpeg.Encode(&j, image.NewRGBA(image.Rect(0, 0, 200, 200)), nil); err != nil {
		t.Fatal(err)
	}
	alphaWebP := webFixture(webChunk("VP8X", []byte{0x10, 0, 0, 0, 63, 0, 0, 63, 0, 0}), webChunk("ALPH", []byte{0}), webChunk("VP8 ", []byte{0, 0, 0, 0x9d, 1, 0x2a, 64, 0, 64, 0}), webChunk("XMP ", []byte("private")))
	lossless := webFixture(webChunk("VP8L", []byte{0x2f, 63, 0xc0, 15, 0}))
	for _, tc := range []struct {
		name, kind string
		data       []byte
		typ, code  string
		w, h       int
	}{
		{"logo png 64", "logo", withText(alphaPNG(t, 64, 64)), "image/png", "", 64, 64},
		{"logo png wide", "logo", alphaPNG(t, 640, 64), "image/png", "", 640, 64},
		{"logo png 63", "logo", alphaPNG(t, 63, 200), "", "image_too_small", 63, 200},
		{"logo webp alpha", "logo", alphaWebP, "image/webp", "", 64, 64},
		{"logo webp lossless", "logo", lossless, "image/webp", "", 64, 64},
		{"logo jpeg", "logo", j.Bytes(), "", "unsupported_media_type", 0, 0},
		{"logo garbage", "logo", []byte("garbage"), "", "unsupported_media_type", 0, 0},
		{"logo too large", "logo", alphaPNG(t, 6001, 64), "", "image_too_large", 6001, 64},
		{"cover keeps 200", "cover", alphaPNG(t, 64, 64), "", "image_too_small", 64, 64},
		{"cover jpeg", "cover", j.Bytes(), "image/jpeg", "", 200, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			out, typ, w, h, code := PrepareMediaKind(tc.kind, tc.data)
			if code != tc.code || typ != tc.typ || w != tc.w || h != tc.h {
				t.Fatalf("%q %q %d %d", code, typ, w, h)
			}
			if code != "" {
				return
			}
			if bytes.Contains(out, []byte("secret")) || bytes.Contains(out, []byte("private")) {
				t.Fatal("metadata retained")
			}
			if typ == "image/png" {
				img, _, err := image.Decode(bytes.NewReader(out))
				if err != nil {
					t.Fatal(err)
				}
				if _, _, _, a := img.At(0, 0).RGBA(); a == 0xffff {
					t.Fatal("alpha lost")
				}
			}
		})
	}
	if !IsMediaKind("logo") || IsMediaKind("video") {
		t.Fatal("media kinds")
	}
}
