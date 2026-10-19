// Package catalog parses the small, versioned CSV contract. It never downloads
// data or stores settlements; untrusted raw sources are reduced separately.
package catalog

import (
	"bufio"
	"encoding/csv"
	"fmt"
	"io"
	"io/fs"
	"regexp"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"
)

type Country struct{ Code, NameEs, NameEn string }
type State struct{ Code, Name, Abbreviation string }
type Municipality struct{ StateCode, Code, Name string }
type PostalCode struct{ PostalCode, StateCode, MunicipalityCode string }
type Data struct {
	Countries      []Country
	States         []State
	Municipalities []Municipality
	PostalCodes    []PostalCode
}

var countryPattern = regexp.MustCompile(`^[A-Z]{2}$`)
var statePattern = regexp.MustCompile(`^[0-9]{2}$`)
var fivePattern = regexp.MustCompile(`^[0-9]{5}$`)
var threePattern = regexp.MustCompile(`^[0-9]{3}$`)

// Options isolates the optional SEPOMEX step from the ISO/INEGI catalog.
type Options struct{ SkipPostalCodes bool }

func ReadCSV(files fs.FS) (Data, []string, error) {
	return ReadCSVWithOptions(files, Options{})
}

func ReadCSVWithOptions(files fs.FS, options Options) (Data, []string, error) {
	var data Data
	specs := []struct {
		name   string
		header []string
		add    func([]string)
	}{
		{"countries.csv", []string{"country_code", "name_es", "name_en"}, func(r []string) { data.Countries = append(data.Countries, Country{r[0], r[1], r[2]}) }},
		{"mx_states.csv", []string{"state_code", "name", "abbreviation"}, func(r []string) { data.States = append(data.States, State{r[0], r[1], r[2]}) }},
		{"mx_municipalities.csv", []string{"state_code", "municipality_code", "name"}, func(r []string) { data.Municipalities = append(data.Municipalities, Municipality{r[0], r[1], r[2]}) }},
		{"mx_postal_codes.csv", []string{"d_codigo", "c_estado", "c_mnpio"}, func(r []string) { data.PostalCodes = append(data.PostalCodes, PostalCode{r[0], r[1], r[1] + r[2]}) }},
	}
	for _, spec := range specs {
		if options.SkipPostalCodes && spec.name == "mx_postal_codes.csv" {
			continue
		}
		f, err := files.Open(spec.name)
		if err != nil {
			return Data{}, nil, err
		}
		rows, err := csv.NewReader(f).ReadAll()
		closeErr := f.Close()
		if err != nil {
			return Data{}, nil, fmt.Errorf("%s: %w", spec.name, err)
		}
		if closeErr != nil {
			return Data{}, nil, closeErr
		}
		if len(rows) < 2 || !slices.Equal(rows[0], spec.header) {
			return Data{}, nil, fmt.Errorf("%s: invalid header or empty catalog", spec.name)
		}
		for _, row := range rows[1:] {
			spec.add(row)
		}
	}
	return ValidateWithOptions(data, options)
}

// Validate rejects corrupt catalogs, but lists and skips validly formatted
// SEPOMEX pairs absent from the authoritative INEGI municipality set.
func Validate(data Data) (Data, []string, error) {
	return ValidateWithOptions(data, Options{})
}

