package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/sungjunyoung/herdr-linear/internal/fileutil"
)

// legacyPluginID is the plugin id this project shipped under before the
// rename. herdr keys plugin dirs by id, so its dirs are siblings of ours.
const legacyPluginID = "sungjunyoung.linear-title"

// migrateLegacy copies the legacy plugin's config and state into configDir and
// stateDir, so an existing login keeps working after the rename.
func migrateLegacy(configDir, stateDir string) error {
	return errors.Join(migrateDir(configDir), migrateDir(stateDir))
}

// migrateDir copies the legacy sibling of dir into dir when dir has no
// entries yet. The copy is built next to dir and renamed into place, so a
// failed run leaves dir empty and the next run retries.
func migrateDir(dir string) error {
	dir = filepath.Clean(dir)
	legacy := filepath.Join(filepath.Dir(dir), legacyPluginID)
	if legacy == dir {
		return nil
	}
	info, err := os.Stat(legacy)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if len(entries) > 0 {
		return nil
	}
	tmp, err := os.MkdirTemp(filepath.Dir(dir), "."+filepath.Base(dir)+".migrate-*")
	if err != nil {
		return err
	}
	if err := copyTree(legacy, tmp, info.Mode().Perm()); err != nil {
		_ = os.RemoveAll(tmp)
		return err
	}
	// os.Rename refuses an existing directory target. os.Remove only deletes
	// an empty dir, such as one herdr created.
	if err := os.Remove(dir); err != nil && !errors.Is(err, fs.ErrNotExist) {
		_ = os.RemoveAll(tmp)
		return err
	}
	if err := os.Rename(tmp, dir); err != nil {
		_ = os.RemoveAll(tmp)
		return err
	}
	return nil
}

// copyTree copies the regular files and directories under src into the
// existing directory dst, preserving permission bits.
func copyTree(src, dst string, rootPerm fs.FileMode) error {
	if err := os.Chmod(dst, rootPerm); err != nil {
		return err
	}
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil || path == src {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		switch {
		case d.IsDir():
			if err := os.Mkdir(target, 0o700); err != nil {
				return err
			}
			return os.Chmod(target, info.Mode().Perm())
		case info.Mode().IsRegular():
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			return fileutil.WriteAtomic(target, data, info.Mode().Perm())
		default:
			return nil
		}
	})
}
