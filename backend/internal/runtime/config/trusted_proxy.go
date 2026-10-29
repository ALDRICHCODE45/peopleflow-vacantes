package config

import (
	"errors"
	"net/netip"
	"strings"
)

// LoadTrustedProxyCIDRs loads explicit proxy networks without disclosing invalid input.
func LoadTrustedProxyCIDRs(getenv func(string) string) ([]netip.Prefix, error) {
	value := strings.TrimSpace(getenv("TRUSTED_PROXY_CIDRS"))
	if value == "" {
		return nil, nil
	}
	var prefixes []netip.Prefix
	for _, part := range strings.Split(value, ",") {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(part))
		if err != nil || prefix.Bits() == 0 {
			return nil, errors.New("TRUSTED_PROXY_CIDRS must be a comma-separated list of non-default CIDR prefixes")
		}
		prefixes = append(prefixes, prefix.Masked())
	}
	return prefixes, nil
}
