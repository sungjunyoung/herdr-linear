package linear

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type staticAuth string

func (s staticAuth) Authorization(context.Context) (string, error) { return string(s), nil }

func newTestClient(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c := New(staticAuth("Bearer tok"))
	c.Endpoint = srv.URL
	return c
}

func respond(status int, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}
}

func TestIssue(t *testing.T) {
	var gotAuth string
	var gotVars map[string]any
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		var req struct {
			Variables map[string]any `json:"variables"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		gotVars = req.Variables
		respond(200, `{"data":{"issue":{"identifier":"HOMECO-1","title":"Title"}}}`)(w, r)
	})

	is, err := c.Issue(context.Background(), "HOMECO-1")
	if err != nil {
		t.Fatal(err)
	}
	if is != (Issue{Identifier: "HOMECO-1", Title: "Title"}) {
		t.Errorf("Issue() = %+v", is)
	}
	if gotAuth != "Bearer tok" {
		t.Errorf("Authorization header = %q", gotAuth)
	}
	if gotVars["id"] != "HOMECO-1" {
		t.Errorf("variables = %v", gotVars)
	}
}

// Response shapes below were captured from the real Linear API.
func TestIssueErrors(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{
			name:   "not found is HTTP 200 with INPUT_ERROR",
			status: 200,
			body:   `{"errors":[{"message":"Entity not found: Issue","extensions":{"type":"invalid input","code":"INPUT_ERROR","statusCode":400}}],"data":null}`,
			want:   ErrNotFound,
		},
		{
			name:   "authentication error",
			status: 400,
			body:   `{"errors":[{"message":"Authentication required, not authenticated","extensions":{"type":"authentication error","code":"AUTHENTICATION_ERROR","statusCode":401}}]}`,
			want:   ErrUnauthorized,
		},
		{
			name:   "plain 401",
			status: 401,
			body:   `not json`,
			want:   ErrUnauthorized,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newTestClient(t, respond(tt.status, tt.body))
			_, err := c.Issue(context.Background(), "HOMECO-1")
			if !errors.Is(err, tt.want) {
				t.Fatalf("Issue() error = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestIssueOtherGraphQLErrorIsNotNotFound(t *testing.T) {
	c := newTestClient(t, respond(200, `{"errors":[{"message":"Rate limit exceeded","extensions":{"code":"RATELIMITED"}}]}`))
	_, err := c.Issue(context.Background(), "HOMECO-1")
	if err == nil || errors.Is(err, ErrNotFound) || errors.Is(err, ErrUnauthorized) {
		t.Fatalf("Issue() error = %v, want a generic error", err)
	}
}

func TestIssuesByNumberChunks(t *testing.T) {
	var batches [][]float64
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Variables struct {
				Key     string    `json:"key"`
				Numbers []float64 `json:"numbers"`
				First   int       `json:"first"`
			} `json:"variables"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Variables.Key != "HOMECO" || req.Variables.First < len(req.Variables.Numbers) {
			t.Errorf("unexpected variables %+v", req.Variables)
		}
		batches = append(batches, req.Variables.Numbers)
		respond(200, `{"data":{"issues":{"nodes":[{"identifier":"HOMECO-1","title":"t"}]}}}`)(w, r)
	})

	numbers := make([]int, maxBatch+1)
	for i := range numbers {
		numbers[i] = i + 1
	}
	issues, err := c.IssuesByNumber(context.Background(), "HOMECO", numbers)
	if err != nil {
		t.Fatal(err)
	}
	if len(batches) != 2 || len(batches[0]) != maxBatch || len(batches[1]) != 1 {
		t.Fatalf("batch sizes = %d/%v", len(batches), batches)
	}
	if len(issues) != 2 {
		t.Errorf("issues = %d, want results of both batches", len(issues))
	}
}

