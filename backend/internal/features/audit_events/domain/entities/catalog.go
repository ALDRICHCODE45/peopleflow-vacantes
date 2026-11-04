package entities

import (
	"errors"
	"fmt"
	"sort"
)

// Category groups event types for the audit screen filter (audit-log-v1 §8.2).
// The set is closed and ordered.
type Category string

const (
	CategorySession       Category = "session"
	CategorySensitiveRead Category = "sensitive_read"
	CategoryCandidate     Category = "candidate"
	CategoryVacancy       Category = "vacancy"
	CategoryPipeline      Category = "pipeline"
	CategoryTeam          Category = "team"
	CategoryCompany       Category = "company"
	CategoryMembers       Category = "members"
	CategoryAudit         Category = "audit"
)

// Categories returns the closed category vocabulary in display order.
func Categories() []Category {
	return []Category{
		CategorySession, CategorySensitiveRead, CategoryCandidate, CategoryVacancy, CategoryPipeline,
		CategoryTeam, CategoryCompany, CategoryMembers, CategoryAudit,
	}
}

// Event-type constants: the ONE catalog of audit event types (audit-log-v1
// §1, §8.2). event_type has no DB CHECK, so the closure is enforced here by
// Validate (called by the Append adapter) and by the catalog tests. Emitters
// reference these constants, never string literals.
const (
	// Session (audit-log-v1 §3).
	EventSessionStarted = "SessionStarted"
	EventSessionEnded   = "SessionEnded"

	// Sensitive reads (§2).
	EventCompanyCandidateViewed           = "CompanyCandidateViewed"
	EventCompanyCandidateCVDownloaded     = "CompanyCandidateCVDownloaded"
	EventCompanyCandidateContactsRevealed = "CompanyCandidateContactsRevealed"
	EventParticipationViewed              = "ParticipationViewed"
	EventParticipationCVDownloaded        = "ParticipationCVDownloaded"
	EventPsychometricResultViewed         = "PsychometricResultViewed"

	// Candidate.
	EventCandidateAccountCreated        = "CandidateAccountCreated"
	EventCompanyCandidateEdited         = "CompanyCandidateEdited"
	EventCompanyCandidateCVCorrected    = "CompanyCandidateCVCorrected"
	EventVacancyCandidateAddedManually  = "VacancyCandidateAddedManually"
	EventVacancyApplicationSubmitted    = "VacancyApplicationSubmitted"
	EventApplicationSubmitted           = "ApplicationSubmitted"
	EventApplicationTransitioned        = "ApplicationTransitioned"
	EventPsychometricInvitationCreated  = "PsychometricInvitationCreated"
	EventPsychometricInvitationRevoked  = "PsychometricInvitationRevoked"
	EventPsychometricReminderRecorded   = "PsychometricReminderRecorded"
	EventPsychometricLinkIssued         = "PsychometricLinkIssued"
	EventPsychometricConsentGiven       = "PsychometricConsentGiven"
	EventPsychometricAssessmentFinished = "PsychometricAssessmentFinished"
	EventPsychometricComparisonCreated  = "PsychometricComparisonCreated"

	// Vacancy. EventJobDraftCreated / EventJobDraftSaved are the private
	// vacancy draft persistence events, emitted by the draftstore adapter
	// inside the draft write transaction. EventJobDraftRequesterCreated records
	// one immutable requester catalog entry. The lifecycle events are
	// co-written with state and vacancy-level history.
	EventJobDraftCreated                       = "JobDraftCreated"
	EventJobDraftSaved                         = "JobDraftSaved"
	EventJobDraftRequesterCreated              = "JobDraftRequesterCreated"
	EventJobDraftManagementConfigured          = "JobDraftManagementConfigured"
	EventJobDraftDeliveryConfigured            = "JobDraftDeliveryConfigured"
	EventJobDraftChecklistConfigured           = "JobDraftChecklistConfigured"
	EventJobDraftPsychometricProfileConfigured = "JobDraftPsychometricProfileConfigured"
	EventVacancyPublished                      = "VacancyPublished"
	EventVacancyPaused                         = "VacancyPaused"
	EventVacancyResumed                        = "VacancyResumed"
	EventVacancyClosed                         = "VacancyClosed"
	EventVacancyProcessFinished                = "VacancyProcessFinished"
	EventVacancyReopened                       = "VacancyReopened"
	EventVacancyCommitmentRenegotiated         = "VacancyCommitmentRenegotiated"
	EventVacancyDeliveryFulfilled              = "VacancyDeliveryFulfilled"
	EventVacancyPlacementCredited              = "VacancyPlacementCredited"
	EventVacancyPlacementCreditChanged         = "VacancyPlacementCreditChanged"

	// Pipeline.
	EventJobDraftPipelineConfigured   = "JobDraftPipelineConfigured"
	EventJobDraftSubstatesConfigured  = "JobDraftSubstatesConfigured"
	EventParticipationMoved           = "ParticipationMoved"
	EventParticipationDiscarded       = "ParticipationDiscarded"
	EventParticipationRecovered       = "ParticipationRecovered"
	EventParticipationSubstateChanged = "ParticipationSubstateChanged"
	EventParticipationChecklistMarked = "ParticipationChecklistMarked"

	// Team.
	EventVacancyTeamCreated                 = "VacancyTeamCreated"
	EventVacancyTeamModeChanged             = "VacancyTeamModeChanged"
	EventVacancyTeamMemberAdded             = "VacancyTeamMemberAdded"
	EventVacancyTeamMemberRemoved           = "VacancyTeamMemberRemoved"
	EventVacancyTeamMemberLeft              = "VacancyTeamMemberLeft"
	EventVacancyResponsibleReassigned       = "VacancyResponsibleReassigned"
	EventVacancyAssignmentDeadlineChanged   = "VacancyAssignmentDeadlineChanged"
	EventVacancyAssignmentEndedByMembership = "VacancyAssignmentEndedByMembership"

	// Company.
	EventCompanyUpdated              = "CompanyUpdated"
	EventCompanyDeleted              = "CompanyDeleted"
	EventCompanySitePublished        = "CompanySitePublished"
	EventCompanySiteUnpublished      = "CompanySiteUnpublished"
	EventTalentBaseVisibilityChanged = "TalentBaseVisibilityChanged"

	// Members (§5).
	EventCompanyMemberAdded       = "CompanyMemberAdded"
	EventCompanyMemberRoleChanged = "CompanyMemberRoleChanged"
	EventCompanyMemberOffboarded  = "CompanyMemberOffboarded"

	// Audit (§8.5).
	EventAuditLogExported = "AuditLogExported"
)

