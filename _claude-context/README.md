# Claude Context Folder

This folder is maintained by Claude (Cowork mode) to preserve project context across conversation compactions.

## How it works
- Before or during auto-compaction, Claude saves a timestamped snapshot of all relevant project state, decisions, and in-progress work here.
- At the start of a new session, Claude should read the most recent snapshot file to restore full context.
- Files are named: `context_YYYY-MM-DD_HHMM.md`

## For Claude (instructions to self)
When starting a new conversation in this project:
1. Read the most recent file in this folder first
2. Treat it as ground truth for project state
3. Update memory files in `.auto-memory/` to match

When nearing context limit or before compaction:
1. Write a new snapshot file here with the current timestamp
2. Include: all active files, current state, pending tasks, key decisions, credentials locations, and anything non-obvious
