package board

import (
	"encoding/json"
	"strconv"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
)

func validateManualStudies(raw []byte, out *ManualCandidate, fields *manualFields) error {
	out.Education = []ManualEducation{}
	if manualNull(raw) {
		fields.add("candidate.education", "required")
		return nil
	}
	var records []json.RawMessage
	if json.Unmarshal(raw, &records) != nil {
		fields.add("candidate.education", "invalid")
		return nil
	}
	if len(records) == 0 {
		fields.add("candidate.education", "required")
	}
	if len(records) > 10 {
		fields.add("candidate.education", "too_long")
	}
	for i, record := range records {
		path := "candidate.education[" + strconv.Itoa(i) + "]"
		var object map[string]json.RawMessage
		if json.Unmarshal(record, &object) != nil || object == nil {
			fields.add(path, "invalid")
			continue
		}
		keys := []string{"level", "institution", "field", "status", "start_year", "end_year"}
		values, err := manualObject(record, keys...)
		if err != nil {
			return err
		}
		missing := false
		for _, key := range keys {
			if _, ok := values[key]; !ok {
				fields.add(path+"."+key, "required")
				missing = true
			}
		}
		if missing {
			continue
		}
		e := ManualEducation{}
		if value := manualLiteral(values["level"], path+".level", true, languages.ValidEducationLevel, fields); value != nil {
			e.Level = *value
		}
		if value := manualLiteral(values["status"], path+".status", true, languages.ValidEducationStatus, fields); value != nil {
			e.Status = *value
		}
		for _, entry := range []struct {
			key    string
			target **string
		}{{"institution", &e.Institution}, {"field", &e.Field}} {
			*entry.target = fields.text(values[entry.key], path+"."+entry.key, false, 120)
			if *entry.target != nil && **entry.target == "" {
				fields.add(path+"."+entry.key, "invalid")
			}
		}
		for _, entry := range []struct {
			key    string
			target **int
		}{{"start_year", &e.StartYear}, {"end_year", &e.EndYear}} {
			if manualNull(values[entry.key]) {
				continue
			}
			var year int
			if json.Unmarshal(values[entry.key], &year) != nil || year < 1950 || year > 2100 {
				fields.add(path+"."+entry.key, "invalid")
			} else {
				*entry.target = &year
			}
		}
		if e.Status == "in_progress" && !manualNull(values["end_year"]) {
			fields.add(path+".end_year", "not_allowed")
		} else if e.EndYear != nil && e.StartYear != nil && *e.StartYear > *e.EndYear {
			fields.add(path+".end_year", "invalid")
		}
		out.Education = append(out.Education, e)
	}
	return nil
}
