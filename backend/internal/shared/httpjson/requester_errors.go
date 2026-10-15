package httpjson

import "net/http"

// RequesterRef is the typed conflict payload of requester_already_exists: the
// already-stored entry of the caller's own company and kind.
type RequesterRef struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type requesterConflictData struct {
	Existing RequesterRef `json:"existing"`
}

type requesterConflictEnvelope struct {
	Error string                `json:"error"`
	Code  Code                  `json:"code"`
	Data  requesterConflictData `json:"data"`
}

// WriteRequesterAlreadyExists is the dedicated typed projection of the
// requester duplicate (contract §7). It always carries data.existing and is
// deliberately separate from WriteCatalogErrorData, which keeps stripping data
// for every code except conflict.
func WriteRequesterAlreadyExists(w http.ResponseWriter, existing RequesterRef) {
	def := Resolve(CodeRequesterAlreadyExists)
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, requesterConflictEnvelope{
		Error: def.Message,
		Code:  def.Code,
		Data:  requesterConflictData{Existing: existing},
	})
}
