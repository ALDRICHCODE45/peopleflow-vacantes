# CV download filename without a doubled extension

Branch fix/cv-download-filename (from main c6eda309). Not deployed on :8081 until the user reviews it.

## Specs

- **S1** Request (frontend session relaying the user, 2026-11-18): «arreglá el nombre de descarga del CV «….pdf.pdf».
  Lo vimos en board/handler.go:204 y en cvs/handler.go:260, donde se arma Name + extensión cuando el nombre ya trae la
  extensión. Agregá un test. Lo revisa el usuario mañana.»

## Tasks

- [ ] T1 (S1) Recruiter CV download and candidate own CV download send one extension; tests — worker.

## Log

- **L1** Root cause (live demo seed investigation): the real candidate upload sends only `file`
  (frontend/src/features/candidate-cvs/upload.ts:6), so the library name defaults to the uploaded file name with its
  extension (candidates cvs/handler.go:132-133); downloads build `Name + extension` (applications board/handler.go:204,
  candidates cvs/handler.go:260). `httpjson.AttachmentFilename` already avoids the double extension and is used for
  company-corrected CVs (board/handler.go:205-206).
