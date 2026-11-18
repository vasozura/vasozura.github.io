# Agents working on this repository

Two AI agents work here for the owner (Vaso):

- **Codex**, which runs locally on the owner's PC. It owns the application code, the importers, the karaoke and learning pipelines, and the local archive in `D:\ComposerArchive`.
- **Claude**, the owner's business agent, which runs in the cloud and on a weekly schedule. It owns `public/data/portfolio.json` and `public/covers/`. That covers catalog order, hidden duplicates, the video list, Spotify and Apple Music links, and covers. It also manages the YouTube, Spotify and DistroKid work and the domain.

## Who directs the work

**Claude is the coordinator.** Claude writes and prioritises the tasks in `docs/AGENT_TASKS.md`, and Codex carries them out in the order listed. Codex does not start large work of its own: when it finds something worth doing, it adds a task proposal marked `proposed by Codex` and waits until Claude or the owner accepts it. The owner (Vaso) can override anything. Production-data changes and anything that is published still need his explicit approval.

## Rules for both

1. Run `git pull --ff-only` before starting work. Push small commits, and push soon after making them, because the other agent may also push to `main`.
2. Read `HANDOFF.md` first, then `docs/AGENT_TASKS.md`. Each agent takes only tasks marked for it, or tasks marked "either". Mark a task in progress before starting it and done when it is finished, giving the date and commit.
3. Do not edit files the other agent owns. To change them, add a task for the owner of the file to `docs/AGENT_TASKS.md` instead.
   - Only Codex changes `src/` and `scripts/`, unless the owner approves otherwise.
   - Only Claude changes `public/data/portfolio.json` and `public/covers/`.
4. Do not delete or rewrite rows in the production database without the owner's explicit approval. Imports arrive as drafts. Publishing is a separate step that the owner approves.
5. Never commit secrets. The service-role key lives only on the owner's PC: it is DPAPI-encrypted in `%LOCALAPPDATA%\ZuraSite`, or set in a session environment variable.
6. When you finish a session, append a short dated note to `HANDOFF.md` saying what changed and what is next.
