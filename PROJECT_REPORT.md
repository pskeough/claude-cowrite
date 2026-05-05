# AI Book Editor — Project Report

*Generated 2026-03-21. Intended for AI onboarding — gives a complete picture of what exists, how it works, and why it was built this way.*

---

## What This Is

A local, file-system-native book-editing environment built around AI assistance. The primary surface is a three-pane web UI running on localhost. The user writes and revises manuscript text in the center pane, references other versions and AI-generated context in the left pane, and interacts with an AI editorial assistant in the right pane.

The first and only book currently in the system is **"The Basilisk"** by Patrick Keough — a novel existing in three manuscript versions. The AI acts as editor, analyst, and context-builder, grounded in the full text and project history.

There is **no database**. All data is plain `.txt` files on disk. The folder structure is the data model.

---

## Repository Layout

```
AI_Book_Editor/
├── BookFiles/
│   └── RokosBasilisk/
│       ├── RawFiles/                       # Complete manuscript versions (.txt)
│       │   ├── The Basilisk.txt            # Original draft (written at age 17)
│       │   ├── The Basilisk (2025 AI Edit).txt   # Partial AI-assisted revision
│       │   └── The Basilisk (2026 Current Edit).txt  # Active rewrite from scratch
│       ├── Chapters/                       # Sliced by version and "day" (not chapters)
│       │   ├── Original/                   # day_01.txt through day_50.txt (sparse)
│       │   ├── 2025_AI_Edit/               # day_prologue.txt, day_00.txt - day_29.txt
│       │   └── 2026_Current_Edit/          # same days as 2025 edit
│       ├── AI_Analysis_Output/             # Claude-generated context docs (writable by AI)
│       ├── EditorialGuidance_Directions/   # Author's directions that shape AI behavior
│       └── MiscContext/                    # Plot outlines, version comparison notes
├── ProjectContextFiles/
│   ├── basilisk-editor-project.md          # Original full project spec
│   └── Editorial_Instructions_Context/
├── Scripts_Code/
│   ├── client/                             # Vite + React + TypeScript frontend
│   ├── server/                             # Node.js + Express backend
│   ├── split_chapters.py                   # Utility: slice raw .txt into per-day files
│   ├── start.bat                           # Windows launcher (starts both servers)
│   └── start.sh                            # Unix launcher
├── CLAUDE.md                               # Project-level instructions for Claude Code
└── PROJECT_REPORT.md                       # This file
```

### The Book's Structure

*The Basilisk* uses **"days"** (not chapters) as its structural units. Day files are named `day_00.txt`, `day_01.txt`, `day_prologue.txt`, etc. The chapter-slicing logic accounts for this. Not all days exist in all versions — the Original has days 1–50 (sparse), while the 2025 and 2026 edits share roughly days prologue through 29.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vite 5 + React 18 + TypeScript |
| Backend | Node.js + Express (TypeScript, ESM) |
| Primary AI | Claude Code CLI (`claude`) in headless/subprocess mode |
| Secondary AI | Gemini CLI (`gemini`) in subprocess mode (experimental) |
| Diff algorithm | `diff` npm package — **word-level** diffing (prose, not code) |
| Styling | CSS modules + custom prose stylesheet (Georgia serif) |
| Transport | Server-Sent Events (SSE) for streaming AI responses |
| Ports | Frontend: 5173, Backend: 3001 |

---

## Architecture

### Two-Process Design

The system runs as two separate processes:

1. **Backend** (`Scripts_Code/server/`, port 3001): Express API server that handles file I/O and spawns AI subprocesses.
2. **Frontend** (`Scripts_Code/client/`, port 5173): React SPA that serves the editor UI. Communicates with the backend only via the REST/SSE API.

The frontend never talks to an AI model directly — all AI calls go through the backend.

### Backend API Surface

