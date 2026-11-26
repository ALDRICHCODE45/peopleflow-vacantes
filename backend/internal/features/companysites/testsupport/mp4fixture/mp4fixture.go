// Package mp4fixture writes tiny, structurally valid MP4 files box by box so
// tests never need ffmpeg or binary fixtures. It is test support only: no
// production package imports it.
package mp4fixture

import "encoding/binary"

// Options describe the boxes Build writes. Zero values give a 5 s, 1280x720
// `isom` file with `moov` before a 64-byte `mdat`.
type Options struct {
	Brand      string   // ftyp major brand (default "isom")
	Compatible []string // ftyp compatible brands
	Timescale  uint32   // mvhd timescale (default 1000); use ZeroTimescale for 0
	Duration   uint64   // mvhd duration in timescale units (default 5 s)
	Version1   bool     // mvhd and tkhd version 1 (64-bit times)
	Width      uint32   // first video track tkhd width in px (default 1280)
	Height     uint32   // first video track tkhd height in px (default 720)
	NoVideo    bool     // omit the video track
	AudioFirst bool     // put an audio track (tkhd 0x0) before the video track
	MoovLast   bool     // write moov after mdat
	MdatBytes  int      // mdat payload length (default 64)

	ZeroTimescale bool
}

// Box returns one box: 32-bit size, type, then the concatenated payloads.
func Box(typ string, payloads ...[]byte) []byte {
	n := 8
	for _, p := range payloads {
		n += len(p)
	}
	out := make([]byte, 8, n)
	binary.BigEndian.PutUint32(out, uint32(n))
	copy(out[4:8], typ)
	for _, p := range payloads {
		out = append(out, p...)
	}
	return out
}

// Ftyp returns an ftyp box with the given major and compatible brands.
func Ftyp(major string, compatible ...string) []byte {
	p := []byte(major)
	p = append(p, 0, 0, 2, 0)
	for _, c := range compatible {
		p = append(p, c...)
	}
	return Box("ftyp", p)
}

// Mvhd returns an mvhd box (only the fields the parser reads are meaningful).
func Mvhd(version1 bool, timescale uint32, duration uint64) []byte {
	if version1 {
		p := make([]byte, 112)
		p[0] = 1
		binary.BigEndian.PutUint32(p[20:24], timescale)
		binary.BigEndian.PutUint64(p[24:32], duration)
		return Box("mvhd", p)
	}
	p := make([]byte, 100)
	binary.BigEndian.PutUint32(p[12:16], timescale)
	binary.BigEndian.PutUint32(p[16:20], uint32(duration))
	return Box("mvhd", p)
}

// Tkhd returns a tkhd box with width/height as 16.16 fixed point.
func Tkhd(version1 bool, width, height uint32) []byte {
	if version1 {
		p := make([]byte, 96)
		p[0] = 1
		binary.BigEndian.PutUint32(p[88:92], width<<16)
		binary.BigEndian.PutUint32(p[92:96], height<<16)
		return Box("tkhd", p)
	}
	p := make([]byte, 84)
	binary.BigEndian.PutUint32(p[76:80], width<<16)
	binary.BigEndian.PutUint32(p[80:84], height<<16)
	return Box("tkhd", p)
}

// Hdlr returns an hdlr box with the handler type ("vide", "soun", ...).
func Hdlr(handler string) []byte {
	p := make([]byte, 24, 25)
	copy(p[8:12], handler)
	return Box("hdlr", append(p, 0))
}

// Trak returns a track with tkhd and mdia/hdlr.
func Trak(version1 bool, handler string, width, height uint32) []byte {
	return Box("trak", Tkhd(version1, width, height), Box("mdia", Box("mdhd", make([]byte, 24)), Hdlr(handler)))
}

// Build writes a whole file from o.
func Build(o Options) []byte {
	if o.Brand == "" {
		o.Brand = "isom"
	}
	if o.Timescale == 0 && !o.ZeroTimescale {
		o.Timescale = 1000
	}
	if o.Duration == 0 {
		o.Duration = 5 * uint64(max(o.Timescale, 1))
	}
	if o.Width == 0 && o.Height == 0 {
		o.Width, o.Height = 1280, 720
	}
	if o.MdatBytes == 0 {
		o.MdatBytes = 64
	}
	moovParts := [][]byte{Mvhd(o.Version1, o.Timescale, o.Duration)}
	if o.AudioFirst {
		moovParts = append(moovParts, Trak(o.Version1, "soun", 0, 0))
	}
	if !o.NoVideo {
		moovParts = append(moovParts, Trak(o.Version1, "vide", o.Width, o.Height))
	}
	moov := Box("moov", moovParts...)
	mdat := Box("mdat", make([]byte, o.MdatBytes))
	out := Ftyp(o.Brand, o.Compatible...)
	if o.MoovLast {
		return append(append(out, mdat...), moov...)
	}
	return append(append(out, moov...), mdat...)
}
