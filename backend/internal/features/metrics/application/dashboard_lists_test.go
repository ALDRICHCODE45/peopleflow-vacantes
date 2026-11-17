package application

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
)

// The company dashboard lists (company-dashboard-v2 §5): every d2a figure
// equals the total of the list it opens, for the owner and a recruiter.

var listOwner = Viewer{UserID: uuid.New(), Owner: true}

func dashCandidates(t *testing.T, svc *Service, company uuid.UUID, viewer Viewer, raw string) *DashboardList[CandidateRow, CandidateFacets] {
	t.Helper()
	out, err := svc.DashboardCandidateList(context.Background(), company, viewer, raw)
	if err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	return out
}

func invalidFields(t *testing.T, err error) []Field {
	t.Helper()
	var f *InvalidFilter
	if !errors.As(err, &f) {
		t.Fatalf("want invalid filter, got %v", err)
	}
	return f.Fields
}

func TestParseDashboardList_Strict(t *testing.T) {
	ok := map[Route][]string{
		RouteDashboardCandidates:   {"", "window=7&in_process=true&on=2026-03-20", "stage_kind=new,retired&stalled=true&vacancy_id=" + uuid.NewString(), "sort=candidate&order=desc&limit=100"},
		RouteDashboardDeliveries:   {"state=overdue", "state=due_this_week&sort=business_days_overdue"},
		RouteDashboardVacancies:    {"status=published&sort=positions_open", "sort=in_process", "sort=published_at&order=asc"},
		RouteDashboardApplications: {"from=2026-03-20&to=2026-03-20&channel=manual", "channel=portal,careers_site,unknown"},
	}
	for route, raws := range ok {
		for _, raw := range raws {
			if _, err := parseDashboardList(raw, route, false); err != nil {
				t.Errorf("%v %q: %v", route, raw, err)
			}
		}
	}
	for _, tc := range []struct {
		route Route
		raw   string
		want  []Field
	}{
		{RouteDashboardCandidates, "on=2026-03-20", []Field{{"in_process", "required"}}},
		{RouteDashboardCandidates, "in_process=false", []Field{{"in_process", "invalid"}}},
		{RouteDashboardCandidates, "in_process=true&on=2026-3-20", []Field{{"on", "invalid"}}},
		{RouteDashboardCandidates, "recruiter_id=" + uuid.NewString() + "&from=2026-01-01", []Field{{"from", "unknown"}, {"recruiter_id", "unknown"}}},
		{RouteDashboardCandidates, "state=overdue&window=14", []Field{{"state", "unknown"}, {"window", "invalid"}}},
		{RouteDashboardCandidates, "stage_kind=new,new", []Field{{"stage_kind", "invalid"}}},
		{RouteDashboardDeliveries, "state=late", []Field{{"state", "invalid"}}},
		{RouteDashboardDeliveries, "state=overdue&state=overdue", []Field{{"state", "duplicate"}}},
		{RouteDashboardVacancies, "status=paused&sort=opened_at", []Field{{"sort", "invalid"}, {"status", "invalid"}}},
		{RouteDashboardVacancies, "scope=company", []Field{{"scope", "unknown"}}},
		{RouteDashboardApplications, "from=2026-03-21&to=2026-03-20", []Field{{"to", "range"}}},
		{RouteDashboardApplications, "from=2026-03-32", []Field{{"from", "invalid"}}},
		{RouteDashboardApplications, "vacancy_id=x&limit=0", []Field{{"limit", "invalid"}, {"vacancy_id", "invalid"}}},
	} {
		_, err := parseDashboardList(tc.raw, tc.route, false)
		if got := invalidFields(t, err); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%v %q: %v, want %v", tc.route, tc.raw, got, tc.want)
		}
	}
	// Exports take no cursor or limit.
	if got := invalidFields(t, func() error {
		_, err := parseDashboardList("limit=5&cursor=x", RouteDashboardVacancies, true)
		return err
	}()); !reflect.DeepEqual(got, []Field{{"cursor", "unknown"}, {"limit", "unknown"}}) {
		t.Fatal(got)
	}
	// Defaults: the first sort, desc unless it is a text sort.
	q, _ := parseDashboardList("", RouteDashboardVacancies, false)
	if q.Sort != "published_at" || q.Order != "desc" || q.Window != 30 || q.Limit != DefaultLimit {
		t.Fatalf("%+v", q)
	}
}

