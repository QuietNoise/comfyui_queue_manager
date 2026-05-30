# Agents Guide: ComfyUI Queue Manager

This document defines coding conventions, architectural patterns, and best practices for contributing to the ComfyUI Queue Manager project. Follow these guidelines to maintain consistency with the existing codebase.

---

## 1. Project Overview

- **Type**: ComfyUI custom node extension (Python backend + JavaScript/React frontend)
- **Backend**: Python 3.9+, aiohttp, SQLite3
- **Frontend Loader**: Vanilla JS (ES modules) — ComfyUI extension layer
- **Frontend GUI**: Next.js 15 (App Router) + React 19 + Tailwind CSS v4 + SCSS
- **Build**: setuptools (Python), Next.js build (frontend)
- **Linting**: Ruff (Python), ESLint (JS/JSX)
- **Testing**: pytest (Python)

---

## 2. Python Backend Conventions

### 2.1 Code Style

- **Indentation**: 4 spaces (configured in [`.editorconfig`](../.editorconfig:14))
- **Line length**: 140 characters (configured in [`pyproject.toml`](../pyproject.toml:61))
- **Quotes**: Double quotes (`"`) for all strings (enforced by `ruff` flake8-quotes rule)
- **Naming**:
  - Classes: `PascalCase` — e.g., [`QM_Queue`](../src/comfyui_queue_manager/qm_queue.py:13), [`QM_Server`](../src/comfyui_queue_manager/qm_server.py:12)
  - Functions/methods: `snake_case` — e.g., [`get_current_queue()`](../src/comfyui_queue_manager/qm_queue.py:66), [`toggle_playback()`](../src/comfyui_queue_manager/qm_queue.py:322)
  - Constants: `UPPER_CASE` — e.g., [`DB_PATH`](../src/comfyui_queue_manager/qm_db.py:4)
  - Private methods: prefix with `_` (e.g., `_illegal` in [`helpers.py`](../src/comfyui_queue_manager/helpers.py:7))

### 2.2 Imports

Order imports in three groups separated by blank lines:

```python
# 1. Standard library
import json
import logging
import threading
from pathlib import Path
from typing import Optional

# 2. Third-party
from aiohttp import web
from server import PromptServer

# 3. Local application
from .helpers import sanitize_filename
from .qm_db import get_conn, read_query
```

### 2.3 Type Hints

Use type hints consistently. The project has `mypy` strict mode enabled (see [`pyproject.toml`](../pyproject.toml:48-51)):

```python
def get_conn() -> sqlite3.Connection: ...
def read_query(query: str, params: tuple = ()) -> list: ...
def get_current_queue(
    self,
    page: int = 0,
    page_size: int = 0,
    route: str = "queue",
    filters: dict | None = None,
    return_meta: bool = False,
) -> tuple: ...
```

### 2.4 Logging

Use the `logging` module with the `[Queue Manager]` prefix for all log messages:

```python
import logging

logging.info("[Queue Manager] Queue status: %s", "not paused" if not self.paused else "paused")
logging.info("[Queue Manager] Workflow queued: %s at %s", item[1], item[0])
```

**Rule**: Use lazy formatting (`%s` placeholders) — do NOT use f-strings in logging calls.

### 2.5 Thread Safety

The project uses threading locks extensively. Always acquire the appropriate lock before accessing shared state:

```python
with self.native_queue.mutex:
    # Access/modify queue state
    ...

with self.pause_lock:
    # Pause/resume logic
    ...
```

### 2.6 Database Access

Use the helper functions from [`qm_db.py`](src/comfyui_queue_manager/qm_db.py):

```python
from .qm_db import get_conn, read_query, read_single, write_query, write_many

# Read
rows = read_query("SELECT * FROM queue WHERE status = ?", (0,))

# Write (auto-commit)
write_query("UPDATE queue SET status = ? WHERE id = ?", (1, item_id))

# Write (deferred commit)
write_query("DELETE FROM queue WHERE id = ?", (item_id,), commit=False)
get_conn().commit()

# Write many
write_many("INSERT INTO queue (...) VALUES (?, ?)", [(val1, val2), ...])
```

### 2.7 Error Handling

Use the custom [`BadRouteException`](../src/comfyui_queue_manager/inc/exceptions.py:1) for route validation errors. The error middleware in [`qm_server.py`](../src/comfyui_queue_manager/qm_server.py:266-280) catches these and returns a 422 JSON response.

### 2.8 API Route Pattern

Register routes inside the `QM_Server.__init__()` method using decorators on `PromptServer.instance.routes`:

```python
@PromptServer.instance.routes.get("/queue_manager/your-endpoint")
async def your_handler(request):
    # Parse query params
    # Call queue methods
    return web.json_response({"key": value})
```

### 2.9 Monkey-Patching Pattern

When hijacking native ComfyUI methods, follow this pattern:

```python
# 1. Save original reference
self.original_method = self.native_queue.method_name

# 2. Replace with wrapper
self.native_queue.method_name = self.wrapper_method

# 3. In wrapper, call original when needed
def wrapper_method(self, *args, **kwargs):
    # Custom logic
    result = self.original_method(*args, **kwargs)
    # More custom logic
    return result
```

---

## 3. Frontend Loader Layer (`web/`) Conventions

### 3.1 Code Style

- **Indentation**: 2 spaces
- **Quotes**: Prefer double quotes, but single quotes are also used in the existing code
- **Naming**: `camelCase` for variables and functions
- **Semicolons**: Required
- **Modules**: ES modules with `import`/`export`

### 3.2 ComfyUI Extension Registration

Always use `app.registerExtension()`:

