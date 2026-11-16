package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"

	"github.com/sungjunyoung/herdr-linear/internal/linear"
)

// The JSON objects below are what the Herdr desktop app's Linear panel reads
// from "issues" and "set-state".

type issueList struct {
	Status string                    `json:"status"`
	Issues []linear.AssignedIssue    `json:"issues"`
	States map[string][]linear.State `json:"states"`
}

type stateChange struct {
	Status     string          `json:"status"`
	Identifier string          `json:"identifier"`
	State      linear.StateRef `json:"state"`
}

type failure struct {
	Status     string `json:"status"`
	Message    string `json:"message"`
	NeedsSetup bool   `json:"needs_setup,omitempty"`
}

func failed(err error) failure {
	return failure{Status: "error", Message: userMessage(err), NeedsSetup: needsSetup(err)}
}

type issueAPI interface {
	MyIssues(ctx context.Context, teamKeys []string) ([]linear.AssignedIssue, error)
	WorkflowStates(ctx context.Context, teamKeys []string) (map[string][]linear.State, error)
	SetIssueState(ctx context.Context, identifier, stateID string) (linear.UpdatedIssue, error)
}

func (a *app) issues(ctx context.Context, out io.Writer) error {
	rt, err := a.load()
	if err != nil {
		return emit(out, failed(err))
	}
	return emit(out, listIssues(ctx, rt.linear, rt.cfg.TeamKeys))
}

func (a *app) setState(ctx context.Context, out io.Writer, identifier, stateID string) error {
	rt, err := a.load()
	if err != nil {
		return emit(out, failed(err))
	}
	return emit(out, changeState(ctx, rt.linear, identifier, stateID))
}

func listIssues(ctx context.Context, api issueAPI, teamKeys []string) any {
	issues, err := api.MyIssues(ctx, teamKeys)
	if err != nil {
		return failed(err)
	}
	states, err := api.WorkflowStates(ctx, teamKeys)
	if err != nil {
		return failed(err)
	}
	if issues == nil {
		issues = []linear.AssignedIssue{}
	}
	if states == nil {
		states = map[string][]linear.State{}
	}
	return issueList{Status: "ok", Issues: issues, States: states}
}

func changeState(ctx context.Context, api issueAPI, identifier, stateID string) any {
	is, err := api.SetIssueState(ctx, identifier, stateID)
	if err != nil {
		return failed(err)
	}
	return stateChange{Status: "ok", Identifier: is.Identifier, State: is.State}
}

// emit prints res as one JSON object and returns an error exactly when res
// is a failure, so the command exits non-zero.
func emit(out io.Writer, res any) error {
	if err := json.NewEncoder(out).Encode(res); err != nil {
		return err
	}
	if f, ok := res.(failure); ok {
		return errors.New(f.Message)
	}
	return nil
}
