package http

import "testing"

func TestSingleByteRange(t *testing.T) {
	cases := map[string]bool{
		"bytes=0-99": true, "bytes=5-5": true, "bytes=100-": true, "bytes=-10": true, "bytes= 0-1": true,
		"bytes=5-2": false, "bytes=-0": false, "bytes=abc": false, "items=0-1": false, "bytes=0-1,4-5": false,
		"bytes=": false, "bytes=-": false, "bytes=1": false, "bytes=a-b": false, "bytes=0-99999999999999999999": false,
	}
	for raw, want := range cases {
		if got := singleByteRange(raw); got != want {
			t.Errorf("singleByteRange(%q) = %v, want %v", raw, got, want)
		}
	}
}
