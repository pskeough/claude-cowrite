# ClaudeCowrite

A local book-editing environment featuring a three-pane web UI backed by Claude Code in headless mode. Claude acts as a collaborative editor, analyst, and context-builder, deeply grounded in the full manuscript text and project history.

Built completely around flat `.txt` files on disk, this architecture requires no databases. The folder structure itself functions as the data model.

## Core Features

- **Three-Pane Interface:** Reference files on the left, an active editor in the center, and a dedicated Claude interaction panel on the right.
- **Headless AI Integration:** Communicates with the Claude CLI natively, securely passing context without reliance on external tools.
- **Three Operational Modes:**
  - **Analysis:** Read-only inspection of the center pane with file referencing.
  - **Context:** Generates profiles, outlines, and continuity trackers in designated output directories.
  - **Edit:** Proposes changes to the active chapter via structured diffs (accept/reject workflow).
- **Graceful Degradation:** The system operates effectively even with empty directories or minimal editorial guidance.

## Architecture

- **Frontend:** React, TypeScript, and Vite.
- **Backend:** Node.js managing file I/O operations and Claude CLI subprocesses.
- **Diffing:** Word-level differential analysis for accurate prose comparison.

*Note: Developed as a portfolio project. See the [CLAUDE.md](CLAUDE.md) for deeper technical architecture details.*
