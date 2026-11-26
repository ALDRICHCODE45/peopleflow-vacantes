# Careers site sections v2 — slice B, hero video (backend)

Backend half of slice B (user approved, relayed by the frontend session 2026-11-26). Branch
`feat/careers-hero-video-backend` (worktree `../peopleflow-vacantes-herovideo`). Frontend on `feat/careers-hero-video`;
it merges only after this is in main.

## Specs

- **S1** Frontend request (verbatim, L1): «Media kind `hero_video`: content_type `video/mp4`, cap 20 MB, duration ≤ 30 s,
  validated by `ftyp` (isom/mp42/avc1) + `moov` (duration, and dimensions if you can get them; width/height nullable for
  video), `duration_ms` column. Streaming upload (don't read 20 MB into memory). Clear errors: wrong type → 415
  unsupported_media_type, too large → 413, too long → 422 (code? e.g. video_too_long), unreadable → 422. Hero content
  `background_video: {media_id} | null` (kind hero_video, through v.media for ownership); with variant
  `background_loop`, publishing needs background_video AND cover (poster); otherwise `hero_video_missing` keeps
  blocking. Missing → null on read, old documents byte-identical as in slice A. Serving GET /media/{id} with Range/206
  (http.ServeContent over a seekable reader or a ranged S3 GET), Accept-Ranges, Content-Range, the same
  cache/nosniff/CSP headers.» Decision relayed: «no ffmpeg (image unchanged, structural validation)».
- **S2** Backend decisions (sent to the frontend, L2):
  - Upload through the existing multipart endpoint `/v2/me/company/site/media` with `kind=hero_video`.
  - Limits: 20 MB = 20971520 bytes (request cap + multipart overhead like documents); duration ≤ 30000 ms.
  - Codes: 415 `unsupported_media_type` (not MP4 by ftyp brand isom/iso2/mp41/mp42/avc1, or extension/declared type not
    mp4), 413 `payload_too_large`, 422 `video_too_long` (data `{max_ms, duration_ms}`), 422 `video_invalid` (no
    parsable moov/mvhd, zero duration, malformed boxes).
  - Streaming: the body is streamed to a bounded temporary spool (never fully in memory), boxes parsed from the spool
    (moov may come before or after mdat), then the spool is stored through the media storage; spool always removed.
    `moov` after `mdat` is accepted (documented as slower first frame).
  - Dimensions from the first video track `tkhd` when present (nullable otherwise); migration relaxes the media width/
    height CHECKs for `hero_video`, adds nullable `duration_ms` (CHECK 1..30000, required iff kind = hero_video), adds
    `video/mp4` to the content type/kind CHECKs; guarded Down refusing while hero_video media exist.
  - Serving: `GET /media/{id}` (public media route) honors `Range` with 206/`Content-Range`/`Accept-Ranges: bytes`, 416
    for unsatisfiable ranges, for every kind; disk storage via `http.ServeContent` on a seekable file; S3 via ranged
    GetObject streamed (no whole-object buffering — the current 5 MiB buffered Open must not apply to video).
  - Hero content `background_video` absent stays absent on read (L4 §9 of slice A); publish: `background_loop` needs
    `background_video` and `cover`, else `hero_video_missing`.

## Tasks

- T1 S1-S2 — slice B (writer) — done 995e030a, 0462cc61, cd54cc4f, 188ab355
- T2 — suite, review, merge, notify frontend — done

## Log

- **L1** 2026-11-26, frontend session: «the user pushed everything and approved continuing with slice B (hero video)
  [...] Questions: (a) can you take it? (b) exact names/codes/limits and whether the upload goes through the same
  multipart endpoint /v2/me/company/site/media with kind=hero_video.»
- **L2** 2026-11-26, backend: accepted with S2.
- **L3** 2026-11-26, writer (T1): slice B implemented test-first, uncommitted. Migration 00067
  `company_site_hero_video_media` (nullable `duration_ms` 1..30000 iff `hero_video`; width/height nullable only for
  videos, both or neither, 1..16384; `video/mp4` iff `hero_video`; 20 MiB byte size for videos; guarded Down).
  `application.InspectVideo` (dependency-free MP4 box parser, bounded headers/boxes). Upload streams to a bounded
  `os.CreateTemp` spool (removed on every path; file-before-kind kept in memory up to 5 MiB); codes 415
  `unsupported_media_type` (name not `.mp4`, declared type not `video/mp4`/`application/octet-stream`, `ftyp`/brand),
  413 `payload_too_large`, 422 `video_too_long` `{"data":{"max_ms":30000,"duration_ms":N}}`, 422 `video_invalid`
  (catalog entries + `httpjson.WriteSiteVideoTooLong`, parent-approved). Storage port: `PutStream`, seekable `Open`,
  `OpenRange` (+ `Prefetcher`); new disk adapter on `CV_STORAGE_ROOT` (same 64-hex layout; CV Reconcile keeps
  `company_site_media` keys, parent-approved); S3 `PutStream` and lazy ranged `GetObject` (no 5 MiB buffer for
  videos, streaming client without whole-request timeout). `GET /media/{id}`: `http.ServeContent` for every kind
  (206/`Content-Range`/`Accept-Ranges`, 416 `bytes */size` no-store empty body, multi-range → 200 whole). Hero
  `background_video` (kind `hero_video`, absent stays absent); `background_loop` publishes only with
  `background_video` and `cover`. Deviations: multi-range requests are served 200 whole; video upload/download
  deadlines extended to 2 min; media JSON `width`/`height` may be `null` (videos only) and `duration_ms` appears
  only on videos. Contract §2.4 amendment + `backend/docs/site-media.md` updated.
- **L4** 2026-11-26, independent verify (gentle-ai-verify, Risk items 2/3): no blockers. Parser robustness, upload
  (spool bounded and removed, keys, traversal, ownership, quota), serving (206/416/200 disk + MinIO), migration 00067
  round trip, CV Reconcile keep-predicate and old documents: PASS. Fixed by the parent: #1 Medium — the upload
  handler extended only the read deadline, so a slow accepted upload was stored but the client got no response (the
  server WriteTimeout counts from the headers): now also extends the write deadline; #2 Low — a malformed Range,
  another unit or `bytes=-0` answered 416 (images answered 200 before): now ignored → 200 (`singleByteRange`, unit
  test; `TestPublicMediaRange` updated, real 416 only for an unsatisfiable start); contract and site-media doc say so.
  Accepted Low/info: request cap 20 MiB + 64 KiB for every kind (per-file 5 MiB image cap and 413 unchanged), image
  preconditions now honored by ServeContent, spool concurrency/tmpfs (follow-up), latent Reconcile race (no caller in
  production). Full backend suite on the branch: unit exit 0, integration 123 packages ok, only the legacy
  pre-existing identity/jobs postgres FAIL; archguard only docker/minio.
- **L5** 2026-11-26, parent: RDD native review (whole branch over the lens budget → per commit): cd54cc4f
  (upload/serving/disk adapter) and 0462cc61 (MP4 parser + codes) approved and acknowledged. Advisory follow-ups:
  (1) duration enforced only from the self-declared mvhd; fragmented MP4 (mvex/moof) with mvhd 0 → video_invalid, and
  a longer fragmented file could pass — cross-check mdhd/tkhd or reject mvex/moof; (2) mp4Reader treats (n==len, EOF)
  from ReadAt as malformed; (3) untested uuid/hdlr/tkhd-version branches; (4) public video GET holds a connection up
  to 2 min (slow-reader amplification); (5) spool in TMPDIR has no global bound or startup sweep; (6) rollback is
  fix-forward only once a company saves `background_video` (old validator rejects the key; NULL dimensions);
  write-deadline finding already fixed in 188ab355. Merged into local main; 00067 on the dev DB.
