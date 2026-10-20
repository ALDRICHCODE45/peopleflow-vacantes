package http

import "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"

// Read references expose the catalog identifier as id; stored codes and write
// values keep their existing names.
type itemResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type itemsResponse struct {
	Items []itemResponse `json:"items"`
}
type postalMatchResponse struct {
	State        itemResponse `json:"state"`
	Municipality itemResponse `json:"municipality"`
}
type postalResponse struct {
	PostalCode string                `json:"postal_code"`
	Matches    []postalMatchResponse `json:"matches"`
}

func item(value domain.Item) itemResponse { return itemResponse{ID: value.Code, Name: value.Name} }
func items(values []domain.Item) itemsResponse {
	out := itemsResponse{Items: make([]itemResponse, 0, len(values))}
	for _, value := range values {
		out.Items = append(out.Items, item(value))
	}
	return out
}
