package publicjobs

import (
	"net/url"
	"strings"
)

// enrich derives card metadata from public content only. List and detail use
// this same path; it never receives a draft or any candidate identity/count.
func enrich(d Detail) Detail {
	if d.Company.LogoURL != nil {
		u, err := url.Parse(*d.Company.LogoURL)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Opaque != "" {
			d.Company.LogoURL = nil
		}
	}
	normalized := strings.Join(strings.Fields(d.DescriptionPlain), " ")
	d.Excerpt = nil
	d.ExcerptTruncated = false
	if normalized != "" {
		text := normalized
		runes := []rune(text)
		if len(runes) > 240 {
			text = string(runes[:240])
			if boundary := strings.LastIndexByte(text, ' '); boundary >= 0 {
				text = text[:boundary]
			}
			d.ExcerptTruncated = true
		}
		d.Excerpt = &text
	}
	if d.Source == "legacy" {
		d.Benefits = Benefits{Predefined: []string{}, Custom: []string{}}
		d.Skills = []string{}
		d.Applicants = nil
		d.ScreeningQuestions = nil
	}
	d.BenefitsTotal = len(d.Benefits.Predefined) + len(d.Benefits.Custom)
	d.BenefitsPreview = Benefits{Predefined: preview(d.Benefits.Predefined, 3), Custom: []string{}}
	d.BenefitsPreview.Custom = preview(d.Benefits.Custom, 3-len(d.BenefitsPreview.Predefined))
	d.SkillsTotal = len(d.Skills)
	d.SkillsPreview = preview(d.Skills, 6)
	if d.Skills == nil {
		d.Skills = []string{}
	}
	return d
}

func preview(values []string, limit int) []string {
	if len(values) > limit {
		values = values[:limit]
	}
	return append([]string{}, values...)
}