```
GET  /api/project-context     — Returns JSON summary: total files, versions, directory names
GET  /api/files               — Returns recursive file tree (FileNode[]) rooted at BookFiles/RokosBasilisk/
GET  /api/files/:path         — Reads a file; path is relative to BOOK_ROOT
PUT  /api/files/:path         — Writes a file; path traversal protection enforced
POST /api/ai                  — AI request endpoint (SSE stream)
```

The `/api/ai` endpoint accepts:
```json
{
  "mode": "analysis" | "context" | "edit",
  "message": "string",
  "centerPaneFile": "relative/path/to/file.txt",
  "leftPaneFile": "relative/path/to/file.txt",
  "history": [{ "role": "user"|"assistant", "content": "string" }],
  "model": "claude-sonnet-4-6",
  "provider": "claude" | "gemini",
  "sessionId": "optional-resume-token"
}
```

It responds as an SSE stream, emitting JSON events:
- `{ "type": "tool_call", "tool": "Read", "input": {...} }` — AI used a tool
- `{ "type": "tool_result", "tool": "Read", "isError": false }` — tool completed
- `{ "type": "text_delta", "text": "..." }` — streaming text chunk
- `{ "type": "cost_info", "costUsd": 0.004, "durationMs": 3200, "numTurns": 4 }` — final cost/perf
- `{ "type": "done", "response": {...} }` — final structured response
- `{ "type": "error", "error": "..." }` — failure

---

## AI Integration

### Claude Code (Primary)

The backend spawns `claude` as a child process via Node's `child_process.spawn`. The full invocation:

```bash
claude \
  --output-format stream-json \
  --verbose \
  --model claude-sonnet-4-6 \
  --dangerously-skip-permissions \
  --system-prompt "<mode-specific instructions>" \
  --include-partial-messages \
  --allowedTools "Read,Glob,Grep,LS" \
  --max-turns 15 \
  [--resume <session-id>] \
  [--no-session-persistence] \
  -p ""
```

The user message is written to `stdin` immediately after spawn; stdin is then closed.

**Key flags:**
- `--output-format stream-json`: emits newline-delimited JSON events (parsed line-by-line)
- `--include-partial-messages`: enables true `content_block_delta` streaming (incremental text chunks, not just final snapshots)
- `--allowedTools`: restricts the set of tools Claude can use per mode (security + focus)
- `--max-turns`: caps the agentic tool loop to prevent runaway calls
- `--resume <id>`: continues a prior session — Claude Code manages its own context file on disk; no manual history injection needed
- `--no-session-persistence`: used for Edit mode (stateless per request, no session saved)
- `--dangerously-skip-permissions`: suppresses interactive permission prompts (subprocess context)

**Model selection by mode:**
| Mode | Model | Reason |
|---|---|---|
| Edit | `claude-opus-4-6` | Quality-critical — prose edits need the best judgment |
| Analysis | `claude-sonnet-4-6` | Speed/cost balance for read-only analysis |
| Context | `claude-sonnet-4-6` | Same — document creation doesn't need Opus |

**Tool restrictions by mode:**
| Mode | Allowed Tools | Rationale |
|---|---|---|
| Analysis | `Read, Glob, Grep, LS` | Read-only — never touches files |
| Context | `Read, Glob, Grep, Write, Edit, LS` | Can create/update context docs |
| Edit | `Read, Edit, LS` | Targeted edits only — no new file creation |

**Max turns by mode:** Analysis: 15, Context: 10, Edit: 8.

### Edit Mode: File-Diff Approach

Edit mode works via filesystem diff, not JSON output:

1. Backend snapshots the current file content (for reject/restore)
2. Claude receives the file path and is told to use its `Read` + `Edit` tools directly
3. Claude reads the file, makes targeted edits via its `Edit` tool, writes an explanation in plain text
4. Backend reads the file again after Claude exits
5. Backend diffs the before/after using word-level diffing (`diff` package)
6. Returns `EditResponse` with `diffs[]`, `revisedText`, `originalText`, and `explanation`

