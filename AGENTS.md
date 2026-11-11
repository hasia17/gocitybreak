# gocitybreak

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for hasia17/gocitybreak (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Go code

Writing or reviewing Go in `backend/`: follow `.claude/skills/golang-pro/SKILL.md` (the `golang-pro` skill in Claude Code; other agents read the file directly).

Finishing a Go change: run `go fix ./...` in `backend/` and keep its rewrites; CI fails while `go fix` has anything left to change.

The skill is a copy of `golang-pro` from https://github.com/yuriykis/skills. Update it by copying the upstream version over it, so the two stay identical.
