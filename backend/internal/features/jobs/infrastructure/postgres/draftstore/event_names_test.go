package draftstore

import audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"

// Test-side names for the catalog event types the draftstore emits.
const (
	deliveryConfiguredEvent   = audit.EventJobDraftDeliveryConfigured
	managementConfiguredEvent = audit.EventJobDraftManagementConfigured
	pipelineConfiguredEvent   = audit.EventJobDraftPipelineConfigured
	substatesConfiguredEvent  = audit.EventJobDraftSubstatesConfigured
	vacancyPublishedEvent     = audit.EventVacancyPublished
)