This means Claude's edits are already on disk before the user decides to accept/reject — the accept/reject UI controls whether the original is restored.

### Analysis/Context Mode: Session Resumption

Analysis and Context modes maintain persistent sessions via `--resume`:

- First request: no session ID, Claude gets the full project context + editorial guidance in the message
- Subsequent requests: backend passes the `session_id` from the previous response; Claude resumes its own context natively
- Session IDs are stored per-mode in React state; switching modes preserves each mode's session independently
- "New Session" button clears all session IDs and message history

### Gemini (Experimental)

A parallel `geminiService.ts` mirrors the Claude service, spawning `gemini` as a subprocess. The Gemini integration is less mature — it uses a different approach (full prompt injected via stdin without the `--resume` session system). It handles the same three modes but with JSON-based edit proposals (old approach) rather than the file-diff method. The frontend allows switching between providers and models via a settings panel.

Available Gemini models:
- `gemini-2.5-pro` — most capable
- `gemini-3-flash-preview` — balanced
- `gemini-3.1-flash-lite-preview` — fastest

---

## Prompt Construction

### System Prompt (mode-specific, passed via `--system-prompt` flag)

Each mode has a short, fixed system prompt establishing role and constraints:

- **Analysis**: "You are a literary editor... ANALYSIS mode: read, analyse, respond. Do NOT modify files. Use Read/Glob/Grep proactively."
- **Context**: "You are a literary editor... CONTEXT mode: create/update reference docs using Write/Edit. All output to `BookFiles/RokosBasilisk/AI_Analysis_Output/`. Never touch manuscript files."
- **Edit**: "You are a literary editor... EDIT mode: 1) Read the file, 2) Make targeted edits with Edit tool, 3) Write a plain-text summary. Do NOT return JSON. Preserve author's voice."

