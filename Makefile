.PHONY: help install build check run run-presenter gen test clean distclean

PDF ?= test/fixtures/sample.pdf
PORT ?= 3000

help:
	@echo "pdf-presenter — developer Makefile"
	@echo ""
	@echo "Targets:"
	@echo "  install       Install dependencies with pnpm"
	@echo "  build         Build the CLI bundle with tsup"
	@echo "  check         Type-check with tsc --noEmit"
	@echo "  run           Build, then serve \$$PDF (default: $(PDF))"
	@echo "  run-presenter Build, then serve \$$PDF and open presenter mode"
	@echo "  gen           Build, then run -gn on \$$PDF"
	@echo "  test          Run vitest"
	@echo "  clean         Remove dist/"
	@echo "  distclean     Remove dist/ and node_modules/"
	@echo ""
	@echo "Variables:"
	@echo "  PDF=path/to/file.pdf    PDF to serve (default: $(PDF))"
	@echo "  PORT=3000               Port to listen on (default: $(PORT))"

install:
	pnpm install

build:
	pnpm build

check:
	pnpm exec tsc --noEmit

run: build
	node dist/pdf-presenter.js $(PDF) -p $(PORT)

run-presenter: build
	node dist/pdf-presenter.js $(PDF) -p $(PORT) --presenter

gen: build
	node dist/pdf-presenter.js -gn $(PDF)

test:
	pnpm test

clean:
	rm -rf dist

distclean: clean
	rm -rf node_modules