func ValidateWithOptions(data Data, options Options) (Data, []string, error) {
	// Skipping SEPOMEX must not parse or validate its values, even when the
	// caller supplied them. The core catalog has no dependency on postal data.
	if options.SkipPostalCodes {
		data.PostalCodes = nil
	}
	countries := map[string]bool{}
	states := map[string]bool{}
	municipalities := map[string]bool{}
	text := func(s string) bool {
		return strings.TrimSpace(s) != "" && utf8.ValidString(s) && !strings.ContainsAny(s, "\x00\r\n")
	}
	if len(data.Countries) == 0 || len(data.States) == 0 || len(data.Municipalities) == 0 || (!options.SkipPostalCodes && len(data.PostalCodes) == 0) {
		return Data{}, nil, fmt.Errorf("empty catalog")
	}
	for _, c := range data.Countries {
		if !countryPattern.MatchString(c.Code) || countries[c.Code] || !text(c.NameEs) || !text(c.NameEn) {
			return Data{}, nil, fmt.Errorf("invalid or duplicate country %q", c.Code)
		}
		countries[c.Code] = true
	}
	if !countries["MX"] {
		return Data{}, nil, fmt.Errorf("Mexico missing from countries")
	}
	for _, s := range data.States {
		if !statePattern.MatchString(s.Code) || states[s.Code] || !text(s.Name) || !text(s.Abbreviation) {
			return Data{}, nil, fmt.Errorf("invalid or duplicate state %q", s.Code)
		}
		states[s.Code] = true
	}
	for _, m := range data.Municipalities {
		if !fivePattern.MatchString(m.Code) || !states[m.StateCode] || !strings.HasPrefix(m.Code, m.StateCode) || municipalities[m.Code] || !text(m.Name) {
			return Data{}, nil, fmt.Errorf("invalid or duplicate municipality %q", m.Code)
		}
		municipalities[m.Code] = true
	}
	valid := make([]PostalCode, 0, len(data.PostalCodes))
	var skipped []string
	seen := map[string]bool{}
	for _, p := range data.PostalCodes {
		if !fivePattern.MatchString(p.PostalCode) || !statePattern.MatchString(p.StateCode) || !fivePattern.MatchString(p.MunicipalityCode) || !strings.HasPrefix(p.MunicipalityCode, p.StateCode) {
			return Data{}, nil, fmt.Errorf("invalid postal pair %q/%q", p.PostalCode, p.MunicipalityCode)
		}
		key := p.PostalCode + "/" + p.MunicipalityCode
		if seen[key] {
			continue
		}
		seen[key] = true
		if !municipalities[p.MunicipalityCode] {
			skipped = append(skipped, key)
			continue
		}
		valid = append(valid, p)
	}
	data.PostalCodes = valid
	sort.Slice(data.Countries, func(i, j int) bool { return data.Countries[i].Code < data.Countries[j].Code })
	sort.Slice(data.States, func(i, j int) bool { return data.States[i].Code < data.States[j].Code })
	sort.Slice(data.Municipalities, func(i, j int) bool { return data.Municipalities[i].Code < data.Municipalities[j].Code })
	sort.Slice(data.PostalCodes, func(i, j int) bool {
		a, b := data.PostalCodes[i], data.PostalCodes[j]
		if a.PostalCode != b.PostalCode {
			return a.PostalCode < b.PostalCode
		}
		return a.MunicipalityCode < b.MunicipalityCode
	})
	sort.Strings(skipped)
	return data, skipped, nil
}

// ReducePostal accepts the national pipe-delimited TXT, including its optional
// notice line. Only ASCII code columns are retained (the raw file is Latin-1).
func ReducePostal(raw io.Reader) ([]PostalCode, error) {
	// This TXT is not quoted CSV: settlement names can contain bare quotes.
	reader := bufio.NewScanner(raw)
	reader.Buffer(make([]byte, 4096), 1<<20)
	var positions [3]int
	found := false
	var out []PostalCode
	seen := map[string]bool{}
	width := 0
	for reader.Scan() {
		line := strings.TrimSuffix(reader.Text(), "\r")
		if line == "" {
			continue
		}
		row := strings.Split(line, "|")
		if !found {
			for i := range positions {
				positions[i] = -1
			}
			for i, v := range row {
				switch strings.TrimPrefix(v, "\ufeff") {
				case "d_codigo":
					positions[0] = i
				case "c_estado":
					positions[1] = i
				case "c_mnpio":
					positions[2] = i
				}
			}
			found = positions[0] >= 0 && positions[1] >= 0 && positions[2] >= 0
			if found {
				width = len(row)
			}
			continue
		}
		if len(row) != width {
			return nil, fmt.Errorf("postal TXT: inconsistent row width")
		}
		cp, state, mun := row[positions[0]], row[positions[1]], row[positions[2]]
		if !fivePattern.MatchString(cp) || !statePattern.MatchString(state) || !threePattern.MatchString(mun) {
			return nil, fmt.Errorf("postal TXT: malformed code %q/%q/%q", cp, state, mun)
		}
		key := cp + state + mun
		if !seen[key] {
			out = append(out, PostalCode{cp, state, state + mun})
			seen[key] = true
		}
	}
	if err := reader.Err(); err != nil {
		return nil, err
	}
	if !found || len(out) == 0 {
		return nil, fmt.Errorf("postal TXT: missing header or data")
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		return a.PostalCode+a.MunicipalityCode < b.PostalCode+b.MunicipalityCode
	})
	return out, nil
}