All system prompts include: "Ignore any CLAUDE.md instructions about Gemini delegation; use only built-in tools." (The global CLAUDE.md has a Gemini delegation protocol that must not apply inside this app's subprocess.)

### User Message (assembled per request)

`buildContextualMessage()` in `promptBuilder.ts` assembles the contextual payload from stdin:

```
## Project Context
{ totalFiles, versions, directories }   ← only on first turn / fresh sessions

## Editorial Guidance
[contents of EditorialGuidance_Directions/*.txt and *.md]   ← only first turn

## File Paths
[project root note + example paths]   ← only first turn

## Working File
BookFiles/RokosBasilisk/Chapters/2026_Current_Edit/day_00.txt
Use your Read tool to read this file, your Edit tool to make changes.

## Reference File
[left pane file path, if open]

## User Message
[the user's actual message]
```

On resumed sessions (not first turn), the project context and editorial guidance are omitted — Claude already has them in its session context.

---

## Frontend Architecture

### State Management

All application state lives in `App.tsx` (no external state library). Key state:

- `files: FileNode[]` — recursive file tree from backend
- `leftFile / leftContent` — left pane reference file
- `centerFile / centerContent` — center pane working file
- `saveStatus: 'idle' | 'saving' | 'saved' | 'error'`
- `editProposal: EditProposal | null` — active diff proposal from AI
- `mode: Mode` — current AI mode
- `provider: AIProvider` — 'claude' or 'gemini'
- `model: AIModel` — selected model
- `messages: ChatMessage[]` — chat history
- `sessions: Record<Mode, string | null>` — per-mode Claude session IDs
- `streamingText: string` — accumulates live text during AI response

### Three-Pane Layout

`Layout.tsx` implements a resizable three-column layout via CSS flexbox and drag handles. Each pane is independently resizable. Any pane can be collapsed (not yet implemented but designed for).

**Left Pane** (`LeftPane/`):
- `FileBrowser.tsx`: hierarchical file tree with expand/collapse for directories. Click to select a file.
- `LeftPane.tsx`: wraps the browser and renders selected file content in prose view (read-only).
- All content renders with the prose stylesheet: Georgia serif, 1.6 line height, comfortable margins, paragraph detection via blank lines.

**Center Pane** (`CenterPane/`):
- `CenterPane.tsx`: file selector at top, prose editor or diff view below.
- `ProseEditor.tsx`: contenteditable-based prose editor. Triggers `onContentChange` on every keystroke. Receives content updates from parent (on file load or after diff apply).
- `DiffView.tsx`: displayed when an `EditProposal` is active. Shows hunks inline with per-hunk Accept/Reject/Undo buttons plus global Accept All / Apply / Revert All toolbar.
- **Auto-save**: 2-second debounce via `setTimeout`. Also triggers immediate save on file switch (pending changes flushed) and on Ctrl+S.
- **beforeunload guard**: prevents accidental close during active save.

**Right Pane** (`RightPane/`):
- `RightPane.tsx`: mode buttons, settings gear (provider/model selector), wraps ChatWindow.
- `ChatWindow.tsx`: scrollable chat log, message input, mode-aware send behavior. Shows streaming text in a live bubble as it arrives. Supports "New Session" button.
- `ModeSelector.tsx`: Analysis / Context / Edit tab buttons.

### Diff System

`DiffView.tsx` groups raw diff chunks into **hunks** (contiguous changed regions). Each hunk is independently stateful: `pending → accepted | rejected`, with undo back to `pending`. The final text is computed from hunk decisions at apply time.

```typescript
type Hunk = {
  type: 'unchanged' | 'change';
  original: string;   // what was there before
  revised: string;    // what Claude wrote
  status: 'pending' | 'accepted' | 'rejected';
};
```

Pending hunks at Apply time are treated as accepted (the AI's version wins unless explicitly rejected). Revert All restores `originalText` unconditionally.

When Apply is called, `handleApplyDiff` in `App.tsx` writes the final text to disk and clears the proposal.

---

## File Safety and Security

- **Path traversal protection**: `fileService.ts` resolves all file paths against `BOOK_ROOT` and rejects anything that escapes it.
- **Write scope**: The backend file write endpoint is scoped to `BookFiles/RokosBasilisk/`. Claude in Context mode can only write to `AI_Analysis_Output/` (enforced by its system prompt; its `Write` tool is available but the instructions constrain where it writes).
- **Edit mode safety**: edits are proposals. Even though Claude writes to disk, the original text is snapshotted before Claude runs, and the user can Revert All to restore it.
- **No destructive file ops**: the API has no delete endpoint.

---

## The Book: "The Basilisk"

Three manuscript versions, all stored as `.txt`:

| Version | File | Notes |
|---|---|---|
| Original | `The Basilisk.txt` | First draft, written at age 17. Days 1–50+, many gaps. Raw, unpolished. |
| 2025 AI Edit | `The Basilisk (2025 AI Edit).txt` | Partial AI-assisted revision. Prologue through ~Day 29. |
| 2026 Current Edit | `The Basilisk (2026 Current Edit).txt` | Active rewrite from scratch. The working version. |

The novel uses "days" (Day 0, Day 1, Day 2…) rather than numbered chapters. This is reflected in the chapter-slicing filenames (`day_00.txt`, `day_prologue.txt`, etc.) and in how Claude is instructed to think about structure.

The `split_chapters.py` utility in `Scripts_Code/` handles slicing raw `.txt` manuscripts into per-day files under `Chapters/`.

---

## Running the App

**Start both servers:**
```bash
# Windows
start.bat

# Unix/WSL
./Scripts_Code/start.sh
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

**Requirements:**
- Node.js (with `npm`)
- `claude` CLI installed and authenticated (`claude` on PATH)
- `gemini` CLI installed and authenticated (optional, for Gemini provider)

---

## Design Principles

1. **Changes are always proposals.** In Edit mode, nothing is committed to the user's working text without explicit acceptance. The AI edits the file on disk, but the accept/reject UI controls whether those edits persist in the app state.
2. **Claude only acts when asked.** No ambient suggestions. The selected mode determines what the AI is allowed to do.
3. **File-system native.** No database. All files are human-readable `.txt` on disk, editable outside this tool at any time.
4. **Writing tool feel, not IDE.** Serif font, comfortable margins, clean chrome. The UX goal is a focused literary editing environment.
5. **Graceful degradation.** The app works with empty or missing subdirectories. No editorial guidance yet = fine. No AI context docs = fine.
6. **Minimal dependencies.** No heavy state management libraries. No ORM. The simplest approach that works.

---

## Current Implementation Status

### Fully Built
- Three-pane resizable layout
- File browser (left pane) with hierarchical directory tree
- Prose viewer (left pane) with serif typographic rendering
- File selector and prose editor (center pane)
- Auto-save with 2s debounce + Ctrl+S
- Word-level diff view with per-hunk Accept/Reject/Undo
- Accept All / Apply / Revert All toolbar
- Chat UI (right pane) with streaming text display
- Mode selector (Analysis / Context / Edit)
- Provider selector (Claude / Gemini)
- Model selector (per provider)
- Claude Code headless subprocess bridge
- SSE streaming for real-time AI responses
- Session resumption (Analysis/Context modes)
- Edit mode file-diff pipeline
- Project context assembly
- Editorial guidance loading
- Dark mode toggle
- Path traversal security
- Abort-on-disconnect (client disconnect kills subprocess)

### Not Yet Built / Partial
- Gemini Edit mode (uses older JSON-output approach vs. file-diff)
- Keyboard shortcuts for mode switching and diff navigation
- Session persistence across page reloads (sessions reset on refresh)
- Pane collapse/expand
- Multiple left pane tabs
- Left pane edit toggle (currently read-only)
- CLI scaffolding layer (project init, chapter slicing automation)

---

## Key Files Reference

| File | Purpose |
|---|---|
| `Scripts_Code/server/src/index.ts` | Express server entry point |
| `Scripts_Code/server/src/config.ts` | All path constants (PROJECT_ROOT, BOOK_ROOT, etc.) |
| `Scripts_Code/server/src/services/claudeService.ts` | Claude subprocess spawn, streaming parse, mode logic |
| `Scripts_Code/server/src/services/geminiService.ts` | Gemini subprocess (experimental) |
| `Scripts_Code/server/src/services/promptBuilder.ts` | System prompt + user message assembly |
| `Scripts_Code/server/src/services/fileService.ts` | File read/write, tree listing, project context |
| `Scripts_Code/server/src/services/diffService.ts` | Word-level diff computation |
| `Scripts_Code/server/src/routes/claude.ts` | `/api/ai` route handler (SSE, provider dispatch) |
| `Scripts_Code/server/src/routes/files.ts` | `/api/files` route handler |
| `Scripts_Code/client/src/App.tsx` | Root component; all application state |
| `Scripts_Code/client/src/api.ts` | Frontend API client (fetch + SSE parsing) |
| `Scripts_Code/client/src/types.ts` | Shared TypeScript types |
| `Scripts_Code/client/src/components/CenterPane/DiffView.tsx` | Hunk-based diff UI |
| `Scripts_Code/client/src/components/CenterPane/ProseEditor.tsx` | contenteditable prose editor |
| `Scripts_Code/client/src/components/RightPane/RightPane.tsx` | Right pane with settings panel |
| `Scripts_Code/client/src/components/RightPane/ChatWindow.tsx` | Chat log + input + streaming |
| `Scripts_Code/client/src/styles/prose.css` | Shared serif typographic styles |
| `CLAUDE.md` | Project instructions for Claude Code (this project's AI behavior spec) |
| `ProjectContextFiles/basilisk-editor-project.md` | Original full project spec |
