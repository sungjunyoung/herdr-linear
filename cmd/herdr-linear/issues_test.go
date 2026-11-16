package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/sungjunyoung/herdr-linear/internal/linear"
)

type fakeAPI struct {
	issues []linear.AssignedIssue
	states map[string][]linear.State
	err    error
}

func (f fakeAPI) MyIssues(context.Context, []string) ([]linear.AssignedIssue, error) {
	return f.issues, f.err
}

func (f fakeAPI) WorkflowStates(context.Context, []string) (map[string][]linear.State, error) {
	return f.states, f.err
}

func (f fakeAPI) SetIssueState(_ context.Context, identifier, stateID string) (linear.UpdatedIssue, error) {
	return linear.UpdatedIssue{Identifier: identifier, State: linear.StateRef{ID: stateID, Name: "Done", Type: "completed"}}, f.err
}

func emitted(t *testing.T, res any) (string, error) {
	t.Helper()
	var buf bytes.Buffer
	err := emit(&buf, res)
	return buf.String(), err
}

func quote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func assertJSON(t *testing.T, got, want string) {
	t.Helper()
	var g, w any
	if err := json.Unmarshal([]byte(got), &g); err != nil {
		t.Fatalf("output %q is not JSON: %v", got, err)
	}
	if err := json.Unmarshal([]byte(want), &w); err != nil {
		t.Fatal(err)
	}
	gb, _ := json.Marshal(g)
	wb, _ := json.Marshal(w)
	if !bytes.Equal(gb, wb) {
		t.Errorf("output = %s, want %s", gb, wb)
	}
}

func TestListIssuesOutput(t *testing.T) {
	forbidden := quote(userMessage(linear.ErrForbidden))
	tests := []struct {
		name    string
		api     fakeAPI
		want    string
		wantErr bool
	}{
		{
			name: "ok",
			api: fakeAPI{
				issues: []linear.AssignedIssue{{
					Identifier: "HOMECO-1", Title: "Fix login", URL: "https://linear.app/x", BranchName: "homeco-1", Priority: 2,
					State: linear.StateRef{ID: "s1", Name: "In Progress", Type: "started"}, Team: "HOMECO",
				}},
				states: map[string][]linear.State{"HOMECO": {{StateRef: linear.StateRef{ID: "s0", Name: "Todo", Type: "unstarted"}, Position: 1}}},
			},
			want: `{"status":"ok",
				"issues":[{"identifier":"HOMECO-1","title":"Fix login","url":"https://linear.app/x","branchName":"homeco-1","priority":2,
					"state":{"id":"s1","name":"In Progress","type":"started"},"team":"HOMECO"}],
				"states":{"HOMECO":[{"id":"s0","name":"Todo","type":"unstarted","position":1}]}}`,
		},
		{name: "empty", api: fakeAPI{}, want: `{"status":"ok","issues":[],"states":{}}`},
		{name: "error", api: fakeAPI{err: errors.New("boom")}, want: `{"status":"error","message":"boom"}`, wantErr: true},
		{
			name:    "needs setup",
			api:     fakeAPI{err: linear.ErrUnauthorized},
			want:    `{"status":"error","message":` + quote(userMessage(linear.ErrUnauthorized)) + `,"needs_setup":true}`,
			wantErr: true,
		},
		{
			name:    "forbidden needs setup",
			api:     fakeAPI{err: linear.ErrForbidden},
			want:    `{"status":"error","message":` + forbidden + `,"needs_setup":true}`,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := emitted(t, listIssues(context.Background(), tt.api, []string{"HOMECO"}))
			if (err != nil) != tt.wantErr {
				t.Errorf("emit error = %v, wantErr %v", err, tt.wantErr)
			}
			assertJSON(t, got, tt.want)
		})
	}
}

func TestChangeStateOutput(t *testing.T) {
	got, err := emitted(t, changeState(context.Background(), fakeAPI{}, "HOMECO-1", "done"))
	if err != nil {
		t.Fatal(err)
	}
	assertJSON(t, got, `{"status":"ok","identifier":"HOMECO-1","state":{"id":"done","name":"Done","type":"completed"}}`)

	got, err = emitted(t, changeState(context.Background(), fakeAPI{err: linear.ErrForbidden}, "HOMECO-1", "done"))
	if err == nil {
		t.Error("forbidden set-state returned nil error")
	}
	assertJSON(t, got, `{"status":"error","message":`+quote(userMessage(linear.ErrForbidden))+`,"needs_setup":true}`)
}
