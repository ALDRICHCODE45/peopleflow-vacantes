package cvs

import "context"

// ReconcileOrphans requires the caller to exclude in-flight file-first writes
// for its entire duration (the Postgres adapter uses an advisory lock).
func ReconcileOrphans(ctx context.Context, storage Storage, referenced func(context.Context, string) (bool, error)) error {
	keys, err := storage.Keys(ctx)
	if err != nil {
		return err
	}
	for _, key := range keys {
		keep, err := referenced(ctx, key)
		if err != nil {
			return err
		}
		if !keep {
			if err = storage.Delete(ctx, key); err != nil {
				return err
			}
		}
	}
	return nil
}
