package email

import (
	"strconv"
	"time"
	_ "time/tzdata" // America/Mexico_City must resolve in minimal containers
)

// TimeZone is the business time zone of every date in an email (§Content).
const TimeZone = "America/Mexico_City"

var mexicoCity = func() *time.Location {
	loc, err := time.LoadLocation(TimeZone)
	if err != nil {
		panic(err) // tzdata is embedded
	}
	return loc
}()

var monthsES = [...]string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}

// formatCivilDate formats a DATE value («1 de diciembre de 2026») from its
// own calendar components, never converted (a DATE read as midnight UTC must
// not shift to the previous day).
func formatCivilDate(t time.Time) string {
	y, m, d := t.Date()
	return strconv.Itoa(d) + " de " + monthsES[m-1] + " de " + strconv.Itoa(y)
}

// formatInstantDate formats the America/Mexico_City calendar day of an instant.
func formatInstantDate(t time.Time) string {
	return formatCivilDate(t.In(mexicoCity))
}