```javascript
import { app } from '../../scripts/app.js';

app.registerExtension({
  name: "ComfyUIQueueManager.YourFeature",
  async setup() {
    // Your setup code
  }
});
```

### 3.3 Event Handling

Listen to ComfyUI events via `app.api.addEventListener()`:

```javascript
app.api.addEventListener("status", function (event) {
  // event.detail contains the payload
});
```

### 3.4 Iframe Communication

Use the helper functions from [`web/js/functions.js`](web/js/functions.js):

```javascript
import {postMessageToIframe, postStatusMessageToIframe} from './js/functions.js';

// Send status events to iframe
postStatusMessageToIframe(event);

// Send arbitrary messages
postMessageToIframe({key: 'value'}, 'QM_YourMessageType');
```

### 3.5 DOM Manipulation

The loader layer manipulates ComfyUI's DOM directly. Use `insertAdjacentHTML` for adding elements and `querySelector` for finding them. Avoid frameworks in this layer.

---

## 4. Frontend GUI Layer (`src/gui/`) Conventions

### 4.1 Code Style

- **Indentation**: 2 spaces
- **Quotes**: Double quotes (JSX convention)
- **Naming**: `camelCase` for functions/variables, `PascalCase` for components
- **File naming**: `PascalCase` for components (e.g., [`Queue.js`](src/gui/components/Queue.js)), `kebab-case` for config files

### 4.2 React Patterns

- Use `"use client"` directive at the top of client components
- Use functional components with hooks
- Use `useEvent` from `react-use-event-hook` for stable callback references in event listeners
- Use `useContext` with the [`AppContext`](src/gui/internals/app-context.js) for shared state

```javascript
"use client";
import {useContext} from "react";
import {AppContext} from "@/internals/app-context";

export default function MyComponent() {
  const {appStatus, setAppStatus} = useContext(AppContext);
  // ...
}
```

### 4.3 State Management

Use `useState` for local component state. The root [`layout.js`](src/gui/app/layout.js) manages global state via `AppContext`:

```javascript
const [appStatus, setAppStatus] = useState({
  loading: true,
  error: null,
  queue: null,
  route: 'queue',
  shiftDown: false,
  clientId: null,
  filters: null
});
```

### 4.4 API Calls

Use the [`apiCall`](src/gui/internals/functions.js) helper for POST requests:

```javascript
import {apiCall} from "@/internals/functions";

await apiCall('queue_manager/archive', {
  archive: [itemId]
});
```

For GET requests, use `fetch` directly with the [`baseURL`](src/gui/internals/config.js) config:

```javascript
import {baseURL} from "@/internals/config";

const response = await fetch(`${baseURL}queue_manager/queue?page=0`);
```

### 4.5 Styling

- **Primary**: Tailwind CSS v4 utility classes
- **Secondary**: SCSS modules (`.module.scss`) for component-specific styles
- **Global**: [`globals.scss`](src/gui/app/globals.scss) for app-wide styles
- **Dark mode**: Use `@media (prefers-color-scheme: dark)` or Tailwind's `dark:` prefix
- **CSS custom properties**: Use `var(--property-name)` for theme values

### 4.6 Iframe Communication

The GUI receives messages from the parent window via `window.addEventListener("message", ...)`:

```javascript
useEffect(() => {
  window.addEventListener("message", handleMessage);
  return () => window.removeEventListener("message", handleMessage);
}, []);
```

Message types are prefixed with `QM_`:
- `QM_queueStatusUpdated` — Queue/execution status updates
- `QM_ParentKeypress` — Keyboard events from parent
- `QM_QueueManager_Hello` — Initial handshake with client ID

---

## 5. General Conventions

### 5.1 File Organization

- Python source: `src/comfyui_queue_manager/`
- Frontend loader: `web/`
- Frontend GUI app: `src/gui/`
- Tests: `tests/`
- Documentation: `web/docs/`, `README.md`

### 5.2 Versioning

The version is defined in [`pyproject.toml`](../pyproject.toml:7) and exposed via `/queue_manager/version` endpoint. Use `bump-my-version` for version bumps.

### 5.3 Pre-commit

Run `ruff` linter and formatter before committing (configured in [`.pre-commit-config.yaml`](.pre-commit-config.yaml)). The linter checks for:
- `exec`/`eval` usage (rules `S102`, `S307`)
- Trailing whitespace (`W293`)
- Pyflakes errors (`F` series)

### 5.4 Comments

- Use `# SIML:` prefix for "Someday I Might Like" TODO comments (see [`qm_queue.py:280`](../src/comfyui_queue_manager/qm_queue.py:280))
- Use standard `# TODO:` for actionable items
- Keep comments concise; prefer self-documenting code

### 5.5 Error Messages

Return errors as JSON with an `error` key and appropriate HTTP status codes:

```python
return web.json_response({"error": "Invalid route"}, status=400)
```

---

## 6. Anti-Patterns to Avoid

1. **Do NOT** modify ComfyUI source files directly — always use monkey-patching
2. **Do NOT** use f-strings in `logging.*` calls — use lazy `%s` formatting
3. **Do NOT** add new dependencies without updating `pyproject.toml` and `package.json`
4. **Do NOT** break the `postMessage` protocol — all iframe communication must use `QM_` prefixed message types
5. **Do NOT** hardcode URLs — use the config files ([`config.js`](web/js/config.js), [`config.js`](src/gui/internals/config.js))
6. **Do NOT** bypass the database layer — always use `qm_db.py` helpers for SQLite access
7. **Do NOT** remove the `"use client"` directive from GUI components that use hooks or browser APIs
