package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, data string, perm os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(data), perm); err != nil {
		t.Fatal(err)
	}
}

func assertFile(t *testing.T, path, want string, wantPerm os.FileMode) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != want {
		t.Errorf("%s = %q, want %q", path, got, want)
	}
	assertPerm(t, path, wantPerm)
}

func assertPerm(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Errorf("%s mode = %v, want %v", path, got, want)
	}
}

// legacyTree creates plugin config and state dirs for the legacy id under a
// temp root and returns the new id's config and state dirs.
func legacyTree(t *testing.T) (configDir, stateDir string) {
	t.Helper()
	root := t.TempDir()
	configParent := filepath.Join(root, "config", "herdr", "plugins", "config")
	stateParent := filepath.Join(root, "state", "herdr", "plugins")
	writeFile(t, filepath.Join(configParent, legacyPluginID, "config.toml"), "team_keys = [\"ENG\"]\n", 0o600)
	writeFile(t, filepath.Join(stateParent, legacyPluginID, "oauth", "token.json"), `{"access_token":"x"}`, 0o600)
	if err := os.Chmod(filepath.Join(stateParent, legacyPluginID, "oauth"), 0o700); err != nil {
		t.Fatal(err)
	}
	return filepath.Join(configParent, defaultPluginID), filepath.Join(stateParent, defaultPluginID)
}

func TestMigrateLegacyCopiesTree(t *testing.T) {
	configDir, stateDir := legacyTree(t)
	// herdr may already have created the new config dir, empty.
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatal(err)
	}

	for range 2 {
		if err := migrateLegacy(configDir, stateDir); err != nil {
			t.Fatal(err)
		}
		assertFile(t, filepath.Join(configDir, "config.toml"), "team_keys = [\"ENG\"]\n", 0o600)
		assertFile(t, filepath.Join(stateDir, "oauth", "token.json"), `{"access_token":"x"}`, 0o600)
		assertPerm(t, filepath.Join(stateDir, "oauth"), 0o700)
	}
	entries, err := os.ReadDir(filepath.Dir(stateDir))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Errorf("state parent has %d entries, want legacy and new dir only", len(entries))
	}
}

func TestMigrateLegacySkipsNonEmptyDir(t *testing.T) {
	configDir, stateDir := legacyTree(t)
	writeFile(t, filepath.Join(configDir, "config.toml"), "mine", 0o600)

	if err := migrateLegacy(configDir, stateDir); err != nil {
		t.Fatal(err)
	}
	assertFile(t, filepath.Join(configDir, "config.toml"), "mine", 0o600)
	// Each dir migrates independently.
	assertFile(t, filepath.Join(stateDir, "oauth", "token.json"), `{"access_token":"x"}`, 0o600)
}

func TestMigrateLegacySkipsMissingLegacy(t *testing.T) {
	root := t.TempDir()
	configDir := filepath.Join(root, "config", defaultPluginID)
	stateDir := filepath.Join(root, "state", defaultPluginID)

	if err := migrateLegacy(configDir, stateDir); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{configDir, stateDir} {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Errorf("%s exists after migrating without a legacy dir", dir)
		}
	}
}

func TestMigrateLegacyIgnoresLegacyID(t *testing.T) {
	configDir, stateDir := legacyTree(t)
	legacyConfig := filepath.Join(filepath.Dir(configDir), legacyPluginID)
	legacyState := filepath.Join(filepath.Dir(stateDir), legacyPluginID)

	if err := migrateLegacy(legacyConfig, legacyState); err != nil {
		t.Fatal(err)
	}
	assertFile(t, filepath.Join(legacyConfig, "config.toml"), "team_keys = [\"ENG\"]\n", 0o600)
	if _, err := os.Stat(configDir); !os.IsNotExist(err) {
		t.Errorf("%s created while the legacy id is in use", configDir)
	}
}
