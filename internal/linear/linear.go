// Package linear is a minimal Linear GraphQL client.
package linear

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"
)

// Endpoint is the Linear GraphQL API URL.
const Endpoint = "https://api.linear.app/graphql"

// maxBatch bounds the issue numbers per IssuesByNumber request, matching the
// page size requested so no result is silently cut off.
const maxBatch = 250

var (
	// ErrNotFound means Linear has no issue with the requested identifier.
	ErrNotFound = errors.New("issue not found")
	// ErrUnauthorized means Linear rejected the credentials.
	ErrUnauthorized = errors.New("linear rejected the credentials")
	// ErrForbidden means the credentials lack a permission, typically the
	// write scope.
	ErrForbidden = errors.New("linear credentials lack permission")
)

// Authorizer supplies the Authorization header value for each request.
type Authorizer interface {
	Authorization(ctx context.Context) (string, error)
}

// Issue is the subset of a Linear issue the plugin needs.
type Issue struct {
	Identifier string `json:"identifier"`
	Title      string `json:"title"`
}

// StateRef identifies a workflow state.
type StateRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// State is a team workflow state with its board position.
type State struct {
	StateRef
	Position float64 `json:"position"`
}

// AssignedIssue is an issue assigned to the viewer.
type AssignedIssue struct {
	Identifier string   `json:"identifier"`
	Title      string   `json:"title"`
	URL        string   `json:"url"`
	BranchName string   `json:"branchName"`
	Priority   int      `json:"priority"`
	State      StateRef `json:"state"`
	Team       string   `json:"team"`
}

// UpdatedIssue is an issue after a state change.
type UpdatedIssue struct {
	Identifier string   `json:"identifier"`
	State      StateRef `json:"state"`
}

// Client calls the Linear GraphQL API.
type Client struct {
	HTTP     *http.Client
	Endpoint string
	Auth     Authorizer
}

// New returns a Client for the public Linear API.
func New(auth Authorizer) *Client {
	return &Client{
		HTTP:     &http.Client{Timeout: 15 * time.Second},
		Endpoint: Endpoint,
		Auth:     auth,
	}
}

// Viewer returns the display name of the authenticated user.
func (c *Client) Viewer(ctx context.Context) (string, error) {
	var out struct {
		Viewer struct {
			Name string `json:"name"`
		} `json:"viewer"`
	}
	if err := c.do(ctx, `query { viewer { name } }`, nil, &out); err != nil {
		return "", err
	}
	return out.Viewer.Name, nil
}

// Issue fetches one issue by identifier such as "HOMECO-2290". It returns an
// error wrapping ErrNotFound when the issue does not exist.
func (c *Client) Issue(ctx context.Context, identifier string) (Issue, error) {
	var out struct {
		Issue Issue `json:"issue"`
	}
	err := c.do(ctx, `query($id: String!) { issue(id: $id) { identifier title } }`,
		map[string]any{"id": identifier}, &out)
	if err != nil {
		return Issue{}, fmt.Errorf("%s: %w", identifier, err)
	}
	return out.Issue, nil
}

// IssuesByNumber fetches the issues of one team by number. Numbers without an
// issue are simply absent from the result.
//
// A single query with one aliased issue(id:) field per issue is not used
// because Linear nulls the whole response when any alias is not found.
func (c *Client) IssuesByNumber(ctx context.Context, teamKey string, numbers []int) ([]Issue, error) {
	const query = `query($key: String!, $numbers: [Float!], $first: Int!) {
  issues(first: $first, filter: { team: { key: { eq: $key } }, number: { in: $numbers } }) {
    nodes { identifier title }
  }
}`
	var issues []Issue
	for start := 0; start < len(numbers); start += maxBatch {
		chunk := numbers[start:min(start+maxBatch, len(numbers))]
		var out struct {
			Issues struct {
				Nodes []Issue `json:"nodes"`
			} `json:"issues"`
		}
		vars := map[string]any{"key": teamKey, "numbers": chunk, "first": maxBatch}
		if err := c.do(ctx, query, vars, &out); err != nil {
			return nil, err
		}
		issues = append(issues, out.Issues.Nodes...)
	}
	return issues, nil
}

