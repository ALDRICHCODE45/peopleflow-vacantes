package application

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/jpeg"
	"image/png"
	"testing"
)

func pngFixture(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 200, 200))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func pngChunk(tag string, value []byte) []byte {
	b := make([]byte, 12+len(value))
	binary.BigEndian.PutUint32(b, uint32(len(value)))
	copy(b[4:], tag)
	copy(b[8:], value)
	binary.BigEndian.PutUint32(b[len(b)-4:], crc32.ChecksumIEEE(b[4:len(b)-4]))
	return b
}
func webChunk(tag string, value []byte) []byte {
	b := make([]byte, 8+len(value)+(len(value)&1))
	copy(b, tag)
	binary.LittleEndian.PutUint32(b[4:], uint32(len(value)))
	copy(b[8:], value)
	return b
}
func webFixture(chunks ...[]byte) []byte {
	b := []byte("RIFF\x00\x00\x00\x00WEBP")
	for _, c := range chunks {
		b = append(b, c...)
	}
	binary.LittleEndian.PutUint32(b[4:], uint32(len(b)-8))
	return b
}
func TestMediaTypesAndMetadata(t *testing.T) {
	p := pngFixture(t)
	p = append(append(append([]byte{}, p[:33]...), pngChunk("tEXt", []byte("secret\x00location"))...), p[33:]...)
	var j bytes.Buffer
	if err := jpeg.Encode(&j, image.NewRGBA(image.Rect(0, 0, 200, 200)), nil); err != nil {
		t.Fatal(err)
	}
	raw := j.Bytes()
	jdata := append([]byte{255, 216, 255, 225, 0, 8, 'E', 'x', 'i', 'f', 0, 0}, raw[2:]...)
	vp8 := []byte{0, 0, 0, 0x9d, 1, 0x2a, 200, 0, 200, 0}
	x := []byte{0x0c, 0, 0, 0, 199, 0, 0, 199, 0, 0}
	web := webFixture(webChunk("VP8X", x), webChunk("VP8 ", vp8), webChunk("EXIF", []byte("private")), webChunk("XMP ", []byte("private")))
	lossless := webFixture(webChunk("VP8L", []byte{0x2f, 199, 0xc0, 49, 0}))
	for _, tc := range []struct {
		name, typ string
		data      []byte
	}{
		{"png renamed jpg", "image/png", p}, {"jpeg", "image/jpeg", jdata}, {"webp extended", "image/webp", web}, {"webp lossy", "image/webp", webFixture(webChunk("VP8 ", vp8))}, {"webp lossless", "image/webp", lossless},
	} {
		t.Run(tc.name, func(t *testing.T) {
			out, typ, w, h, code := PrepareMedia(tc.data)
			if code != "" || typ != tc.typ || w != 200 || h != 200 {
				t.Fatalf("%s %s %d %d", code, typ, w, h)
			}
			if bytes.Contains(out, []byte("private")) || bytes.Contains(out, []byte("secret")) || bytes.Contains(out, []byte("Exif")) {
				t.Fatal("metadata retained")
			}
			if typ != "image/webp" {
				if _, _, err := image.Decode(bytes.NewReader(out)); err != nil {
					t.Fatal(err)
				}
			}
			if tc.name == "jpeg" && !bytes.Equal(out, raw) {
				t.Fatal("JPEG compressed data changed")
			}
			if tc.name == "webp extended" {
				if out[20]&0x0c != 0 || int(binary.LittleEndian.Uint32(out[4:8])) != len(out)-8 {
					t.Fatal("WebP flags/size")
				}
			}
		})
	}
	for _, data := range [][]byte{[]byte("garbage"), {255, 216, 255}, []byte("RIFF\x00\x00\x00\x00WEBP"), make([]byte, MaxMediaBytes+1)} {
		_, _, _, _, code := PrepareMedia(data)
		want := "unsupported_media_type"
		if len(data) > MaxMediaBytes {
			want = "payload_too_large"
		}
		if code != want {
			t.Fatalf("got %s want %s", code, want)
		}
	}
}
func TestJPEGMetadataAfterScan(t *testing.T) {
	var b bytes.Buffer
	if err := jpeg.Encode(&b, image.NewRGBA(image.Rect(0, 0, 200, 200)), nil); err != nil {
		t.Fatal(err)
	}
	raw := b.Bytes()
	input := append(append(append([]byte{}, raw[:len(raw)-2]...), []byte{255, 225, 0, 8, 'E', 'x', 'i', 'f', 0, 0, 255, 237, 0, 3, 1, 255, 254, 0, 3, 2}...), raw[len(raw)-2:]...)
	out, _, _, _, code := PrepareMedia(input)
	if code != "" || !bytes.Equal(out, raw) {
		t.Fatalf("interscan metadata not removed: %s", code)
	}
	if _, _, err := image.Decode(bytes.NewReader(out)); err != nil {
		t.Fatal(err)
	}
}

func TestMediaDimensionBounds(t *testing.T) {
	for _, axis := range []int{16, 20} {
		for _, n := range []uint32{199, 200, 6000, 6001} {
			p := pngFixture(t)
			binary.BigEndian.PutUint32(p[axis:axis+4], n)
			binary.BigEndian.PutUint32(p[29:33], crc32.ChecksumIEEE(p[12:29]))
			_, _, _, _, code := PrepareMedia(p)
			want := ""
			if n == 199 {
				want = "image_too_small"
			}
			if n == 6001 {
				want = "image_too_large"
			}
			if code != want {
				t.Fatalf("axis %d n %d: %s", axis, n, code)
			}
		}
	}
}
