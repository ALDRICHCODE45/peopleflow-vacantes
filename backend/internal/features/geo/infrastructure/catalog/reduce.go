package catalog

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

// Reduce reads the documented raw-source directory layout, never fetching or
// executing source content. ZIP members are streamed, not extracted to disk.
func Reduce(files fs.FS) (Data, []string, error) {
	var iso struct {
		Countries []struct {
			Code string `json:"alpha_2"`
		} `json:"3166-1"`
	}
	if err := decodeFile(files, "iso-countries/iso3166-1.json", &iso); err != nil {
		return Data{}, nil, err
	}
	names := map[string]map[string]string{}
	for _, locale := range []string{"es", "en"} {
		var cldr struct {
			Main map[string]struct {
				Names struct {
					Territories map[string]string `json:"territories"`
				} `json:"localeDisplayNames"`
			} `json:"main"`
		}
		if err := decodeFile(files, "cldr-"+locale+"/territories.json", &cldr); err != nil {
			return Data{}, nil, err
		}
		names[locale] = cldr.Main[locale].Names.Territories
	}
	var data Data
	for _, country := range iso.Countries {
		data.Countries = append(data.Countries, Country{country.Code, names["es"][country.Code], names["en"][country.Code]})
	}
	var states struct {
		Rows []struct {
			Code         string `json:"cve_ent"`
			Name         string `json:"nomgeo"`
			Abbreviation string `json:"nom_abrev"`
		} `json:"datos"`
	}
	if err := decodeFile(files, "inegi-states/states.json", &states); err != nil {
		return Data{}, nil, err
	}
	for _, state := range states.Rows {
		if !statePattern.MatchString(state.Code) {
			return Data{}, nil, fmt.Errorf("malformed INEGI state")
		}
		data.States = append(data.States, State{state.Code, state.Name, state.Abbreviation})
		var municipalities struct {
			Rows []struct {
				Code         string `json:"cvegeo"`
				State        string `json:"cve_ent"`
				Municipality string `json:"cve_mun"`
				Name         string `json:"nomgeo"`
			} `json:"datos"`
		}
		if err := decodeFile(files, "inegi-municipalities-"+state.Code+"/municipalities.json", &municipalities); err != nil {
			return Data{}, nil, err
		}
		if len(municipalities.Rows) == 0 {
			return Data{}, nil, fmt.Errorf("empty INEGI state %s", state.Code)
		}
		for _, m := range municipalities.Rows {
			if m.State != state.Code || m.Code != m.State+m.Municipality {
				return Data{}, nil, fmt.Errorf("inconsistent INEGI municipality %q", m.Code)
			}
			data.Municipalities = append(data.Municipalities, Municipality{m.State, m.Code, m.Name})
		}
	}
	f, err := files.Open("sepomex/CPdescarga.zip")
	if err != nil {
		return Data{}, nil, err
	}
	archive, err := io.ReadAll(io.LimitReader(f, (32<<20)+1))
	closeErr := f.Close()
	if err != nil {
		return Data{}, nil, err
	}
	if closeErr != nil {
		return Data{}, nil, closeErr
	}
	if len(archive) > 32<<20 {
		return Data{}, nil, fmt.Errorf("SEPOMEX archive exceeds 32 MiB")
	}
	z, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return Data{}, nil, err
	}
	members := 0
	for _, member := range z.File {
		if member.Name == "CPdescarga.txt" {
			members++
			if member.UncompressedSize64 > 64<<20 {
				return Data{}, nil, fmt.Errorf("SEPOMEX TXT exceeds 64 MiB")
			}
		}
	}
	if members != 1 {
		return Data{}, nil, fmt.Errorf("archive must contain exactly one CPdescarga.txt")
	}
	raw, err := z.Open("CPdescarga.txt")
	if err != nil {
		return Data{}, nil, err
	}
	defer raw.Close()
	data.PostalCodes, err = ReducePostal(io.LimitReader(raw, 64<<20))
	if err != nil {
		return Data{}, nil, err
	}
	return Validate(data)
}
func decodeFile(files fs.FS, name string, out any) error {
	f, err := files.Open(name)
	if err != nil {
		return err
	}
	defer f.Close()
	if err = json.NewDecoder(io.LimitReader(f, 32<<20)).Decode(out); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	return nil
}

func WriteCSV(dir string, data Data) error {
	data, _, err := Validate(data)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	all := map[string][][]string{
		"countries.csv": {{"country_code", "name_es", "name_en"}}, "mx_states.csv": {{"state_code", "name", "abbreviation"}},
		"mx_municipalities.csv": {{"state_code", "municipality_code", "name"}}, "mx_postal_codes.csv": {{"d_codigo", "c_estado", "c_mnpio"}},
	}
	for _, c := range data.Countries {
		all["countries.csv"] = append(all["countries.csv"], []string{c.Code, c.NameEs, c.NameEn})
	}
	for _, s := range data.States {
		all["mx_states.csv"] = append(all["mx_states.csv"], []string{s.Code, s.Name, s.Abbreviation})
	}
	for _, m := range data.Municipalities {
		all["mx_municipalities.csv"] = append(all["mx_municipalities.csv"], []string{m.StateCode, m.Code, m.Name})
	}
	for _, p := range data.PostalCodes {
		all["mx_postal_codes.csv"] = append(all["mx_postal_codes.csv"], []string{p.PostalCode, p.StateCode, p.MunicipalityCode[2:]})
	}
	for _, name := range []string{"countries.csv", "mx_states.csv", "mx_municipalities.csv", "mx_postal_codes.csv"} {
		f, err := os.Create(filepath.Join(dir, name))
		if err != nil {
			return err
		}
		w := csv.NewWriter(f)
		err = w.WriteAll(all[name])
		closeErr := f.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}
