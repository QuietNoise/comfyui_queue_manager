# Project Analysis: ComfyUI Queue Manager

## Overview

**ComfyUI Queue Manager** is a custom node extension for [ComfyUI](https://github.com/comfyanonymous/ComfyUI) that replaces the native prompt queue with a persistent, feature-rich queue management system. It provides pause/resume, archiving, export/import, filtering, and a dedicated GUI for managing large numbers of queued workflows.

---

## Technology Stack

### Backend (Python)

| Component | Technology |
|-----------|-----------|
| Language | Python 3.9+ (target-version in [`pyproject.toml`](../pyproject.toml:63)) |
| Framework | ComfyUI custom node extension (hooks into `server.PromptServer` and `execution.PromptQueue`) |
| HTTP | aiohttp (ComfyUI's built-in web server) |
| Database | SQLite3 with WAL mode, thread-local connections via `threading.local()` |
| Linting/Formatting | Ruff (linter + formatter), mypy (strict mode) |
| Testing | pytest + coverage |
| Pre-commit | ruff-pre-commit hook |

### Frontend (JavaScript / React)

The frontend has **two layers** that communicate via `postMessage`:

#### 1. Loader Layer (`web/queue-manager.js`)

- **Language**: Vanilla JavaScript (ES modules)
- **Role**: Registers as a ComfyUI frontend extension, adds UI elements (pause/stop buttons, sidebar tab), relays ComfyUI events to the iframe via `postMessage`
- **Integration**: Uses ComfyUI's `app.registerExtension()` API, hooks into `app.api` event system, monkey-patches `app.api.queuePrompt`

#### 2. GUI Layer (`src/gui/`)

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 15.3.8 (App Router) |
| UI Library | React 19 |
| Styling | Tailwind CSS v4 + SCSS modules |
| Icons | Lucide React |
| Linting | ESLint (next/core-web-vitals) |
| Build | Turbopack (dev), `next build` (prod) |

---

## Architecture

### Pattern: Monkey-Patching / Hijacking

The core architectural pattern is **monkey-patching** ComfyUI's native `PromptQueue` class. [`QM_Queue`](../src/comfyui_queue_manager/qm_queue.py:13) hijacks 5 methods:

| Hijacked Method | Purpose |
|----------------|---------|
| `PromptQueue.get()` | Intercept item retrieval; implement pause; restore queue from DB |
| `PromptQueue.put()` | Intercept new items; persist to SQLite; manage native queue size |
| `PromptQueue.get_current_queue()` | Return paginated data from DB instead of native heap |
| `PromptQueue.get_tasks_remaining()` | Return count from DB |
| `PromptQueue.task_done()` | Mark item as finished in DB |

### Data Flow

```
User clicks "Queue" in ComfyUI
  → app.api.queuePrompt() [hijacked to inject workflow name]
  → PromptServer puts item
    → QM_Queue.queue_put() persists to SQLite
    → If not paused and native queue empty, pushes highest-priority item to native heap
  → PromptServer.get() calls QM_Queue.queue_get()
    → Checks pause lock
    → Pulls next item from DB, pushes to native heap
    → Calls original get(), marks item as "running" in DB
  → On completion, QM_Queue.task_done() marks item as "finished" in DB
```

### Frontend Communication

```
ComfyUI Parent Window                    Iframe (Next.js App)
  │                                            │
  ├─ app.api events ──postMessage─────────────►│
  │  (status, execution_start,                  │
  │   executing, queue-updated)                 │
  │                                            │
  │◄─────────── postMessage ────────────────────┤
  │  (QM_LoadWorkflow,                          │
  │   QM_QueueManager_Hello)                    │
  │                                            │
  │◄─── fetch /queue_manager/* ────────────────►│
  │    (REST API calls for queue CRUD)          │
```

### Database Schema

SQLite database at `data/qm-queue.db` with two tables:

- **`queue`**: Stores all queue items with fields: `id`, `prompt_id`, `created_at`, `updated_at`, `number` (priority), `name` (workflow name), `workflow_id`, `prompt` (JSON blob), `status` (0=pending, 1=running, 2=finished, 3=archived)
- **`options`**: Key-value store for extension settings (queue paused state, takeover client)

### API Routes

Custom aiohttp routes under `/queue_manager/*`:

| Route | Method | Purpose |
|-------|--------|---------|
| `/queue_manager/queue` | GET | Get paginated queue items |
| `/queue_manager/queue` | DELETE | Delete items from queue/archive/completed |
| `/queue_manager/archive` | POST | Archive specific items |
| `/queue_manager/archive-queue` | GET | Archive all pending items |
| `/queue_manager/play` | POST | Play items from archive |
| `/queue_manager/play-archive` | POST | Play all archived items |
| `/queue_manager/toggle` | GET | Toggle pause/resume |
| `/queue_manager/playback` | GET | Get playback status |
| `/queue_manager/version` | GET | Get extension version |
| `/queue_manager/import` | POST | Import queue from file |
| `/queue_manager/export` | GET | Export queue to file |
| `/queue_manager/takeover` | GET | Take over client focus |
| `/queue_manager/poke_status` | GET | Trigger queue status update |

Plus middleware hooks into native `/api/queue` (POST) and `/api/interrupt` (POST).

---

## Project Structure

```
comfyui_queue_manager/
├── src/
│   ├── comfyui_queue_manager/       # Python backend
│   │   ├── __init__.py              # Empty (package marker)
│   │   ├── helpers.py               # Utility functions
│   │   ├── nodes.py                 # Custom ComfyUI nodes (WorkflowName)
│   │   ├── qm_db.py                 # Database layer
│   │   ├── qm_options.py            # Key-value options store
│   │   ├── qm_queue.py              # Core queue logic (hijacks)
│   │   ├── qm_server.py             # API routes + middleware
│   │   ├── queue_manager.py         # Orchestrator class
│   │   └── inc/
│   │       └── exceptions.py        # Custom exceptions
│   └── gui/                         # Next.js frontend app
│       ├── app/
│       │   ├── layout.js            # Root layout (state management, tabs, API calls)
│       │   ├── page.js              # Home page (scaffolding)
│       │   ├── globals.scss         # Global styles
│       │   └── page.module.scss     # Page styles
│       ├── components/
│       │   └── Queue.js             # Queue table component
│       └── internals/
│           ├── app-context.js       # React context
│           ├── config.js            # Base URL config
│           └── functions.js         # API call helper
├── web/                             # Frontend loader layer
│   ├── queue-manager.js             # Main extension script
│   ├── .gui/                        # Built Next.js output
│   ├── js/
│   │   ├── config.js                # Environment config
│   │   ├── functions.js             # postMessage helpers
│   │   └── archive.js               # (unused/legacy)
│   └── styles/
│       └── manager.css              # Sidebar tab styles
├── tests/                           # Python tests
├── pyproject.toml                   # Python project config
└── .pre-commit-config.yaml          # Pre-commit hooks
```

---

## Key Design Decisions

1. **Persistence via SQLite**: The native ComfyUI queue is in-memory only. This extension adds SQLite persistence so the queue survives restarts and crashes.

2. **Monkey-patching over forking**: Rather than forking ComfyUI's codebase, the extension hijacks specific methods at runtime. This maximizes compatibility with upstream ComfyUI updates but creates tight coupling to internal APIs.

3. **Iframe isolation**: The rich GUI runs in an iframe, isolating it from ComfyUI's DOM and CSS. Communication happens via `postMessage` and REST API calls.

4. **Single-item native queue**: To avoid performance bottlenecks with large queues, only one item is kept in the native heap at a time. The rest are managed in SQLite.

5. **Pause mechanism**: Uses a `threading.Condition` lock to pause/resume queue execution without losing state.

---

## Code Style Summary

### Python
- **Indentation**: 4 spaces (per EditorConfig)
- **Quotes**: Double quotes (enforced by ruff)
- **Line length**: 140 characters
- **Naming**: `snake_case` for functions/variables, `PascalCase` for classes, `UPPER_CASE` for constants
- **Type hints**: Used but not consistently; mypy strict mode enabled
- **Imports**: Standard library first, then third-party, then local
- **Logging**: `logging` module with `[Queue Manager]` prefix
- **Docstrings**: Present on classes, minimal on methods

### JavaScript
- **Indentation**: 2 spaces (per EditorConfig)
- **Quotes**: Mixed (single and double)
- **Naming**: `camelCase` for functions/variables, `PascalCase` for components
- **Modules**: ES modules with `import`/`export`
- **Async**: `async/await` pattern
- **Semicolons**: Used consistently

### SCSS/CSS
- **Nesting**: SCSS nesting used
- **Variables**: SCSS variables + CSS custom properties
- **Dark mode**: `@media (prefers-color-scheme: dark)` queries
- **Naming**: Descriptive class names, some BEM-like patterns
