-- +goose Up
CREATE TABLE industries (
    id          TEXT PRIMARY KEY,
    label_es    TEXT NOT NULL,
    label_en    TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO industries (id, label_es, label_en, sort_order) VALUES
    ('technology',    'Tecnología',   'Technology',     10),
    ('retail',        'Comercio',     'Retail',         20),
    ('manufacturing', 'Manufactura',  'Manufacturing',  30),
    ('finance',       'Finanzas',     'Finance',        40),
    ('healthcare',    'Salud',        'Healthcare',     50),
    ('education',     'Educación',    'Education',       60),
    ('construction',  'Construcción', 'Construction',    70),
    ('hospitality',   'Hostelería',   'Hospitality',     80),
    ('other',         'Otro',         'Other',          999);

-- +goose Down
DROP TABLE industries;