// MyIssues returns the viewer's open (not completed or canceled) issues in
// the given teams.
func (c *Client) MyIssues(ctx context.Context, teamKeys []string) ([]AssignedIssue, error) {
	// ponytail: first 250 without pagination; paginate if someone holds more open issues.
	const query = `query($keys: [String!]) {
  viewer {
    assignedIssues(first: 250, filter: { state: { type: { nin: ["completed", "canceled"] } }, team: { key: { in: $keys } } }) {
      nodes { identifier title url branchName priority state { id name type } team { key } }
    }
  }
}`
	var out struct {
		Viewer struct {
			AssignedIssues struct {
				Nodes []struct {
					AssignedIssue
					Team struct {
						Key string `json:"key"`
					} `json:"team"`
				} `json:"nodes"`
			} `json:"assignedIssues"`
		} `json:"viewer"`
	}
	if err := c.do(ctx, query, map[string]any{"keys": teamKeys}, &out); err != nil {
		return nil, err
	}
	issues := make([]AssignedIssue, 0, len(out.Viewer.AssignedIssues.Nodes))
	for _, n := range out.Viewer.AssignedIssues.Nodes {
		is := n.AssignedIssue
		is.Team = n.Team.Key
		issues = append(issues, is)
	}
	return issues, nil
}

// WorkflowStates returns every workflow state of the given teams, keyed by
// team key and sorted by position.
func (c *Client) WorkflowStates(ctx context.Context, teamKeys []string) (map[string][]State, error) {
	// ponytail: first 250 without pagination; teams have a handful of states.
	const query = `query($keys: [String!]) {
  workflowStates(first: 250, filter: { team: { key: { in: $keys } } }) {
    nodes { id name type position team { key } }
  }
}`
	var out struct {
		WorkflowStates struct {
			Nodes []struct {
				State
				Team struct {
					Key string `json:"key"`
				} `json:"team"`
			} `json:"nodes"`
		} `json:"workflowStates"`
	}
	if err := c.do(ctx, query, map[string]any{"keys": teamKeys}, &out); err != nil {
		return nil, err
	}
	states := make(map[string][]State)
	for _, n := range out.WorkflowStates.Nodes {
		states[n.Team.Key] = append(states[n.Team.Key], n.State)
	}
	for _, s := range states {
		slices.SortStableFunc(s, func(a, b State) int { return cmp.Compare(a.Position, b.Position) })
	}
	return states, nil
}

// SetIssueState moves the issue to the workflow state stateID.
func (c *Client) SetIssueState(ctx context.Context, identifier, stateID string) (UpdatedIssue, error) {
	const query = `mutation($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) {
    success
    issue { identifier state { id name type } }
  }
}`
	var out struct {
		IssueUpdate struct {
			Success bool         `json:"success"`
			Issue   UpdatedIssue `json:"issue"`
		} `json:"issueUpdate"`
	}
	if err := c.do(ctx, query, map[string]any{"id": identifier, "stateId": stateID}, &out); err != nil {
		return UpdatedIssue{}, fmt.Errorf("%s: %w", identifier, err)
	}
	if !out.IssueUpdate.Success {
		return UpdatedIssue{}, fmt.Errorf("%s: linear did not update the issue", identifier)
	}
	return out.IssueUpdate.Issue, nil
}

type gqlError struct {
	Message    string `json:"message"`
	Extensions struct {
		Code string `json:"code"`
	} `json:"extensions"`
}

func (c *Client) do(ctx context.Context, query string, vars map[string]any, out any) error {
	authz, err := c.Auth.Authorization(ctx)
	if err != nil {
		return err
	}
	body, err := json.Marshal(struct {
		Query     string         `json:"query"`
		Variables map[string]any `json:"variables,omitempty"`
	}{query, vars})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authz)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("linear request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("linear response: %w", err)
	}

	var env struct {
		Data   json.RawMessage `json:"data"`
		Errors []gqlError      `json:"errors"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		if resp.StatusCode == http.StatusUnauthorized {
			return ErrUnauthorized
		}
		return fmt.Errorf("linear: HTTP %d: %s", resp.StatusCode, snippet(raw))
	}
	// Linear reports most failures, including "not found", as HTTP 200 with
	// an errors array, so errors must be inspected before the status code.
	if len(env.Errors) > 0 {
		return classify(resp.StatusCode, env.Errors)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("linear: HTTP %d: %s", resp.StatusCode, snippet(raw))
	}
	return json.Unmarshal(env.Data, out)
}

func classify(status int, errs []gqlError) error {
	for _, e := range errs {
		switch {
		case e.Extensions.Code == "AUTHENTICATION_ERROR":
			return fmt.Errorf("%w: %s", ErrUnauthorized, e.Message)
		case e.Extensions.Code == "FORBIDDEN" || strings.Contains(strings.ToLower(e.Message), "scope"):
			return fmt.Errorf("%w: %s", ErrForbidden, e.Message)
		case e.Extensions.Code == "INPUT_ERROR" && strings.HasPrefix(e.Message, "Entity not found"):
			return ErrNotFound
		}
	}
	if status == http.StatusUnauthorized {
		return fmt.Errorf("%w: %s", ErrUnauthorized, errs[0].Message)
	}
	return fmt.Errorf("linear: %s", errs[0].Message)
}

func snippet(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 200 {
		return s[:200] + "…"
	}
	return s
}