// EventSpec is one catalog entry: the category shown on the audit screen,
// whether the event belongs to a company (CompanyID required), and the closed
// set of metadata keys the event may carry. Metadata holds IDs, enums, counts
// and dates only (audit-log-v1 §7).
type EventSpec struct {
	Type          string
	Category      Category
	CompanyScoped bool
	MetadataKeys  []string
}

var (
	// ErrUnknownEventType: the event type is not in the catalog.
	ErrUnknownEventType = errors.New("audit event type is not in the catalog")
	// ErrCompanyRequired: a company-scoped event type was appended without a company.
	ErrCompanyRequired = errors.New("audit event requires a company id")
	// ErrMetadataKeyNotAllowed: a metadata key is outside the type's closed set.
	ErrMetadataKeyNotAllowed = errors.New("audit event metadata key is not allowed")
)

func spec(eventType string, category Category, keys ...string) EventSpec {
	return EventSpec{Type: eventType, Category: category, CompanyScoped: true, MetadataKeys: keys}
}

// catalog is ordered by category (the closed Categories order), then by the
// order an operator would expect to read it.
var catalog = []EventSpec{
	// session
	spec(EventSessionStarted, CategorySession),
	spec(EventSessionEnded, CategorySession),

	// sensitive_read
	spec(EventCompanyCandidateViewed, CategorySensitiveRead, "kind"),
	spec(EventCompanyCandidateCVDownloaded, CategorySensitiveRead, "kind", "participation_id", "variant"),
	spec(EventCompanyCandidateContactsRevealed, CategorySensitiveRead, "count", "candidates"),
	spec(EventParticipationViewed, CategorySensitiveRead),
	spec(EventParticipationCVDownloaded, CategorySensitiveRead, "variant"),
	spec(EventPsychometricResultViewed, CategorySensitiveRead, "vacancy_id", "participation_id"),

	// candidate
	{Type: EventCandidateAccountCreated, Category: CategoryCandidate, CompanyScoped: false},
	spec(EventCompanyCandidateEdited, CategoryCandidate, "fields"),
	spec(EventCompanyCandidateCVCorrected, CategoryCandidate, "participation_id"),
	spec(EventVacancyCandidateAddedManually, CategoryCandidate, "vacancy_id", "stage_id", "candidate_id", "cv_id"),
	spec(EventVacancyApplicationSubmitted, CategoryCandidate, "vacancy_id", "stage_id", "source"),
	spec(EventApplicationSubmitted, CategoryCandidate, "job_id", "source"),
	spec(EventApplicationTransitioned, CategoryCandidate, "job_id", "from_status", "to_status"),
	spec(EventPsychometricInvitationCreated, CategoryCandidate, "vacancy_id", "participation_id"),
	spec(EventPsychometricInvitationRevoked, CategoryCandidate, "vacancy_id", "participation_id"),
	spec(EventPsychometricReminderRecorded, CategoryCandidate, "vacancy_id", "participation_id"),
	spec(EventPsychometricLinkIssued, CategoryCandidate, "vacancy_id", "participation_id"),
	spec(EventPsychometricConsentGiven, CategoryCandidate, "vacancy_id", "participation_id"),
	spec(EventPsychometricAssessmentFinished, CategoryCandidate, "vacancy_id", "participation_id"),
	spec(EventPsychometricComparisonCreated, CategoryCandidate, "vacancy_id", "participation_id", "comparison_id", "profile_version"),

	// vacancy
	spec(EventJobDraftCreated, CategoryVacancy, "version"),
	spec(EventJobDraftSaved, CategoryVacancy, "version"),
	spec(EventJobDraftRequesterCreated, CategoryVacancy, "kind"),
	spec(EventJobDraftManagementConfigured, CategoryVacancy, "version", "previous", "new"),
	spec(EventJobDraftDeliveryConfigured, CategoryVacancy, "version", "previous", "new"),
	spec(EventJobDraftChecklistConfigured, CategoryVacancy, "version", "previous", "new"),
	spec(EventJobDraftPsychometricProfileConfigured, CategoryVacancy, "version", "previous", "new"),
	spec(EventVacancyPublished, CategoryVacancy, "version", "publishedAt", "snapshot"),
	spec(EventVacancyPaused, CategoryVacancy, "version", "publication", "process", "reason"),
	spec(EventVacancyResumed, CategoryVacancy, "version", "publication", "process", "reason"),
	spec(EventVacancyClosed, CategoryVacancy, "version", "publication", "process", "reason"),
	spec(EventVacancyProcessFinished, CategoryVacancy, "version", "publication", "process", "reason"),
	spec(EventVacancyReopened, CategoryVacancy, "version", "publication", "process", "reason"),
	spec(EventVacancyCommitmentRenegotiated, CategoryVacancy, "company_id", "change_id", "previous_date", "new_date", "reason"),
	spec(EventVacancyDeliveryFulfilled, CategoryVacancy, "vacancy_id", "snapshot"),
	spec(EventVacancyPlacementCredited, CategoryVacancy, "company_id", "vacancy_id", "credit_id", "team_mode", "hired_by", "recipients"),
	spec(EventVacancyPlacementCreditChanged, CategoryVacancy, "company_id", "vacancy_id", "credit_id", "from_status", "to_status", "cause"),

	// pipeline
	spec(EventJobDraftPipelineConfigured, CategoryPipeline, "version", "previous", "new", "applied_impact"),
	spec(EventJobDraftSubstatesConfigured, CategoryPipeline, "version", "previous", "new"),
	spec(EventParticipationMoved, CategoryPipeline, "vacancy_id", "from_stage_id", "to_stage_id", "version", "hire", "departure"),
	spec(EventParticipationDiscarded, CategoryPipeline, "vacancy_id", "from_stage_id", "to_stage_id", "version", "hire", "departure"),
	spec(EventParticipationRecovered, CategoryPipeline, "vacancy_id", "from_stage_id", "to_stage_id", "version", "hire", "departure", "recovery_override", "previous_stage_id"),
	spec(EventParticipationSubstateChanged, CategoryPipeline, "vacancy_id", "from_substate_id", "to_substate_id", "version"),
	spec(EventParticipationChecklistMarked, CategoryPipeline, "vacancy_id", "criterion_id", "previous", "new"),

	// team
	spec(EventVacancyTeamCreated, CategoryTeam, "company_id", "mode", "responsible_user_id", "assignment_id"),
	spec(EventVacancyTeamModeChanged, CategoryTeam, "company_id", "from_mode", "to_mode", "responsible_user_id"),
	spec(EventVacancyTeamMemberAdded, CategoryTeam, "company_id", "assignment_id", "user_id", "function", "recruiter_deadline"),
	spec(EventVacancyTeamMemberRemoved, CategoryTeam, "company_id", "assignment_id", "user_id", "function"),
	spec(EventVacancyTeamMemberLeft, CategoryTeam, "company_id", "assignment_id", "user_id", "function"),
	spec(EventVacancyResponsibleReassigned, CategoryTeam, "company_id", "reassignment_id", "from_user_id", "to_user_id", "from_assignment_id", "to_assignment_id", "reason", "previous_responsible"),
	spec(EventVacancyAssignmentDeadlineChanged, CategoryTeam, "company_id", "assignment_id", "user_id", "previous", "new"),
	spec(EventVacancyAssignmentEndedByMembership, CategoryTeam, "company_id", "assignment_id", "user_id"),

	// company
	spec(EventCompanyUpdated, CategoryCompany),
	spec(EventCompanyDeleted, CategoryCompany, "jobs_closed"),
	spec(EventCompanySitePublished, CategoryCompany, "version"),
	spec(EventCompanySiteUnpublished, CategoryCompany, "version"),
	spec(EventTalentBaseVisibilityChanged, CategoryCompany, "company_id", "version", "previous_mode", "new_mode", "added_user_ids", "removed_user_ids"),

	// members
	spec(EventCompanyMemberAdded, CategoryMembers, "member_user_id", "role"),
	spec(EventCompanyMemberRoleChanged, CategoryMembers, "member_user_id", "from_role", "to_role"),
	spec(EventCompanyMemberOffboarded, CategoryMembers, "company_id", "user_id", "member_user_id", "reassignment_ids", "ended_assignment_ids", "talent_base_viewer_removed"),

	// audit
	spec(EventAuditLogExported, CategoryAudit, "filters", "row_count"),
}