func TestMyIssues(t *testing.T) {
	var gotKeys []any
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Variables map[string]any `json:"variables"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		gotKeys, _ = req.Variables["keys"].([]any)
		respond(200, `{"data":{"viewer":{"assignedIssues":{"nodes":[
			{"identifier":"HOMECO-1","title":"Fix login","url":"https://linear.app/x/issue/HOMECO-1","branchName":"homeco-1-fix-login","priority":2,
			 "state":{"id":"s1","name":"In Progress","type":"started"},"team":{"key":"HOMECO"}}]}}}}`)(w, r)
	})

	issues, err := c.MyIssues(context.Background(), []string{"HOMECO", "ENG"})
	if err != nil {
		t.Fatal(err)
	}
	want := AssignedIssue{
		Identifier: "HOMECO-1", Title: "Fix login", URL: "https://linear.app/x/issue/HOMECO-1",
		BranchName: "homeco-1-fix-login", Priority: 2,
		State: StateRef{ID: "s1", Name: "In Progress", Type: "started"}, Team: "HOMECO",
	}
	if len(issues) != 1 || issues[0] != want {
		t.Errorf("MyIssues() = %+v, want [%+v]", issues, want)
	}
	if len(gotKeys) != 2 || gotKeys[0] != "HOMECO" || gotKeys[1] != "ENG" {
		t.Errorf("keys variable = %v", gotKeys)
	}
}

func TestWorkflowStatesGroupsAndSorts(t *testing.T) {
	c := newTestClient(t, respond(200, `{"data":{"workflowStates":{"nodes":[
		{"id":"done","name":"Done","type":"completed","position":3,"team":{"key":"HOMECO"}},
		{"id":"eng","name":"Todo","type":"unstarted","position":1,"team":{"key":"ENG"}},
		{"id":"todo","name":"Todo","type":"unstarted","position":0.5,"team":{"key":"HOMECO"}},
		{"id":"prog","name":"In Progress","type":"started","position":2,"team":{"key":"HOMECO"}}]}}}`))

	states, err := c.WorkflowStates(context.Background(), []string{"HOMECO", "ENG"})
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, s := range states["HOMECO"] {
		ids = append(ids, s.ID)
	}
	if len(states) != 2 || len(states["ENG"]) != 1 || strings.Join(ids, ",") != "todo,prog,done" {
		t.Errorf("WorkflowStates() = %+v", states)
	}
	if states["HOMECO"][0] != (State{StateRef{"todo", "Todo", "unstarted"}, 0.5}) {
		t.Errorf("first HOMECO state = %+v", states["HOMECO"][0])
	}
}

func TestSetIssueState(t *testing.T) {
	var gotVars map[string]any
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Variables map[string]any `json:"variables"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		gotVars = req.Variables
		respond(200, `{"data":{"issueUpdate":{"success":true,"issue":{"identifier":"HOMECO-1","state":{"id":"done","name":"Done","type":"completed"}}}}}`)(w, r)
	})

	got, err := c.SetIssueState(context.Background(), "HOMECO-1", "done")
	if err != nil {
		t.Fatal(err)
	}
	if got != (UpdatedIssue{Identifier: "HOMECO-1", State: StateRef{ID: "done", Name: "Done", Type: "completed"}}) {
		t.Errorf("SetIssueState() = %+v", got)
	}
	if gotVars["id"] != "HOMECO-1" || gotVars["stateId"] != "done" {
		t.Errorf("variables = %v", gotVars)
	}
}

func TestSetIssueStateErrors(t *testing.T) {
	tests := []struct {
		name string
		body string
		want error
	}{
		{"forbidden code", `{"errors":[{"message":"Forbidden","extensions":{"type":"forbidden","code":"FORBIDDEN","statusCode":403}}],"data":null}`, ErrForbidden},
		{"scope message", `{"errors":[{"message":"Invalid scope: write required","extensions":{"code":"INVALID_INPUT"}}],"data":null}`, ErrForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newTestClient(t, respond(200, tt.body))
			_, err := c.SetIssueState(context.Background(), "HOMECO-1", "done")
			if !errors.Is(err, tt.want) {
				t.Fatalf("SetIssueState() error = %v, want %v", err, tt.want)
			}
		})
	}

	c := newTestClient(t, respond(200, `{"data":{"issueUpdate":{"success":false,"issue":null}}}`))
	if _, err := c.SetIssueState(context.Background(), "HOMECO-1", "done"); err == nil {
		t.Error("SetIssueState() with success=false returned nil error")
	}
}
