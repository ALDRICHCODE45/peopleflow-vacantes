package candidateview

// All CV joins must scope mc/corrected to the participation's company. A caller
// disables corrected's join for original downloads; originals work before edits.
const CVFileSQL = `COALESCE(corrected.file_name,mc.file_name,l.name),COALESCE(corrected.content_type,mc.content_type,v.content_type),COALESCE(corrected.size,mc.size,v.size),COALESCE(corrected.storage_key,mc.storage_key,v.storage_key),(corrected.id IS NOT NULL)`
const CurrentCVSQL = `CASE WHEN COALESCE(corrected.file_name,mc.file_name,l.name) IS NULL THEN NULL ELSE jsonb_build_object('file_name',COALESCE(corrected.file_name,mc.file_name,l.name),'uploaded_at',COALESCE(corrected.uploaded_at,mc.uploaded_at,v.uploaded_at),'source',CASE WHEN corrected.id IS NULL THEN 'candidate' ELSE 'company' END) END`
const OriginalCVSQL = `CASE WHEN corrected.id IS NULL OR COALESCE(mc.file_name,l.name) IS NULL THEN NULL ELSE jsonb_build_object('file_name',COALESCE(mc.file_name,l.name),'uploaded_at',COALESCE(mc.uploaded_at,v.uploaded_at)) END`
