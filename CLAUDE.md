# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

utmimic is an early-stage project for tinkering with drone flight software ideas and technologies. Most of the repository is currently scaffolding rather than implemented flight software:

- `database/` — currently empty; reserved for future database-related work.
- `documentation/` — an Astro + Starlight documentation site (the only buildable code in the repo today). It has its own `documentation/CLAUDE.md` and `documentation/AGENTS.md` (identical content) — read those when working inside that directory, since they take precedence for that subtree.

Because the flight-software side of the project has not been built out yet, do not assume architecture, modules, or conventions beyond what is described here — confirm with the user before making structural decisions.

## Working in `documentation/`

The docs site is a standard Starlight starter. Run commands from `documentation/` (it uses `bun`):

| Command | Action |
| --- | --- |
| `bun install` | Install dependencies |
| `bun dev` | Start local dev server at `localhost:4321` |
| `bun build` | Build production site to `documentation/dist/` |
| `bun preview` | Preview a production build locally |
| `bun astro ...` | Run Astro CLI commands (e.g. `astro add`, `astro check`) |

When starting the dev server, run it in background mode (`astro dev --background`) and manage it with `astro dev stop` / `astro dev status` / `astro dev logs`, per `documentation/CLAUDE.md`.

Docs content lives under `documentation/src/content/docs/` as `.md`/`.mdx` files, routed by file path; the sidebar is configured explicitly in `documentation/astro.config.mjs`. There's currently an "Architecture" section (`architecture/overview.md`, which points at an architecture diagram exported from `documentation/_diagrams/utmimic-architecture.drawio`) and an auto-generated "Reference" section.

Full Starlight/Astro docs: https://docs.astro.build

## Docker / container images

The project is expected to grow into multiple modules, each with its own tech stack and its own container image (`documentation/` is the first example). Conventions for every module:

- **Per-module files**: each module directory gets its own `dockerfile` and `build-docker.sh`, following the pattern in `documentation/dockerfile` and `documentation/build-docker.sh` — a multi-stage build (build stage in the appropriate toolchain image, slim runtime stage for serving/running) and a small build script that builds and pushes to the registry. Don't introduce a shared/root build script — copy and adapt the per-module pattern instead.
- **Registry**: images are built and pushed to the local network registry `mnserver.internal:5000`. It's a plain HTTP (insecure) registry that's already configured as trusted on the Docker daemons that need it — don't add insecure-registry setup steps or assume TLS.
- **Image naming**: `mnserver.internal:5000/utmimic-<module-name>:latest` (e.g. `utmimic-documentation`), matching the existing script's `REGISTRY`/`IMAGE_NAME`/`IMAGE_TAG` variables.
- **Tagging**: `latest` only for now — no git-SHA or semver tagging scheme yet.
- **No local `docker run`**: local development happens in WSL2, where Docker is only used to build and push images — never to run containers locally. Use each module's native dev workflow (e.g. `bun dev` for the docs site) for local testing/iteration. Docker builds are a deployment step: images get pushed to the registry and then pulled/run on a separate Kubuntu server. Don't suggest or run `docker run` as a way to test changes in this environment.
