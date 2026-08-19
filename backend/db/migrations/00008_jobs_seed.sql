-- +goose Up
-- +goose StatementBegin
-- Dev-only seed for the `jobs` slice. Self-contained: provisions 3 active
-- companies (fixed UUIDs, valid `industry_id` from 00001) and 6 published
-- jobs (fixed UUIDs, staggered `published_at`, `deleted_at IS NULL`). The
-- fixed UUIDs + `ON CONFLICT (id) DO NOTHING` make re-runs idempotent and
-- give downstream tests deterministic row counts.
--
-- This seed is NOT a runtime requirement (spec Out of Scope). It exists so
-- local devs and integration tests have something to read without standing
-- up the future write flow.
INSERT INTO companies (id, name, rfc, industry_id, status) VALUES
    ('018f0000-0000-7000-8000-000000000001', 'Acme SA',         'ACME010101AAA', 'technology', 'active'),
    ('018f0000-0000-7000-8000-000000000002', 'Globex Holdings', 'GLOB010101BBB', 'finance',    'active'),
    ('018f0000-0000-7000-8000-000000000003', 'Initech LLC',     'INIT010101CCC', 'retail',     'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO jobs
    (id, company_id, title, description, work_mode, employment_type,
     seniority, status, location, salary_min, salary_max, salary_currency,
     published_at, created_at, updated_at)
VALUES
    ('018f0000-0000-7000-8000-0000000000a1',
     '018f0000-0000-7000-8000-000000000001',
     'Backend Engineer (Go)', 'Build distributed services in Go and Kubernetes.',
     'remote', 'full_time', 'senior', 'published', 'CDMX',
     80000, 120000, 'MXN',
     '2026-08-01T12:00:00Z', now(), now()),
    ('018f0000-0000-7000-8000-0000000000a2',
     '018f0000-0000-7000-8000-000000000001',
     'Frontend Engineer', 'React + TypeScript for the candidate portal.',
     'hybrid', 'full_time', 'mid', 'published', 'CDMX',
     50000, 80000, 'MXN',
     '2026-08-05T12:00:00Z', now(), now()),
    ('018f0000-0000-7000-8000-0000000000a3',
     '018f0000-0000-7000-8000-000000000002',
     'Data Engineer', 'Pipelines on Airflow and BigQuery; Spanish-speaking team.',
     'remote', 'full_time', 'senior', 'published', 'Remote LATAM',
     90000, 130000, 'USD',
     '2026-08-10T12:00:00Z', now(), now()),
    ('018f0000-0000-7000-8000-0000000000a4',
     '018f0000-0000-7000-8000-000000000002',
     'ML Engineer', 'Recommendation systems, PyTorch, embeddings.',
     'remote', 'contract', 'lead', 'published', 'Remote',
     NULL, NULL, 'USD',
     '2026-08-12T12:00:00Z', now(), now()),
    ('018f0000-0000-7000-8000-0000000000a5',
     '018f0000-0000-7000-8000-000000000003',
     'Junior QA', 'Manual + automated testing, ISTQB foundation a plus.',
     'onsite', 'full_time', 'junior', 'published', 'Guadalajara',
     25000, 35000, 'MXN',
     '2026-08-15T12:00:00Z', now(), now()),
    ('018f0000-0000-7000-8000-0000000000a6',
     '018f0000-0000-7000-8000-000000000003',
     'DevOps Intern', 'CI/CD pipelines, IaC, on-call shadowing.',
     'hybrid', 'internship', 'intern', 'published', 'Guadalajara',
     15000, 20000, 'MXN',
     '2026-08-18T12:00:00Z', now(), now())
ON CONFLICT (id) DO NOTHING;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Delete the seeded jobs before the seeded companies: jobs reference
-- companies by FK, so deleting in the wrong order would hit a FK
-- violation.
DELETE FROM jobs
    WHERE id IN (
        '018f0000-0000-7000-8000-0000000000a1',
        '018f0000-0000-7000-8000-0000000000a2',
        '018f0000-0000-7000-8000-0000000000a3',
        '018f0000-0000-7000-8000-0000000000a4',
        '018f0000-0000-7000-8000-0000000000a5',
        '018f0000-0000-7000-8000-0000000000a6'
    );

DELETE FROM companies
    WHERE id IN (
        '018f0000-0000-7000-8000-000000000001',
        '018f0000-0000-7000-8000-000000000002',
        '018f0000-0000-7000-8000-000000000003'
    );
-- +goose StatementEnd