// in_process (current and each series point via on) equals its candidates
// list, for the owner and for a recruiter; on outside the series is range.
func TestDashboardCandidates_InProcessEqualsSeries(t *testing.T) {
	fx := newHistoryFixture()
	for _, viewer := range []Viewer{listOwner, {UserID: fx.u}} {
		sum := fx.summary(t, viewer, "window=7")
		for _, point := range sum.InProcess.Series {
			got := dashCandidates(t, fx.svc, fx.company, viewer, "window=7&in_process=true&on="+point.Date)
			if got.Total != point.Value || len(got.Items) != point.Value {
				t.Errorf("owner=%v %s: total %d, want %d", viewer.Owner, point.Date, got.Total, point.Value)
			}
		}
		if got := dashCandidates(t, fx.svc, fx.company, viewer, "window=7&in_process=true"); got.Total != sum.InProcess.Current || got.Scope != viewer.scope() {
			t.Errorf("current %d, want %d", got.Total, sum.InProcess.Current)
		}
	}
	// Rows at the end of 03-19 (owner): A screening p1, p2, p4, screening_ok p3; B in_process; C screening.
	got := dashCandidates(t, fx.svc, fx.company, listOwner, "window=7&in_process=true&on=2026-03-19&sort=title")
	if got.Facets.StageKind.New != 0 || got.Facets.StageKind.Placement != 0 || got.Facets.StageKind.Screening != 4 || got.Facets.StageKind.ScreeningOK != 1 || got.Facets.StageKind.InProcess != 1 {
		t.Fatalf("facets %+v", got.Facets)
	}
	if got.AppliedFilters["in_process"] != true || got.AppliedFilters["on"] != "2026-03-19" {
		t.Fatalf("applied %v", got.AppliedFilters)
	}
	// p1 entered screening 03-19 20:00 UTC; at the end of 03-19 it has 0 days.
	for _, r := range got.Items {
		if r.ParticipationID == fx.p1.ID && (r.Stage.Kind != "screening" || r.BusinessDaysInStage != 0 || !r.EnteredStageAt.Equal(at("2026-03-19T20:00:00Z"))) {
			t.Fatalf("p1 %+v", r)
		}
	}
	_, err := fx.svc.DashboardCandidateList(context.Background(), fx.company, listOwner, "window=7&in_process=true&on=2026-03-16")
	if f := invalidFields(t, err); !reflect.DeepEqual(f, []Field{{"on", "range"}}) {
		t.Fatal(f)
	}
	// A vacancy outside the recruiter's scope: empty list, title null; the
	// owner gets the title.
	mine := dashCandidates(t, fx.svc, fx.company, Viewer{UserID: fx.u}, "in_process=true&vacancy_id="+fx.b.ID.String())
	if mine.Total != 0 || len(mine.Items) != 0 || mine.AppliedFilters["vacancy"].(VacancyFilter).Title != nil {
		t.Fatalf("%+v", mine)
	}
	all := dashCandidates(t, fx.svc, fx.company, listOwner, "in_process=true&vacancy_id="+fx.b.ID.String())
	if all.Total != 1 || *all.AppliedFilters["vacancy"].(VacancyFilter).Title != "Backend" {
		t.Fatalf("%+v", all)
	}
}

