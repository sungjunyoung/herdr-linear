# Run targets inside the flake dev shell (direnv `use flake`, or
# `nix develop -c make <target>`), which provides go, golangci-lint and make.

BIN := bin/herdr-linear
NIX := nix --extra-experimental-features 'nix-command flakes'

.PHONY: build test lint fmt link install-app clean

# Builds with nix and copies the binary into ./bin.
#
# The binary is copied out of the nix store on purpose: `herdr plugin install`
# builds in a temporary checkout and then renames it, which would orphan a
# `result` out-link GC root and let `nix-collect-garbage` delete the binary.
build:
	@out=$$($(NIX) build .#default --no-link --print-out-paths) && \
		mkdir -p bin && \
		install -m 0755 "$$out/bin/herdr-linear" $(BIN)

test:
	go test -race ./...
	node --test herdr-app/mods/*/policy.test.mjs

lint:
	golangci-lint run ./...

fmt:
	gofmt -w .

# Registers this working tree as a local herdr plugin. `herdr plugin link`
# does not run [[build]], so build first.
link: build
	herdr plugin link "$(CURDIR)"

# Installs the binary, the mods and the herdr-linear layout into the Herdr
# desktop app, and switches to that layout; rerun after editing a mod.
# An old `linear` layout clone that still shows the linear-title mod is set
# aside, so two mods do not retitle the same spaces; the switch to
# herdr-linear waits a second for the app to read the new layout file.
APP := $(HOME)/.config/herdr-app
APP_MODS := herdr-linear herdr-linear-panel herdr-linear-button
install-app: build
	mkdir -p "$(HOME)/.local/bin"
	install -m 0755 $(BIN) "$(HOME)/.local/bin/herdr-linear"
	rm -f "$(HOME)/.local/bin/herdr-linear-title"
	for m in $(APP_MODS); do \
		rm -rf "$(APP)/mods/$$m" && mkdir -p "$(APP)/mods/$$m" || exit 1; \
		for f in "herdr-app/mods/$$m"/*; do \
			case "$$f" in *.test.mjs) ;; *) cp "$$f" "$(APP)/mods/$$m/" || exit 1 ;; esac; \
		done; \
	done
	rm -rf "$(APP)/mods/linear-title"
	mkdir -p "$(APP)/layouts"
	cp herdr-app/layouts/herdr-linear.json "$(APP)/layouts/herdr-linear.json"
	old="$(APP)/layouts/linear.json"; \
	if [ -f "$$old" ] && grep -q linear-title "$$old"; then \
		sleep 1; \
		herdr-app do layout.switch '{"name":"herdr-linear"}' || true; \
		mv "$$old" "$$old.bak-$$(date +%Y%m%d%H%M%S)"; \
	fi

clean:
	rm -rf bin result
