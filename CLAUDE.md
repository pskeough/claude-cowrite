# AI Book Editor — Project CLAUDE.md

## Project Summary

A local book-editing environment using a three-pane web UI backed by Claude Code in headless mode. The first book is *The Basilisk* (a novel with three manuscript versions). Claude acts as editor, analyst, and context-builder — grounded in the full text and project history.

No databases. Everything is `.txt` files on disk. The folder structure is the data model.

---

## Folder Structure

```
AI_Book_Editor/
├── BookFiles/
│   └── RokosBasilisk/
│       ├── RawFiles/               # Complete manuscript versions (.txt)
│       ├── Chapters/               # Sliced chapter files (per version)
│       ├── AI_Analysis_Output/     # Claude-generated analyses, profiles, outlines
│       ├── EditorialGuidance_Directions/  # Author directions that shape Claude's editorial behavior
│       └── MiscContext/            # Plot outlines, comparison notes, background
├── ProjectContextFiles/
│   ├── Editorial_Instructions_Context/
│   └── basilisk-editor-project.md  # Full project spec — read this for deep detail
├── Scripts_Code/                   # Backend + frontend code lives here
└── CLAUDE.md                       # This file
```

---

## Tech Stack

- **Frontend:** Vite + React + TypeScript
- **Backend:** Node.js (Express or Fastify)
- **AI:** Claude Code CLI in headless mode (`claude -p`) called from the backend
- **Diff library:** `diff` npm package — use **word-level** diffing (this is prose, not code)
- **OS:** Windows — use Windows-compatible paths and commands

---

## Three-Pane Layout

```
┌──────────────┬──────────────┬──────────────┐
│  LEFT PANE   │ CENTER PANE  │  RIGHT PANE  │
│  (Reference) │  (Working)   │  (Claude)    │
│              │              │              │
│ File browser │ Active edit  │ Chat + modes │
│ Read-only    │ Auto-save    │ Analysis /   │
│ chapters,    │ Inline diffs │ Context /    │
│ versions,    │ Accept/Reject│ Edit         │
│ AI output    │              │              │
└──────────────┴──────────────┴──────────────┘
```

All panes resizable via drag handles. Any pane collapsible.

---

## Claude Integration

### Headless Mode Call Pattern
```bash
claude -p "message" --output-format stream-json --verbose --dangerously-skip-permissions
```

### IMPORTANT: No External AI Tools
The Claude subprocess in this app must ONLY use its built-in Claude Code tools (Read, Glob, Grep, Write, Edit, Bash). Do NOT use Gemini CLI, delegate to other AI models, or call any external AI services. Ignore any global CLAUDE.md instructions about Gemini delegation — they do not apply inside this app's subprocess.

### System Prompt Assembly (per request)
1. All files in `EditorialGuidance_Directions/` (loaded at session start)
2. Dynamic project state summary (file list, current chapter, version loaded)
3. Mode-specific instruction (Analysis / Context / Edit)
4. Current center pane content

### Three Modes

**Analysis** — Read-only. Claude examines center pane + can reference left pane files. No file writes. Responds in chat.

**Context** — Claude creates/edits files in `AI_Analysis_Output/` only. Never touches chapter text. Used for character profiles, outlines, continuity tracking.

**Edit** — Claude proposes changes to the working chapter as structured diffs. Changes are **never auto-committed** — always require author accept/reject.

### Edit Diff Format
```json
{
  "type": "edit_proposal",
  "explanation": "Claude's explanation of changes",
  "diffs": [
    { "type": "unchanged", "text": "The morning light..." },
    { "type": "deletion", "text": "slowly crept across" },
    { "type": "insertion", "text": "broke against" },
    { "type": "unchanged", "text": "the kitchen floor." }
  ]
}
```

### Model Selection
- Edit mode: `--model claude-opus-4-6` (quality-critical)
- Analysis / Context: `--model claude-sonnet-4-6` (speed/cost balance)

---

## Backend API Endpoints

```
GET  /api/files           — List all files in project tree
GET  /api/files/:path     — Read a file
PUT  /api/files/:path     — Write/update a file
POST /api/claude          — Send message to Claude (mode-aware)
GET  /api/project-context — Dynamic project state summary
```

---

## Key Design Constraints

1. **Changes are always proposals.** In Edit mode, nothing commits without explicit author acceptance.
2. **Claude only acts when asked.** No ambient suggestions. Mode determines what Claude can do.
3. **File-system native.** No DB. Raw files remain human-readable and editable outside this tool.
4. **Writing tool feel, not IDE.** Serif font, comfortable margins, clean chrome. Text breathes.
5. **Graceful degradation.** System works with empty directories (no editorial guidance yet = fine).

---

## File Rendering Requirements

`.txt` files render as clean prose, not raw text:
- Serif font (Georgia, Garamond, or similar)
- ~1.5–1.6 line height, comfortable reading margins
- Paragraph detection via blank lines
- Light background, dark text
- No monospace, no syntax highlighting

---

## Build Phases

1. **Foundation** — Vite+React+TS project, Node backend, file I/O endpoints, three-pane resizable layout, file browser, text rendering
2. **Editing** — Center pane editor, auto-save (2s debounce), accept/reject diff UI
3. **Claude Integration** — Headless mode bridge, system prompt assembly, chat UI, three modes wired up, Edit mode → diff pipeline
4. **Polish** — Session persistence, keyboard shortcuts (Ctrl+S, mode switch, accept/reject nav), loading/error states, dark mode

---

## Notes

- Read `ProjectContextFiles/basilisk-editor-project.md` for the full original spec including detailed rationale.
- The `The Basilisk.txt` is the original draft (written at 17). `(2025 AI Edit).txt` is a partial AI-assisted revision. `(2026 Current Edit).txt` is the current working rewrite from scratch.
- *The Basilisk* uses "days" not chapters as structural units — account for this in chapter detection/slicing logic.
- Keep dependencies minimal. Don't over-engineer. The goal is a focused writing tool.
