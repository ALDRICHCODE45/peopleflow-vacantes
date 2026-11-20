package application

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ExportLimit bounds a metrics CSV export, like the audit export (v2 §8).
const ExportLimit = 50_000

// TooLarge refuses an export above the limit; nothing is written or audited.
type TooLarge struct{ RowCount, Limit int }

func (e *TooLarge) Error() string { return "metrics export too large" }

// ErrUnknownKind is a kind with no export (a programming error in routing).
var ErrUnknownKind = errors.New("metrics export kind unknown")

// Export is a list's CSV export: the same rows, filters and order as the
// list, every row, read from the snapshot. Record builds one line on demand,
// so the handler streams without a second copy of the rows.
type Export struct {
	Filename string
	Header   []string
	rows     int
	record   func(i int) []string
}

func (e *Export) Len() int              { return e.rows }
func (e *Export) Record(i int) []string { return e.record(i) }

// WithExportLimit lowers the export row cap (tests only).
func (s *Service) WithExportLimit(n int) *Service {
	s.exportLimit = n
	return s
}

// Export answers GET …/metrics/{kind}/export. An audited kind (placements,
// candidates) writes one MetricsDetailExported row in its own transaction
// before anything is returned; a failed audit exports nothing (v2 §6).
func (s *Service) Export(ctx context.Context, company, actor uuid.UUID, kind, raw string) (*Export, error) {
	route, ok := map[string]Route{"deliveries": RouteDeliveries, "vacancies": RouteVacancies, "placements": RoutePlacements, "reassignments": RouteReassignments,
		"candidates": RouteCandidates, "applications": RouteApplications}[kind]
	if !ok {
		return nil, ErrUnknownKind
	}
	l, err := prepareList(company, raw, route, true)
	if err != nil {
		return nil, err
	}
	out := &Export{Filename: fmt.Sprintf("metricas-%s-%s-%s.csv", kind, l.p.From, l.p.To)}
	var owned bool
	switch route {
	case RouteDeliveries:
		b, err := s.buildDeliveries(ctx, l)
		if err != nil {
			return nil, err
		}
		out.Header, out.rows, out.record = deliveryHeader, len(b.rows), func(i int) []string { return deliveryRecord(b.rows[i]) }
	case RouteVacancies:
		b, err := s.buildVacancies(ctx, l)
		if err != nil {
			return nil, err
		}
		out.Header, out.rows, out.record = vacancyHeader, len(b.rows), func(i int) []string { return vacancyRecord(b.rows[i]) }
	case RoutePlacements:
		b, err := s.buildPlacements(ctx, l)
		if err != nil {
			return nil, err
		}
		owned = b.owned
		out.Header, out.rows, out.record = placementHeader, len(b.rows), func(i int) []string { return placementRecord(b.rows[i]) }
	case RouteReassignments:
		b, err := s.buildReassignments(ctx, l)
		if err != nil {
			return nil, err
		}
		out.Header, out.rows, out.record = reassignmentHeader, len(b.rows), func(i int) []string { return reassignmentRecord(b.rows[i]) }
	case RouteCandidates:
		b, err := s.buildCandidates(ctx, l)
		if err != nil {
			return nil, err
		}
		owned = b.owned
		out.Header, out.rows, out.record = candidateHeader, len(b.rows), func(i int) []string { return candidateRecord(b.rows[i]) }
	case RouteApplications:
		b, _, err := s.buildApplications(ctx, l)
		if err != nil {
			return nil, err
		}
		out.Header, out.rows, out.record = applicationHeader, len(b.rows), func(i int) []string { return applicationRecord(b.rows[i]) }
	}
	limit := s.exportLimit
	if out.rows > limit {
		return nil, &TooLarge{RowCount: out.rows, Limit: limit}
	}
	if route == RoutePlacements || route == RouteCandidates {
		if err := s.store.RecordDetail(ctx, DetailAudit{Company: company, Actor: actor, Exported: true, Report: kind, Vacancy: l.q.VacancyID,
			VacancyOwned: owned, Filters: auditFilters(l), RowCount: out.rows}); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// processKindHeader is the last column of every export whose rows name a
// process (replacement-processes-v1): its cells are the API codes original |
// replacement.
const processKindHeader = "Tipo de proceso"

// Cell formats. Dates are ISO (YYYY-MM-DD), instants RFC 3339 in UTC.

func cellInstant(at time.Time) string { return at.UTC().Format(time.RFC3339) }

func cellInstantPtr(at *time.Time) string {
	if at == nil {
		return ""
	}
	return cellInstant(*at)
}

func cellString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func cellInt(n *int) string {
	if n == nil {
		return ""
	}
	return strconv.Itoa(*n)
}

// cellPerson is the name, or «Cuenta eliminada» for a deleted account.
func cellPerson(p Person) string {
	if p.Name == nil {
		return "Cuenta eliminada"
	}
	return *p.Name
}

func cellPeople(people []Person) string {
	names := make([]string, len(people))
	for i, p := range people {
		names[i] = cellPerson(p)
	}
	return strings.Join(names, "; ")
}

// cellRequester follows the screen's labels: the name, «Cliente / Área sin
// especificar», or «Sin solicitante».
func cellRequester(r *Requester) string {
	switch {
	case r == nil:
		return "Sin solicitante"
	case r.ID == nil && r.Kind == "client":
		return "Cliente sin especificar"
	case r.ID == nil:
		return "Área sin especificar"
	case r.Name == nil:
		return ""
	}
	return *r.Name
}

var deliveryHeader = []string{"ID vacante", "Vacante", "Solicitante", "Atribuida a", "Fecha compromiso", "Fecha compromiso original",
	"Renegociaciones", "Meta alcanzada", "Resultado", "Días hábiles de retraso", "Días hábiles vencida", "Entregados", "Meta", processKindHeader}

func deliveryRecord(r DeliveryListRow) []string {
	return []string{r.Vacancy.DraftID.String(), r.Vacancy.Title, cellRequester(r.Requester), cellPeople(r.AttributedTo),
		cellString(r.CommitmentDate), cellString(r.OriginalCommitmentDate), strconv.Itoa(r.Renegotiations), cellInstantPtr(r.TargetReachedAt),
		r.Result, cellInt(r.BusinessDaysLate), cellInt(r.BusinessDaysOverdue), strconv.Itoa(r.Delivered), cellInt(r.Target), r.Vacancy.Kind}
}

var vacancyHeader = []string{"ID vacante", "Vacante", "Solicitante", "Responsable", "Publicada", "Último cierre", "Motivo del último cierre",
	"Días hábiles para cerrar", "Objetivo de cierre", "Resultado de entrega", "Cubiertas", "Requeridas", "Reasignaciones"}

func vacancyRecord(r VacancyRow) []string {
	responsible := ""
	if r.Responsible != nil {
		responsible = cellPerson(*r.Responsible)
	}
	lastDate, lastReason := "", ""
	if r.LastClose != nil {
		lastDate, lastReason = r.LastClose.Date, reasonKey(r.LastClose.Reason)
	}
	return []string{r.DraftID.String(), r.Title, cellRequester(r.Requester), responsible, cellInstant(r.OpenedAt), lastDate, lastReason,
		cellInt(r.BusinessDaysToClose), cellString(r.ClosingTarget), r.Delivery.Result, strconv.Itoa(r.Placements.Covered),
		cellInt(r.Placements.Required), strconv.Itoa(r.Reassignments)}
}

var placementHeader = []string{"ID crédito", "ID candidato", "Candidato", "ID vacante", "Vacante", "Solicitante", "Reconocidos", "Estado", "Contratado", processKindHeader}

func placementRecord(r PlacementListRow) []string {
	recipients := make([]string, len(r.Recipients))
	for i, p := range r.Recipients {
		recipients[i] = cellPerson(p.Person) + " (" + p.Kind + ")"
	}
	return []string{r.CreditID.String(), r.Candidate.ID.String(), r.Candidate.FullName, r.Vacancy.DraftID.String(), r.Vacancy.Title,
		cellRequester(r.Requester), strings.Join(recipients, "; "), r.Status, cellInstant(r.HiredAt), r.Vacancy.Kind}
}

var reassignmentHeader = []string{"ID reasignación", "Fecha", "ID vacante", "Vacante", "De", "A", "Motivo", "Nota", "Realizada por",
	"Días hábiles del tramo saliente", processKindHeader}

func reassignmentRecord(r ReassignmentRow) []string {
	return []string{r.ID.String(), cellInstant(r.PerformedAt), r.Vacancy.DraftID.String(), r.Vacancy.Title, cellPerson(r.From), cellPerson(r.To),
		r.Reason, cellString(r.Note), cellPerson(r.PerformedBy), strconv.Itoa(r.OutgoingTramoBusinessDays), r.Vacancy.Kind}
}

var candidateHeader = []string{"ID participación", "ID candidato", "Candidato", "ID vacante", "Vacante", "Etapa", "Nombre de etapa",
	"Días hábiles en etapa", "Detenido", "Entró a la etapa", processKindHeader}

func candidateRecord(r CandidateRow) []string {
	return []string{r.ParticipationID.String(), r.Candidate.ID.String(), r.Candidate.FullName, r.Vacancy.DraftID.String(), r.Vacancy.Title,
		r.Stage.Kind, r.Stage.Name, strconv.Itoa(r.BusinessDaysInStage), strconv.FormatBool(r.Stalled), cellInstant(r.EnteredStageAt), r.Vacancy.Kind}
}

var applicationHeader = []string{"ID vacante", "Vacante", "Solicitante", "Portal", "Sitio de carreras", "Manual", "Desconocido", "Total", processKindHeader}

func applicationRecord(r ApplicationRow) []string {
	return []string{r.Vacancy.DraftID.String(), r.Vacancy.Title, cellRequester(r.Requester), strconv.Itoa(r.Portal), strconv.Itoa(r.CareersSite),
		strconv.Itoa(r.Manual), strconv.Itoa(r.Unknown), strconv.Itoa(r.Total), r.Vacancy.Kind}
}
