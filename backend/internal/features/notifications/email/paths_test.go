package email

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// The Q3 path map, one code table (§Path map).
func TestPathMap(t *testing.T) {
	job := "44444444-4444-4444-8444-444444444444"
	part := "55555555-5555-4555-8555-555555555555"
	inv := "66666666-6666-4666-8666-666666666666"
	cases := []struct {
		link Link
		want string
	}{
		{Link{Kind: LinkVacancy, JobID: testJob}, "/empresa/vacantes/" + job + "/pipeline"},
		{Link{Kind: LinkVacancyCandidates, JobID: testJob}, "/empresa/vacantes/" + job + "/pipeline"},
		{Link{Kind: LinkParticipation, JobID: testJob, ParticipationID: testParticipation}, "/empresa/vacantes/" + job + "/pipeline?candidato=" + part},
		{Link{Kind: LinkVacancyDelivery, JobID: testJob}, "/empresa/vacantes/" + job + "/configuracion/entrega"},
		{Link{Kind: LinkApplication, JobID: testJob, ParticipationID: testParticipation}, "/candidato/postulaciones?postulacion=" + part},
		{Link{Kind: LinkAssessment, InvitationID: testInvitation}, "/candidato/evaluaciones/" + inv},
	}
	for _, tc := range cases {
		got, err := linkPath(tc.link)
		if err != nil || got != tc.want {
			t.Errorf("%s: got %q err=%v, want %q", tc.link.Kind, got, err, tc.want)
		}
	}
	if _, err := linkPath(Link{Kind: "secret", JobID: uuid.New()}); err == nil {
		t.Error("unknown kind accepted")
	}
	if PathMemberUnassignedFallback != "/empresa" || PathCandidateFallback != "/candidato/postulaciones" ||
		PathMemberPreferences != "/empresa/configuracion/notificaciones" || PathCandidatePreferences != "/candidato/configuracion/notificaciones" ||
		PathUnsubscribeLanding != "/notificaciones/baja" {
		t.Error("fixed paths drifted from §Path map")
	}
}

// Spanish dates in America/Mexico_City (§Content): «26 de noviembre de 2026».
func TestFormatDates(t *testing.T) {
	months := []string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}
	for i, name := range months {
		d := time.Date(2026, time.Month(i+1), 5, 0, 0, 0, 0, time.UTC)
		if got, want := formatCivilDate(d), "5 de "+name+" de 2026"; got != want {
			t.Errorf("civil %v: got %q want %q", d, got, want)
		}
	}
	// Instants are converted to Mexico City first.
	instants := map[time.Time]string{
		time.Date(2026, 11, 27, 3, 30, 0, 0, time.UTC):                    "26 de noviembre de 2026", // 21:30 the day before
		time.Date(2026, 11, 27, 6, 0, 0, 0, time.UTC):                     "27 de noviembre de 2026", // local midnight
		time.Date(2027, 1, 1, 5, 59, 59, 0, time.UTC):                     "31 de diciembre de 2026",
		time.Date(2026, 11, 26, 20, 0, 0, 0, time.FixedZone("x", 9*3600)): "26 de noviembre de 2026",
	}
	for in, want := range instants {
		if got := formatInstantDate(in); got != want {
			t.Errorf("instant %v: got %q want %q", in, got, want)
		}
	}
	// A DATE value is never shifted, whatever location the driver attached.
	if got := formatCivilDate(time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)); got != "1 de diciembre de 2026" {
		t.Errorf("civil UTC midnight shifted: %q", got)
	}
}
