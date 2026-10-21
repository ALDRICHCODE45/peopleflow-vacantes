//go:build integration

package postgres

import (
	"context"
	"testing"
)

func TestProfileHarmonizationStoredEducation(t *testing.T) {
	if testing.Short() {
		t.Skip("database test")
	}
	repo, pool := newTestRepo(t)
	user := seedUser(t, pool)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO candidate_profiles(user_id,years_of_experience) VALUES($1,7.9)`, user); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO candidate_educations(user_id,position,level,field,status) VALUES($1,0,'bachelor','Degree','completed'),($1,1,'master','Masters','completed'),($1,2,'phd','Ongoing','in_progress'),($1,3,'specialty','Specialty','completed')`, user); err != nil {
		t.Fatal(err)
	}
	got, err := repo.GetProfileByUserID(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if got.YearsOfExperience == nil || *got.YearsOfExperience != "7.9" || len(got.Education) != 4 || got.Education[2].Status != "in_progress" || got.Education[3].Level != "specialty" {
		t.Fatalf("full projection: %+v", got)
	}
	if _, err := pool.Exec(ctx, `UPDATE candidate_educations SET status='paused' WHERE user_id=$1 AND status='completed'`, user); err != nil {
		t.Fatal(err)
	}
	got, err = repo.GetProfileByUserID(ctx, user)
	if err != nil || len(got.Education) != 4 || got.Education[0].Status != "paused" {
		t.Fatalf("paused records preserved: %+v %v", got, err)
	}
}