// The vacancies section's in_process opens candidates?vacancy_id=V&in_process=true.
func TestDashboardCandidates_TopVacancyInProcess(t *testing.T) {
	fx := newHistoryFixture()
	sec, err := fx.svc.DashboardVacancies(context.Background(), fx.company, listOwner, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, top := range sec.Top {
		if got := dashCandidates(t, fx.svc, fx.company, listOwner, "in_process=true&vacancy_id="+top.Vacancy.DraftID.String()); got.Total != top.InProcess {
			t.Errorf("%s: %d, want %d", top.Vacancy.Title, got.Total, top.InProcess)
		}
	}
}

// Without in_process the list is the pipeline section's universe: every
// stage figure and its stalled count equal the list, scoped by role.
func TestDashboardCandidates_PipelineStagesAndStalled(t *testing.T) {
	px := newPipelineFixture()
	fx := newHistoryFixture()
	fx.store.pipelineStore = px.store
	fx.svc = NewService(fx.store, holidays("2026-03-16"), func() time.Time { return at(pipelineAsOf) })
	for _, viewer := range []Viewer{listOwner, {UserID: px.u}} {
		pipe, err := fx.svc.DashboardPipeline(context.Background(), fx.company, viewer, "")
		if err != nil {
			t.Fatal(err)
		}
		att, _ := fx.svc.DashboardAttention(context.Background(), fx.company, viewer, "")
		all := dashCandidates(t, fx.svc, fx.company, viewer, "")
		for _, st := range pipe.Stages {
			got := dashCandidates(t, fx.svc, fx.company, viewer, "stage_kind="+st.Kind)
			stalled := dashCandidates(t, fx.svc, fx.company, viewer, "stage_kind="+st.Kind+"&stalled=true")
			if got.Total != st.Candidates || stalled.Total != st.Stalled {
				t.Errorf("owner=%v %s: %d/%d, want %d/%d", viewer.Owner, st.Kind, got.Total, stalled.Total, st.Candidates, st.Stalled)
			}
		}
		if s := dashCandidates(t, fx.svc, fx.company, viewer, "stalled=true"); s.Total != att.Stalled.Total || all.Facets.Stalled != att.Stalled.Total {
			t.Errorf("stalled %d facet %d, want %d", s.Total, all.Facets.Stalled, att.Stalled.Total)
		}
	}
	// Ursula's list never holds Backend's candidates.
	for _, r := range dashCandidates(t, fx.svc, fx.company, Viewer{UserID: px.u}, "limit=100").Items {
		if r.Vacancy.DraftID != px.a.ID {
			t.Fatalf("out of scope %+v", r)
		}
	}
}

func TestDashboardDeliveries_EqualAttention(t *testing.T) {
	fx := newHistoryFixture()
	fx.deliveryVacancy("Uno", "2026-03-13", 4)
	fx.deliveryVacancy("Dos", "2026-03-23", 2)
	fx.deliveryVacancy("Hoy", "2026-03-24", 1)
	fx.deliveryVacancy("Domingo", "2026-03-29", 1)
	fx.deliveryVacancy("Lunes", "2026-03-30", 1)
	theirs := fx.deliveryVacancy("Ajena", "2026-03-20", 1)
	theirs.Tramos = nil
	for _, viewer := range []Viewer{listOwner, {UserID: fx.u}} {
		att := fx.attention(t, viewer)
		for state, want := range map[string]int{"overdue": att.Overdue.Total, "due_this_week": att.DueThisWeek.Total} {
			got, err := fx.svc.DashboardDeliveryList(context.Background(), fx.company, viewer, "state="+state)
			if err != nil {
				t.Fatal(err)
			}
			if got.Total != want || got.Facets.State.Overdue != att.Overdue.Total || got.Facets.State.DueThisWeek != att.DueThisWeek.Total {
				t.Errorf("owner=%v %s: %d %+v, want %d", viewer.Owner, state, got.Total, got.Facets, want)
			}
			for _, r := range got.Items {
				if (state == "overdue") != (r.Result == "overdue") || (state == "overdue") != (r.BusinessDaysOverdue != nil) {
					t.Errorf("%s row %+v", state, r)
				}
			}
		}
	}
	if fx.attention(t, listOwner).Overdue.Total != 3 || fx.attention(t, Viewer{UserID: fx.u}).Overdue.Total != 2 {
		t.Fatal("fixture")
	}
}

func TestDashboardVacancies_PublishedAndPositions(t *testing.T) {
	fx := newHistoryFixture()
	for _, viewer := range []Viewer{listOwner, {UserID: fx.u}} {
		sum := fx.summary(t, viewer, "")
		got, err := fx.svc.DashboardVacancyList(context.Background(), fx.company, viewer, "status=published&sort=positions_open")
		if err != nil {
			t.Fatal(err)
		}
		var pos Positions
		for _, r := range got.Items {
			pos.Covered += r.Positions.Covered
			pos.Required += r.Positions.Required
		}
		if got.Total != sum.PublishedVacancies.Current || pos != sum.Positions || got.Facets.Status.Published != got.Total {
			t.Errorf("owner=%v: %d %+v %+v, want %d %+v", viewer.Owner, got.Total, pos, got.Facets, sum.PublishedVacancies.Current, sum.Positions)
		}
		// The response-level positions aggregate the whole filtered result,
		// not the page: one item per page still answers the summary figure.
		paged, err := fx.svc.DashboardVacancyList(context.Background(), fx.company, viewer, "status=published&sort=positions_open&limit=1")
		if err != nil {
			t.Fatal(err)
		}
		if paged.Positions != sum.Positions || len(paged.Items) != min(1, got.Total) {
			t.Errorf("owner=%v: paged positions %+v (%d items), want %+v", viewer.Owner, paged.Positions, len(paged.Items), sum.Positions)
		}
	}
	all, _ := fx.svc.DashboardVacancyList(context.Background(), fx.company, listOwner, "sort=in_process")
	if all.Total != 4 || all.Facets.Status != (StatusFacet{Published: 2, Paused: 1, Closed: 1}) {
		t.Fatalf("%+v", all.Facets)
	}
	// Without a status filter the aggregate sums every row in the result.
	var allPos Positions
	for _, r := range all.Items {
		allPos.Covered += r.Positions.Covered
		allPos.Required += r.Positions.Required
	}
	if all.Positions != allPos {
		t.Fatalf("positions %+v, want %+v", all.Positions, allPos)
	}
	// A (4 in process) first; C paused counts 0 (its candidates open nothing).
	if all.Items[0].Vacancy.DraftID != fx.a.ID || all.Items[0].InProcess != 4 || all.Items[0].Status != "published" {
		t.Fatalf("%+v", all.Items[0])
	}
	for _, r := range all.Items {
		if r.Vacancy.DraftID == fx.c.ID && (r.Status != "paused" || r.InProcess != 0) {
			t.Fatalf("%+v", r)
		}
	}
	// positions_open desc: A has 2 open, B none (no headcount).
	byOpen, _ := fx.svc.DashboardVacancyList(context.Background(), fx.company, listOwner, "status=published&sort=positions_open")
	if byOpen.Items[0].Vacancy.DraftID != fx.a.ID {
		t.Fatalf("%+v", byOpen.Items)
	}
}

func TestDashboardApplications_EqualOriginDays(t *testing.T) {
	fx := newHistoryFixture()
	fx.a.Tracks[4].Channel = "careers_site"
	fx.c.Tracks[0].Channel = "manual"
	fx.c.Tracks = append(fx.c.Tracks, Track{ID: uuid.New(), CreatedAt: at("2026-03-24T05:00:00Z"), Channel: "unknown", Discarded: true})
	for _, viewer := range []Viewer{listOwner, {UserID: fx.u}} {
		o, err := fx.svc.DashboardOrigin(context.Background(), fx.company, viewer, "window=7")
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range o.ByDay {
			all, err := fx.svc.DashboardApplicationList(context.Background(), fx.company, viewer, "window=7&from="+d.Date+"&to="+d.Date)
			if err != nil {
				t.Fatal(err)
			}
			manual, _ := fx.svc.DashboardApplicationList(context.Background(), fx.company, viewer, "window=7&from="+d.Date+"&to="+d.Date+"&channel=manual")
			organic, _ := fx.svc.DashboardApplicationList(context.Background(), fx.company, viewer, "window=7&from="+d.Date+"&to="+d.Date+"&channel=portal,careers_site,unknown")
			if all.Total != d.Organic+d.Manual || manual.Total != d.Manual || organic.Total != d.Organic {
				t.Errorf("owner=%v %s: %d/%d/%d, want %d/%d", viewer.Owner, d.Date, all.Total, organic.Total, manual.Total, d.Organic, d.Manual)
			}
		}
	}
	_, err := fx.svc.DashboardApplicationList(context.Background(), fx.company, listOwner, "window=7&from=2026-03-17&to=2026-03-25")
	if f := invalidFields(t, err); !reflect.DeepEqual(f, []Field{{"from", "range"}, {"to", "range"}}) {
		t.Fatal(f)
	}
}

// Keyset pages walk every row once; the cursor binds route, filters, sort,
// order, window and scope.
func TestDashboardLists_PaginationAndCursorBinding(t *testing.T) {
	fx := newHistoryFixture()
	full := dashCandidates(t, fx.svc, fx.company, listOwner, "in_process=true&on=2026-03-19&limit=100")
	seen := []uuid.UUID{}
	raw := "in_process=true&on=2026-03-19&limit=2"
	page := dashCandidates(t, fx.svc, fx.company, listOwner, raw)
	for {
		for _, r := range page.Items {
			seen = append(seen, r.ParticipationID)
		}
		if page.NextCursor == nil {
			break
		}
		page = dashCandidates(t, fx.svc, fx.company, listOwner, raw+"&cursor="+*page.NextCursor)
	}
	if len(seen) != full.Total || full.Total != 6 {
		t.Fatalf("walked %d of %d", len(seen), full.Total)
	}
	for i, r := range full.Items {
		if seen[i] != r.ParticipationID {
			t.Fatalf("order differs at %d", i)
		}
	}
	first := dashCandidates(t, fx.svc, fx.company, listOwner, raw)
	for _, other := range []string{"in_process=true&on=2026-03-20&limit=2", "in_process=true&on=2026-03-19&sort=candidate&limit=2", "window=7&in_process=true&on=2026-03-19&limit=2"} {
		if _, err := fx.svc.DashboardCandidateList(context.Background(), fx.company, listOwner, other+"&cursor="+*first.NextCursor); !errors.Is(err, ErrInvalidCursor) {
			t.Errorf("%s: %v", other, err)
		}
	}
	if _, err := fx.svc.DashboardCandidateList(context.Background(), fx.company, Viewer{UserID: fx.u}, raw+"&cursor="+*first.NextCursor); !errors.Is(err, ErrInvalidCursor) {
		t.Errorf("scope: %v", err)
	}
	if _, err := fx.svc.DashboardVacancyList(context.Background(), fx.company, listOwner, "cursor="+*first.NextCursor); !errors.Is(err, ErrInvalidCursor) {
		t.Errorf("route: %v", err)
	}
	// A filter error wins over a cursor error.
	_, err := fx.svc.DashboardCandidateList(context.Background(), fx.company, listOwner, "in_process=true&on=2026-01-01&cursor=bad")
	if f := invalidFields(t, err); !reflect.DeepEqual(f, []Field{{"on", "range"}}) {
		t.Fatal(f)
	}
}

func TestDashboardExport_RowsAndFilename(t *testing.T) {
	fx := newHistoryFixture()
	for kind, want := range map[string]int{"candidates": 5, "vacancies": 2, "deliveries": 0, "applications": 3} {
		raw := map[string]string{"candidates": "in_process=true", "vacancies": "status=published", "deliveries": "", "applications": ""}[kind]
		e, err := fx.svc.DashboardExport(context.Background(), fx.company, listOwner, kind, raw)
		if err != nil {
			t.Fatal(kind, err)
		}
		if e.Len() != want || e.Filename != "dashboard-"+kind+"-2026-02-23-2026-03-24.csv" || len(e.Header) == 0 {
			t.Errorf("%s: %d %s", kind, e.Len(), e.Filename)
		}
		for i := 0; i < e.Len(); i++ {
			if len(e.Record(i)) != len(e.Header) {
				t.Errorf("%s row %d", kind, i)
			}
		}
	}
	// Without channel the applications CSV keeps every channel column.
	all, err := fx.svc.DashboardExport(context.Background(), fx.company, listOwner, "applications", "")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(all.Header, applicationHeader) {
		t.Errorf("header %v", all.Header)
	}
	// With channel only the selected channel columns stay, so each row's
	// cells add up to its Total.
	for raw, want := range map[string][]string{
		"channel=portal,careers_site,unknown": {"ID vacante", "Vacante", "Solicitante", "Portal", "Sitio de carreras", "Desconocido", "Total"},
		"channel=manual":                      {"ID vacante", "Vacante", "Solicitante", "Manual", "Total"},
	} {
		e, err := fx.svc.DashboardExport(context.Background(), fx.company, listOwner, "applications", raw)
		if err != nil {
			t.Fatal(raw, err)
		}
		if !slices.Equal(e.Header, want) {
			t.Errorf("%s: header %v, want %v", raw, e.Header, want)
			continue
		}
		for i := 0; i < e.Len(); i++ {
			rec := e.Record(i)
			sum := 0
			for _, cell := range rec[3 : len(rec)-1] {
				n, _ := strconv.Atoi(cell)
				sum += n
			}
			if len(rec) != len(want) || strconv.Itoa(sum) != rec[len(rec)-1] {
				t.Errorf("%s row %d: %v", raw, i, rec)
			}
		}
	}
	if _, err := fx.svc.DashboardExport(context.Background(), fx.company, listOwner, "candidates", "limit=1"); err == nil {
		t.Fatal("export accepted limit")
	}
	fx.svc.WithExportLimit(1)
	var tooLarge *TooLarge
	if _, err := fx.svc.DashboardExport(context.Background(), fx.company, listOwner, "vacancies", ""); !errors.As(err, &tooLarge) || tooLarge.RowCount != 4 {
		t.Fatalf("%v", err)
	}
}
