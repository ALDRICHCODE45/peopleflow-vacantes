package metricsdemo

import "time"

// scenario is the demo year: 31 published vacancies and one draft, about
// twelve months back from today. Historical vacancies are laid out in business
// days from their publication (v.d / v.t); what depends on today (pending and
// overdue commitments, stalled candidates) is laid out from today (b.recent,
// b.pending), and the plan re-checks every designed result for the day it runs.
//
// People: "owner", "stakeholder" and "recruiter" are the three registered
// accounts; mariana, jorge, lucia and diego are fictitious recruiters; valeria
// is a fictitious recruiter who left the company (former member) on b.month(4, 10).
func scenario(b *builder) {
	departure := at(b.month(4, 10), 10, 0)

	// --- closed during the year ---

	// v01: on time, filled before its closing target.
	v := b.vacancy("v01", "Analista de Crédito", "administration_finance", "banorte", b.month(11, 3), "with_responsible")
	v.stay("mariana", "responsible", v.created)
	v.closingTarget(1, ptr(v.d(40)))
	v.deliver(3, v.d(15))
	v.expect("on_time", -1)
	p0 := v.apply("portal", v.t(1, 11)).to("screening", v.t(4, 10), "mariana").to("screening_ok", v.t(7, 12), "mariana").to("in_process", v.t(12, 10), "mariana")
	p1 := v.apply("portal", v.t(2, 11)).to("screening", v.t(5, 10), "mariana").to("screening_ok", v.t(9, 12), "mariana").to("in_process", v.t(14, 10), "mariana")
	v.apply("careers_site", v.t(3, 11)).to("screening", v.t(6, 10), "mariana").to("screening_ok", v.t(12, 16), "mariana")
	v.apply("unknown", v.t(4, 11)).to("screening", v.t(8, 10), "mariana").discard(v.t(10, 10), "mariana", "requirements_not_met")
	v.apply("portal", v.t(5, 11))
	v.intake("mariana", v.t(6, 9)).to("screening", v.t(9, 9), "mariana")
	p1.discard(v.t(20, 10), "mariana", "other_candidate_selected")
	p0.hire(v.t(28, 10), "mariana")
	v.credit(p0, "active", recipient{"mariana", "direct"})
	v.close("filled", "", v.t(30, 17))

	// v02: 4 business days late (3–5 bucket), closed after its target.
	v = b.vacancy("v02", "Ejecutivo de Sucursal", "sales_business_development", "banorte", b.month(11, 10), "with_responsible")
	v.stay("jorge", "responsible", v.created)
	v.closingTarget(1, ptr(v.d(30)))
	v.deliver(2, v.d(10))
	v.expect("late", 4)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(3, 10), "jorge").to("screening_ok", v.t(8, 12), "jorge").to("in_process", v.t(16, 10), "jorge")
	v.apply("careers_site", v.t(2, 11)).to("screening", v.t(5, 10), "jorge").to("screening_ok", v.t(14, 12), "jorge")
	v.apply("portal", v.t(2, 15)).discard(v.t(6, 10), "jorge", "profile_mismatch")
	v.apply("unknown", v.t(3, 11)).to("screening", v.t(7, 10), "jorge")
	v.apply("portal", v.t(4, 11))
	p0.hire(v.t(30, 10), "jorge")
	v.credit(p0, "active", recipient{"jorge", "direct"})
	v.close("filled", "", v.t(33, 17))

	// v03: the registered recruiter with a collaborator who earns a participant credit.
	v = b.vacancy("v03", "Desarrollador Backend Go", "technology_systems", "liverpool", b.month(10, 5), "with_responsible")
	v.seniority = "senior"
	v.stay("recruiter", "responsible", v.created)
	v.stay("lucia", "collaborator", v.created)
	v.closingTarget(1, nil)
	v.deliver(3, v.d(18))
	v.expect("on_time", -1)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(3, 10), "lucia").to("screening_ok", v.t(6, 12), "lucia").to("in_process", v.t(10, 10), "recruiter")
	v.apply("portal", v.t(2, 11)).to("screening", v.t(4, 10), "recruiter").to("screening_ok", v.t(9, 12), "recruiter")
	v.apply("careers_site", v.t(2, 16)).to("screening", v.t(5, 10), "recruiter").to("screening_ok", v.t(15, 12), "recruiter")
	v.apply("careers_site", v.t(3, 11)).to("screening", v.t(6, 10), "recruiter").discard(v.t(8, 10), "recruiter", "salary_expectation")
	p4 := v.apply("portal", v.t(4, 11)).to("screening", v.t(7, 10), "lucia").to("screening_ok", v.t(16, 12), "lucia").to("in_process", v.t(18, 10), "recruiter")
	v.intake("recruiter", v.t(8, 9)).to("screening", v.t(10, 9), "recruiter")
	v.apply("portal", v.t(9, 11))
	p0.hire(v.t(25, 10), "recruiter")
	p4.discard(v.t(26, 10), "recruiter", "other_candidate_selected")
	v.credit(p0, "active", recipient{"recruiter", "direct"}, recipient{"lucia", "participant"})
	v.close("filled", "", v.t(27, 17))

	// v04: 8 business days late (over 5), no closing target.
	v = b.vacancy("v04", "Coordinador de Almacén", "logistics_transport", "bimbo", b.month(10, 15), "with_responsible")
	v.stay("diego", "responsible", v.created)
	v.closingTarget(1, nil)
	v.deliver(2, v.d(10))
	v.expect("late", 8)
	v.intake("diego", v.t(1, 9))
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(4, 10), "diego").to("screening_ok", v.t(7, 12), "diego").to("in_process", v.t(22, 10), "diego")
	v.apply("unknown", v.t(2, 11)).to("screening", v.t(6, 10), "diego").to("screening_ok", v.t(18, 12), "diego")
	v.apply("portal", v.t(3, 11)).discard(v.t(5, 10), "diego", "requirements_not_met")
	v.apply("careers_site", v.t(4, 11)).to("screening", v.t(9, 10), "diego")
	p0.hire(v.t(30, 10), "diego")
	v.credit(p0, "active", recipient{"diego", "direct"})
	v.close("filled", "", v.t(32, 17))

	// v05: the former member's on-time vacancy, filled before its target.
	v = b.vacancy("v05", "Generalista de RR. HH.", "human_resources", "rrhh", b.month(9, 5), "with_responsible")
	v.stay("valeria", "responsible", v.created)
	v.closingTarget(1, ptr(v.d(35)))
	v.deliver(2, v.d(12))
	v.expect("on_time", -1)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(2, 10), "valeria").to("screening_ok", v.t(5, 12), "valeria").to("in_process", v.t(9, 10), "valeria")
	v.apply("careers_site", v.t(1, 15)).to("screening", v.t(3, 10), "valeria").to("screening_ok", v.t(8, 12), "valeria")
	v.apply("portal", v.t(2, 11)).discard(v.t(4, 10), "valeria", "profile_mismatch")
	v.apply("unknown", v.t(3, 11)).to("screening", v.t(6, 10), "valeria")
	p0.hire(v.t(20, 10), "valeria")
	v.credit(p0, "active", recipient{"valeria", "direct"})
	v.close("filled", "", v.t(22, 17))

	// v06: delivered on time, then the client cancelled.
	v = b.vacancy("v06", "Auxiliar Contable", "administration_finance", "banorte", b.month(9, 20), "with_responsible")
	v.stay("valeria", "responsible", v.created)
	v.closingTarget(1, nil)
	v.deliver(2, v.d(12))
	v.expect("on_time", -1)
	v.apply("portal", v.t(1, 11)).to("screening", v.t(3, 10), "valeria").to("screening_ok", v.t(6, 12), "valeria")
	v.apply("portal", v.t(2, 11)).to("screening", v.t(4, 10), "valeria").to("screening_ok", v.t(10, 12), "valeria")
	v.apply("careers_site", v.t(2, 15)).discard(v.t(5, 10), "valeria", "salary_expectation")
	v.intake("valeria", v.t(6, 9)).to("screening", v.t(8, 9), "valeria")
	v.close("cancelled", "", v.t(18, 17))

	// v07: the target candidate reached the cutoff on the Saturday after a
	// Friday commitment: late by 0 business days.
	v = b.vacancy("v07", "Gerente de Tienda", "sales_business_development", "liverpool", b.month(8, 8), "with_responsible")
	v.stay("jorge", "responsible", v.created)
	friday := v.d(12)
	for friday.Weekday() != time.Friday || !isBusinessDay(friday) {
		friday = friday.AddDate(0, 0, 1)
	}
	saturday := friday.AddDate(0, 0, 1)
	v.closingTarget(1, ptr(v.d(45)))
	v.deliver(2, friday)
	v.expect("late", 0)
	v.apply("portal", v.t(1, 11)).to("screening", v.t(3, 10), "jorge").to("screening_ok", v.t(7, 12), "jorge")
	p1 = v.apply("careers_site", v.t(2, 11)).to("screening", v.t(5, 10), "jorge").to("screening_ok", at(saturday, 11, 0), "jorge").
		to("in_process", at(addBusinessDays(saturday, 3), 10, 0), "jorge")
	v.apply("portal", v.t(2, 15)).discard(v.t(4, 10), "jorge", "profile_mismatch")
	v.apply("portal", v.t(3, 11)).to("screening", v.t(6, 10), "jorge")
	v.apply("unknown", v.t(4, 11))
	p1.hire(at(addBusinessDays(saturday, 12), 10, 0), "jorge")
	v.credit(p1, "active", recipient{"jorge", "direct"})
	v.close("filled", "", at(addBusinessDays(saturday, 14), 17, 0))

	// v08: shared team, two shared credits, 2 business days late, closed late.
	v = b.vacancy("v08", "Supervisor de Producción", "operations_production", "bimbo", b.month(8, 12), "shared")
	v.stay("lucia", "member", v.created)
	v.stay("diego", "member", v.created)
	v.closingTarget(2, ptr(v.d(25)))
	v.deliver(3, v.d(10))
	v.expect("late", 2)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(2, 10), "lucia").to("screening_ok", v.t(5, 12), "lucia").to("in_process", v.t(9, 10), "lucia")
	p1 = v.apply("portal", v.t(1, 15)).to("screening", v.t(3, 10), "diego").to("screening_ok", v.t(8, 12), "diego").to("in_process", v.t(11, 10), "diego")
	v.apply("careers_site", v.t(2, 11)).to("screening", v.t(4, 10), "lucia").to("screening_ok", v.t(12, 12), "lucia")
	v.intake("diego", v.t(2, 16)).discard(v.t(6, 10), "diego", "requirements_not_met")
	v.apply("unknown", v.t(3, 11)).to("screening", v.t(6, 11), "lucia")
	v.apply("portal", v.t(4, 11)).discard(v.t(7, 10), "diego", "profile_mismatch")
	v.apply("careers_site", v.t(5, 11))
	p0.hire(v.t(20, 10), "lucia")
	p1.hire(v.t(22, 10), "diego")
	v.credit(p0, "active", recipient{"lucia", "shared"}, recipient{"diego", "shared"})
	v.credit(p1, "active", recipient{"lucia", "shared"}, recipient{"diego", "shared"})
	v.close("filled", "", v.t(28, 17))

	// v09: reassigned for workload to the registered recruiter, who delivers on time.
	v = b.vacancy("v09", "Analista de Datos", "technology_systems", "liverpool", b.month(7, 6), "with_responsible")
	v.stay("mariana", "responsible", v.created)
	v.closingTarget(1, nil)
	v.deliver(2, v.d(15))
	v.expect("on_time", -1)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(3, 10), "mariana")
	p1 = v.apply("careers_site", v.t(2, 11)).to("screening", v.t(4, 10), "mariana")
	v.apply("portal", v.t(2, 15)).discard(v.t(5, 10), "mariana", "requirements_not_met")
	v.apply("unknown", v.t(3, 11))
	v.reassign("mariana", "recruiter", "workload", "", v.t(8, 10), false)
	p0.to("screening_ok", v.t(10, 12), "recruiter").to("in_process", v.t(14, 10), "recruiter")
	p1.to("screening_ok", v.t(12, 12), "recruiter")
	v.apply("careers_site", v.t(9, 11)).to("screening", v.t(11, 10), "recruiter")
	p0.hire(v.t(24, 10), "recruiter")
	v.credit(p0, "active", recipient{"recruiter", "direct"})
	v.close("filled", "", v.t(26, 17))

	// v10: no delivery configuration; closed for another reason.
	v = b.vacancy("v10", "Especialista en Nómina", "human_resources", "rrhh", b.month(7, 14), "with_responsible")
	v.stay("recruiter", "responsible", v.created)
	v.closingTarget(1, nil)
	v.expect("not_configured", -1)
	v.apply("portal", v.t(1, 11)).to("screening", v.t(3, 10), "recruiter")
	v.apply("careers_site", v.t(2, 11)).discard(v.t(4, 10), "recruiter", "profile_mismatch")
	v.intake("recruiter", v.t(5, 9))
	v.close("other", "Se cubrió con una promoción interna", v.t(20, 17))

	// v11: 2 of 4 delivered when the commitment passed; cancelled.
	v = b.vacancy("v11", "Chofer Repartidor", "logistics_transport", "bimbo", b.month(6, 4), "with_responsible")
	v.stay("diego", "responsible", v.created)
	v.closingTarget(4, nil)
	v.deliver(4, v.d(10))
	v.expect("overdue", -1)
	v.apply("portal", v.t(1, 11)).to("screening", v.t(2, 10), "diego").to("screening_ok", v.t(5, 12), "diego")
	v.apply("portal", v.t(1, 15)).to("screening", v.t(3, 10), "diego").to("screening_ok", v.t(9, 12), "diego")
	v.apply("unknown", v.t(2, 11)).discard(v.t(4, 10), "diego", "requirements_not_met")
	v.apply("careers_site", v.t(3, 11)).to("screening", v.t(6, 10), "diego")
	v.apply("portal", v.t(4, 11))
	v.close("cancelled", "", v.t(22, 17))

	// v12: closed (other) → reopened → closed filled after its moved target;
	// the first hire did not hold.
	v = b.vacancy("v12", "Asesor Hipotecario", "sales_business_development", "banorte", b.month(6, 11), "with_responsible")
	v.stay("jorge", "responsible", v.created)
	v.closingTarget(1, ptr(v.d(30)))
	v.deliver(2, v.d(12))
	v.expect("on_time", -1)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(2, 10), "jorge").to("screening_ok", v.t(5, 12), "jorge")
	p1 = v.apply("careers_site", v.t(1, 15)).to("screening", v.t(3, 10), "jorge").to("screening_ok", v.t(8, 12), "jorge")
	v.apply("portal", v.t(2, 11)).discard(v.t(4, 10), "jorge", "salary_expectation")
	v.intake("jorge", v.t(6, 9)).to("screening", v.t(7, 9), "jorge")
	v.apply("portal", v.t(7, 11))
	v.apply("unknown", v.t(8, 11)).to("screening", v.t(9, 10), "jorge")
	v.close("other", "El cliente pausó la contratación", v.t(10, 17))
	v.reopen(v.t(14, 10))
	v.moveTarget(v.d(35), v.t(14, 11))
	p0.to("in_process", v.t(16, 10), "jorge").hire(v.t(20, 10), "jorge").leave(v.t(26, 10), "jorge")
	p1.to("in_process", v.t(18, 10), "jorge").hire(v.t(33, 10), "jorge")
	v.credit(p0, "did_not_hold", recipient{"jorge", "direct"})
	v.credit(p1, "active", recipient{"jorge", "direct"})
	v.close("filled", "", v.t(40, 17))

	// v13: reassigned for performance (kept as collaborator), commitment
	// renegotiated, on time against the new date.
	v = b.vacancy("v13", "Diseñador UX", "design_creative", "liverpool", b.month(5, 5), "with_responsible")
	v.stay("mariana", "responsible", v.created)
	v.closingTarget(1, nil)
	v.deliver(2, v.d(16))
	v.expect("on_time", -1)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(3, 10), "mariana")
	p1 = v.apply("careers_site", v.t(2, 11)).to("screening", v.t(4, 10), "mariana")
	v.apply("careers_site", v.t(2, 15)).discard(v.t(5, 10), "mariana", "profile_mismatch")
	v.reassign("mariana", "recruiter", "performance", "", v.t(6, 10), true)
	v.apply("portal", v.t(6, 11)).to("screening", v.t(7, 10), "recruiter")
	v.renegotiate(v.d(10), v.t(8, 12))
	v.intake("recruiter", v.t(8, 15))
	p0.to("screening_ok", v.t(9, 12), "mariana").to("in_process", v.t(15, 10), "recruiter")
	p1.to("screening_ok", v.t(14, 12), "mariana")
	p0.hire(v.t(24, 10), "recruiter")
	v.credit(p0, "active", recipient{"recruiter", "direct"}, recipient{"mariana", "participant"})
	v.close("filled", "", v.t(26, 17))

	// v14: no requester; overdue, closed with a legacy close without reason.
	v = b.vacancy("v14", "Operador de Montacargas", "logistics_transport", "", b.month(5, 12), "with_responsible")
	v.stay("lucia", "responsible", v.created)
	v.closingTarget(1, nil)
	v.deliver(3, v.d(12))
	v.expect("overdue", -1)
	v.apply("portal", v.t(1, 11)).to("screening", v.t(3, 10), "lucia").to("screening_ok", v.t(6, 12), "lucia")
	v.apply("unknown", v.t(2, 11)).discard(v.t(4, 10), "lucia", "requirements_not_met")
	v.apply("portal", v.t(3, 11)).to("screening", v.t(7, 10), "lucia")
	v.apply("careers_site", v.t(4, 11))
	v.close("", "", v.t(25, 17))

	// v15: the former member leaves (recruiter_departure); jorge delivers and fills.
	v = b.vacancy("v15", "Ejecutivo de Cobranza", "administration_finance", "banorte", b.month(5, 20), "with_responsible")
	v.stay("valeria", "responsible", v.created)
	v.closingTarget(1, nil)
	v.deliver(2, civil(departure.AddDate(0, 0, 14)))
	v.expect("on_time", -1)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(3, 10), "valeria")
	p1 = v.apply("portal", v.t(2, 11)).to("screening", v.t(4, 10), "valeria")
	v.apply("careers_site", v.t(2, 15)).discard(v.t(5, 10), "valeria", "profile_mismatch")
	v.apply("unknown", v.t(3, 11))
	v.reassign("valeria", "jorge", "recruiter_departure", "", departure, false)
	dep := civil(departure)
	p0.to("screening_ok", at(addBusinessDays(dep, 3), 12, 0), "jorge").to("in_process", at(addBusinessDays(dep, 8), 10, 0), "jorge")
	p1.to("screening_ok", at(addBusinessDays(dep, 6), 12, 0), "jorge")
	p0.hire(at(addBusinessDays(dep, 15), 10, 0), "jorge")
	v.credit(p0, "active", recipient{"jorge", "direct"})
	v.close("filled", "", at(addBusinessDays(dep, 17), 17, 0))

	// v17: reassigned at the client's request; on time, filled before target.
	v = b.vacancy("v17", "Analista de Riesgos", "administration_finance", "banorte", b.month(4, 3), "with_responsible")
	v.stay("mariana", "responsible", v.created)
	v.closingTarget(1, ptr(v.d(40)))
	v.deliver(2, v.d(14))
	v.expect("on_time", -1)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(2, 10), "mariana")
	p1 = v.apply("portal", v.t(1, 15)).to("screening", v.t(3, 10), "mariana")
	v.apply("careers_site", v.t(2, 11)).discard(v.t(4, 10), "mariana", "salary_expectation")
	v.reassign("mariana", "jorge", "client_request", "", v.t(5, 10), false)
	v.intake("jorge", v.t(6, 9))
	v.apply("unknown", v.t(6, 11))
	p0.to("screening_ok", v.t(7, 12), "jorge").to("in_process", v.t(10, 10), "jorge")
	p1.to("screening_ok", v.t(12, 12), "jorge")
	p0.hire(v.t(20, 10), "jorge")
	v.credit(p0, "active", recipient{"jorge", "direct"})
	v.close("filled", "", v.t(22, 17))

	// v18: reassigned for another reason; 6 business days late; cancelled.
	v = b.vacancy("v18", "Community Manager", "marketing_communications", "liverpool", b.month(4, 14), "with_responsible")
	v.stay("lucia", "responsible", v.created)
	v.closingTarget(1, nil)
	v.deliver(2, v.d(8))
	v.expect("late", 6)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(2, 10), "lucia")
	v.apply("portal", v.t(1, 15)).discard(v.t(3, 10), "lucia", "profile_mismatch")
	v.reassign("lucia", "diego", "other", "Cambio de prioridades en el equipo", v.t(4, 10), false)
	p1 = v.apply("careers_site", v.t(4, 11)).to("screening", v.t(5, 10), "diego")
	v.apply("unknown", v.t(5, 11))
	p0.to("screening_ok", v.t(6, 12), "diego")
	p1.to("screening_ok", v.t(14, 12), "diego")
	v.close("cancelled", "", v.t(20, 17))

	// v19: «cliente sin especificar», no delivery configuration, filled.
	v = b.vacancy("v19", "Jefe de Turno", "operations_production", "client?", b.month(3, 6), "with_responsible")
	v.stay("diego", "responsible", v.created)
	v.closingTarget(1, nil)
	v.expect("not_configured", -1)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(2, 10), "diego").to("screening_ok", v.t(4, 12), "diego").to("in_process", v.t(6, 10), "diego")
	v.apply("portal", v.t(1, 15)).discard(v.t(3, 10), "diego", "requirements_not_met")
	v.apply("careers_site", v.t(2, 11)).to("screening", v.t(5, 10), "diego")
	v.intake("diego", v.t(4, 9))
	p0.hire(v.t(12, 10), "diego")
	v.credit(p0, "active", recipient{"diego", "direct"})
	v.close("filled", "", v.t(14, 17))

	// v20: no requester, the owner recruits it; on time, filled before target.
	v = b.vacancy("v20", "Contador Senior", "administration_finance", "", b.month(3, 18), "with_responsible")
	v.seniority = "senior"
	v.stay("owner", "responsible", v.created)
	v.closingTarget(1, ptr(v.d(30)))
	v.deliver(1, v.d(10))
	v.expect("on_time", -1)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(2, 10), "owner").to("screening_ok", v.t(5, 12), "owner").to("in_process", v.t(8, 10), "owner")
	v.apply("careers_site", v.t(2, 11)).to("screening", v.t(3, 10), "owner")
	v.intake("owner", v.t(3, 9))
	v.apply("unknown", v.t(3, 11)).discard(v.t(4, 10), "owner", "profile_mismatch")
	p0.hire(v.t(15, 10), "owner")
	v.credit(p0, "active", recipient{"owner", "direct"})
	v.close("filled", "", v.t(18, 17))

	// v29: 1 business day late, filled after its target.
	v = b.vacancy("v29", "Técnico de Mantenimiento", "construction_maintenance", "bimbo", b.month(2, 3), "with_responsible")
	v.stay("lucia", "responsible", v.created)
	v.closingTarget(1, ptr(v.d(12)))
	v.deliver(2, v.d(6))
	v.expect("late", 1)
	p0 = v.apply("portal", v.t(0, 11)).to("screening", v.t(1, 10), "lucia").to("screening_ok", v.t(3, 12), "lucia").to("in_process", v.t(5, 10), "lucia")
	v.apply("careers_site", v.t(1, 11)).to("screening", v.t(2, 10), "lucia").to("screening_ok", v.t(7, 12), "lucia")
	v.intake("lucia", v.t(2, 9)).discard(v.t(4, 10), "lucia", "salary_expectation")
	v.apply("portal", v.t(3, 11))
	p0.hire(v.t(10, 10), "lucia")
	v.credit(p0, "active", recipient{"lucia", "direct"})
	v.close("filled", "", v.t(14, 17))

	// v30: no delivery configuration; cancelled recently.
	v = b.vacancy("v30", "Auditor Interno", "administration_finance", "rrhh", b.month(1, 1), "with_responsible")
	v.stay("jorge", "responsible", v.created)
	v.closingTarget(1, nil)
	v.expect("not_configured", -1)
	v.apply("portal", v.t(0, 11)).to("screening", v.t(1, 10), "jorge")
	v.apply("careers_site", v.t(1, 11))
	v.close("cancelled", "", at(b.recent(1), 17, 0))

	// v31: on time, filled before its target.
	v = b.vacancy("v31", "Gerente de Producto Digital", "product", "liverpool", b.month(3, 1), "with_responsible")
	v.seniority = "senior"
	v.stay("recruiter", "responsible", v.created)
	v.closingTarget(1, ptr(v.d(30)))
	v.deliver(2, v.d(12))
	v.expect("on_time", -1)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(2, 10), "recruiter").to("screening_ok", v.t(5, 12), "recruiter").to("in_process", v.t(8, 10), "recruiter")
	v.apply("careers_site", v.t(1, 15)).to("screening", v.t(3, 10), "recruiter").to("screening_ok", v.t(10, 12), "recruiter")
	v.intake("recruiter", v.t(4, 9)).to("screening", v.t(6, 9), "recruiter")
	v.apply("portal", v.t(4, 11)).discard(v.t(5, 10), "recruiter", "requirements_not_met")
	p0.hire(v.t(16, 10), "recruiter")
	v.credit(p0, "active", recipient{"recruiter", "direct"})
	v.close("filled", "", v.t(18, 17))

	// --- open today (the pipeline) ---

	// v16: the former member leaves; the registered recruiter inherits an
	// overdue delivery with stalled candidates.
	v = b.vacancy("v16", "Reclutador TI", "human_resources", "rrhh", b.month(6, 18), "with_responsible")
	v.stay("valeria", "responsible", v.created)
	v.closingTarget(1, nil)
	v.deliver(3, b.month(3, 15))
	v.expect("overdue", -1)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(3, 10), "valeria").to("screening_ok", v.t(8, 12), "valeria")
	p1 = v.apply("careers_site", v.t(2, 11)).to("screening", v.t(5, 10), "valeria")
	v.apply("unknown", v.t(6, 11)).expectStalled(true)
	v.reassign("valeria", "recruiter", "recruiter_departure", "", departure.Add(time.Minute), false)
	p0.to("in_process", at(addBusinessDays(dep, 2), 10, 0), "recruiter").expectStalled(true)
	p1.discard(at(addBusinessDays(dep, 1), 10, 0), "recruiter", "profile_mismatch")
	v.apply("portal", at(b.recent(2), 11, 0)).expectStalled(false)
	v.intake("recruiter", at(b.recent(9), 9, 0)).to("screening", at(b.recent(8), 10, 0), "recruiter").expectStalled(true)

	// v21: stored pipeline with a custom and a retired stage, a hire in an
	// open vacancy, every stage kind occupied.
	v = b.vacancy("v21", "Ingeniero DevOps", "technology_systems", "liverpool", b.month(2, 5), "with_responsible")
	v.seniority = "senior"
	v.customPipeline("Entrevista con cliente", "Prueba técnica (anterior)")
	v.stay("recruiter", "responsible", v.created)
	v.stay("lucia", "collaborator", v.created)
	v.closingTarget(2, nil)
	v.deliver(3, v.d(15))
	v.expect("on_time", -1)
	v.apply("portal", v.t(1, 11)).to("screening", v.t(2, 10), "recruiter").to("screening_ok", v.t(4, 12), "lucia").
		to("in_process", v.t(6, 10), "recruiter").to("custom", v.t(9, 10), "recruiter").expectStalled(true)
	p1 = v.apply("careers_site", v.t(1, 15)).to("screening", v.t(3, 10), "lucia").to("screening_ok", v.t(7, 12), "lucia").to("in_process", v.t(10, 10), "recruiter")
	v.apply("portal", v.t(2, 11)).to("screening", v.t(3, 11), "recruiter").to("screening_ok", v.t(12, 12), "recruiter").
		to("retired", v.t(13, 10), "recruiter").expectStalled(true)
	v.apply("unknown", v.t(5, 11)).discard(v.t(8, 10), "lucia", "requirements_not_met")
	p1.hire(v.t(14, 10), "recruiter").expectStalled(false)
	v.credit(p1, "active", recipient{"recruiter", "direct"}, recipient{"lucia", "participant"})
	v.intake("lucia", at(b.recent(12), 9, 0)).to("screening", at(b.recent(3), 10, 0), "lucia").expectStalled(false)
	v.apply("careers_site", at(b.recent(4), 11, 0)).to("screening", at(b.recent(2), 10, 0), "lucia").
		to("screening_ok", at(b.recent(1), 12, 0), "recruiter").expectStalled(false)
	v.apply("portal", at(b.recent(1), 15, 0)).expectStalled(false)

	// v22: pending, commitment renegotiated; one stalled in screening.
	v = b.vacancy("v22", "Cajero Universal", "customer_service_support", "banorte", b.month(1, 3), "with_responsible")
	v.stay("jorge", "responsible", v.created)
	v.closingTarget(4, nil)
	v.deliver(4, b.pending(5))
	v.expect("pending", -1)
	v.renegotiate(v.d(10), at(b.recent(2), 13, 0))
	v.apply("portal", v.t(1, 11)).to("screening", v.t(3, 10), "jorge").to("screening_ok", v.t(5, 12), "jorge").expectStalled(true)
	v.apply("portal", v.t(2, 11)).to("screening", at(b.recent(9), 10, 0), "jorge").expectStalled(true)
	v.apply("careers_site", at(b.recent(3), 11, 0)).expectStalled(false)
	v.intake("jorge", at(b.recent(5), 9, 0)).to("screening_ok", at(b.recent(2), 12, 0), "jorge").expectStalled(false)

	// v23: overdue this month with one delivered; stalled in process.
	v = b.vacancy("v23", "Analista de Compras", "administration_finance", "bimbo", b.month(1, 10), "with_responsible")
	v.stay("diego", "responsible", v.created)
	v.closingTarget(1, nil)
	v.deliver(2, b.recent(4))
	v.expect("overdue", -1)
	v.apply("portal", v.t(0, 11)).to("screening", v.t(1, 10), "diego").to("screening_ok", v.t(2, 12), "diego").
		to("in_process", at(b.recent(10), 10, 0), "diego").expectStalled(true)
	v.apply("portal", v.t(1, 11)).discard(v.t(3, 10), "diego", "profile_mismatch")
	v.apply("careers_site", at(b.recent(2), 11, 0)).expectStalled(false)

	// v24: recently published, commitment today (pending).
	v = b.vacancy("v24", "Psicólogo Organizacional", "human_resources", "rrhh", b.recent(18), "with_responsible")
	v.stay("recruiter", "responsible", v.created)
	v.closingTarget(1, nil)
	v.deliver(2, b.today)
	v.expect("pending", -1)
	v.apply("portal", at(b.recent(15), 11, 0)).to("screening", at(b.recent(10), 10, 0), "recruiter").expectStalled(true)
	v.apply("careers_site", at(b.recent(12), 11, 0)).discard(at(b.recent(11), 10, 0), "recruiter", "requirements_not_met")
	v.apply("careers_site", at(b.recent(6), 11, 0)).expectStalled(false)
	v.intake("recruiter", at(b.recent(2), 9, 0)).expectStalled(false)
	v.apply("portal", at(b.recent(1), 11, 0)).expectStalled(false)

	// v25: shared team, no delivery configuration, a shared hire while open.
	v = b.vacancy("v25", "Promotor de Ventas", "sales_business_development", "bimbo", b.month(2, 15), "shared")
	v.stay("lucia", "member", v.created)
	v.stay("diego", "member", v.created)
	v.closingTarget(3, nil)
	v.expect("not_configured", -1)
	p0 = v.apply("portal", v.t(1, 11)).to("screening", v.t(2, 10), "lucia").to("screening_ok", v.t(4, 12), "lucia").to("in_process", v.t(6, 10), "diego")
	v.apply("careers_site", v.t(1, 15)).to("screening", v.t(3, 10), "diego").to("screening_ok", v.t(6, 12), "diego").
		to("in_process", v.t(8, 10), "diego").expectStalled(true)
	v.apply("portal", v.t(4, 11)).expectStalled(true)
	v.apply("portal", v.t(5, 11)).discard(v.t(7, 10), "lucia", "profile_mismatch")
	p0.hire(v.t(9, 10), "lucia").expectStalled(false)
	v.credit(p0, "active", recipient{"lucia", "shared"}, recipient{"diego", "shared"})
	v.intake("diego", at(b.recent(3), 9, 0)).expectStalled(false)

	// v26: paused, overdue, stalled candidates.
	v = b.vacancy("v26", "Desarrollador Frontend", "technology_systems", "liverpool", b.month(2, 1), "with_responsible")
	v.stay("recruiter", "responsible", v.created)
	v.closingTarget(1, nil)
	v.deliver(2, v.d(8))
	v.expect("overdue", -1)
	v.apply("portal", v.t(1, 11)).to("screening", v.t(2, 10), "recruiter").to("screening_ok", v.t(5, 12), "recruiter").
		to("in_process", v.t(9, 10), "recruiter").expectStalled(true)
	v.apply("careers_site", v.t(1, 15)).to("screening", v.t(3, 10), "recruiter").expectStalled(true)
	v.apply("portal", v.t(4, 11)).discard(v.t(6, 10), "recruiter", "salary_expectation")
	v.pause(at(b.recent(4), 16, 0))

	// v27: recently published, pending, one delivered.
	v = b.vacancy("v27", "Oficial de Cumplimiento", "legal", "banorte", b.recent(15), "with_responsible")
	v.stay("mariana", "responsible", v.created)
	v.closingTarget(1, nil)
	v.deliver(2, b.pending(8))
	v.expect("pending", -1)
	v.apply("portal", at(b.recent(13), 11, 0)).to("screening", at(b.recent(3), 10, 0), "mariana").expectStalled(false)
	v.apply("careers_site", at(b.recent(9), 11, 0)).expectStalled(true)
	v.intake("mariana", at(b.recent(5), 9, 0)).to("screening_ok", at(b.recent(1), 12, 0), "mariana").expectStalled(false)

	// v28: no requester, the owner recruits it, no delivery configuration.
	v = b.vacancy("v28", "Asistente de Dirección", "administration_finance", "", b.recent(20), "with_responsible")
	v.seniority = "junior"
	v.stay("owner", "responsible", v.created)
	v.closingTarget(1, nil)
	v.expect("not_configured", -1)
	v.apply("portal", at(b.recent(17), 11, 0)).expectStalled(true)
	v.apply("portal", at(b.recent(8), 11, 0)).discard(at(b.recent(7), 10, 0), "owner", "profile_mismatch")
	v.apply("careers_site", at(b.recent(2), 11, 0)).to("screening", at(b.recent(1), 10, 0), "owner").expectStalled(false)

	// v32: a draft never published: outside every metric.
	v = b.draftOnly("v32", "Becario de Marketing", "marketing_communications", "", b.recent(5))
	v.seniority = "intern"
	v.stay("recruiter", "responsible", v.created)
	v.closingTarget(1, nil)

	// The former member's membership ended right after her reassignments:
	// every tramo she still held ends with it.
	b.offboard(formerMember, departure.Add(5*time.Minute))
}

func ptr[T any](v T) *T { return &v }