var catalogIndex = func() map[string]EventSpec {
	index := make(map[string]EventSpec, len(catalog))
	for _, s := range catalog {
		index[s.Type] = s
	}
	return index
}()

// Catalog returns the ordered event catalog (the list behind the 2b types
// endpoint). The result is a deep copy: callers cannot mutate the catalog.
func Catalog() []EventSpec {
	out := make([]EventSpec, len(catalog))
	for i, s := range catalog {
		s.MetadataKeys = append([]string(nil), s.MetadataKeys...)
		out[i] = s
	}
	return out
}

// LookupEvent returns the catalog entry of an event type.
func LookupEvent(eventType string) (EventSpec, bool) {
	s, ok := catalogIndex[eventType]
	if !ok {
		return EventSpec{}, false
	}
	s.MetadataKeys = append([]string(nil), s.MetadataKeys...)
	return s, true
}

// Validate refuses an event the catalog does not allow, so the caller's
// transaction fails closed: unknown type, a company-scoped type without a
// company, or a metadata key outside the type's closed set. Errors name the
// event type and key, never a metadata value.
func (e AuditEvent) Validate() error {
	s, ok := catalogIndex[e.EventType]
	if !ok {
		return fmt.Errorf("%w: %q", ErrUnknownEventType, e.EventType)
	}
	if s.CompanyScoped && e.CompanyID == nil {
		return fmt.Errorf("%w: %s", ErrCompanyRequired, e.EventType)
	}
	allowed := make(map[string]bool, len(s.MetadataKeys))
	for _, k := range s.MetadataKeys {
		allowed[k] = true
	}
	var keys []string
	if e.StructuredMetadata != nil {
		for k := range e.StructuredMetadata {
			keys = append(keys, k)
		}
	} else {
		for k := range e.Metadata {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !allowed[k] {
			return fmt.Errorf("%w: %s.%s", ErrMetadataKeyNotAllowed, e.EventType, k)
		}
	}
	return nil
}
