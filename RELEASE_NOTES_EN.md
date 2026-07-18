# Release Notes — ComfyUI Queue Manager

## Merge Request Summary

This Merge Request introduces a major evolution of the ComfyUI Queue Manager — from a basic persistent queue with pause/resume and archive capabilities to a full-featured **multi-stage queue management system** with categorization, tagging, drag-and-drop reordering, bulk operations, and user-configurable settings.

Below is a detailed breakdown of all changes compared to the original baseline (as documented in the original `README.md`).

---

## 1. Queue Categorization System (Multi-Stage Workflow)

**Before:** All new tasks went directly into the pending queue (status=0) and were executed in FIFO order.

**After:** New tasks enter a **multi-stage pipeline**:

| Stage | Status | Description |
|-------|--------|-------------|
| **New** | 4 | Freshly queued tasks, awaiting categorization |
| **Priority** | 5 | High-priority tasks |
| **Main** | 6 | Standard tasks |
| **Background** | 7 | Low-priority tasks |
| **Pending** | 0 | Ready for execution (after Build Queue) |
| **Running** | 1 | Currently executing |
| **Completed** | 2 | Successfully finished |
| **Archived** | 3 | Saved for later |

**New UI Tabs:**
- **New** — shows uncategorized tasks (status=4). Each item has buttons to move it to Priority/Main/Background.
- **Waiting** — shows all categorized tasks (status 5/6/7) with filter toggles for each category.
- **Queue** — shows pending tasks ready for execution (status=0).
- **Archive** — saved tasks (status=3).
- **Completed** — finished tasks (status=2).
- **Settings** — user-configurable options.

**Build Queue Button:**
A new "Build Queue" button orchestrates the multi-stage pipeline with a precise two-phase algorithm:

**Phase 1 — Archive:** All current pending items (status=0) are archived (status=3), preserving their existing tags.

**Phase 2 — Process tiers in priority order (Priority → Main → Background):**
For each tier, two sub-steps are executed:
- **Sub-step A:** Items from the category (status 5/6/7) are moved to pending (status=0) — these go to the **front** of the execution queue, ordered by `updated_at` within the tier.
- **Sub-step B:** Items from the archive (status=3) with the **matching tag** are moved to pending (status=0) — these go **after** the category items, also ordered by `updated_at`.

The result is a queue built in strict priority order:
```
[Priority category items] → [Priority archived items] → [Main category items] → [Main archived items] → [Background category items] → [Background archived items]
```

After Build Queue completes, only items with non-priority tags (`archive`, `none`, `new`, `completed`) remain in the archive (status=3). All items tagged `priority`, `main`, or `background` are moved into the execution queue.

This allows users to queue many workflows, categorize them by importance, and then build the execution queue in a controlled, predictable order.

---

## 2. Tag System

**Before:** No tagging mechanism existed.

**After:** Every queue item now has a `tag` field with validation:

```python
VALID_TAGS = {"none", "new", "main", "priority", "background", "archive", "completed"}
```

- Tags are automatically synchronized with status changes.
- **Critical fix:** Archive operations now **preserve existing tags** instead of overwriting them. This means categorized items (priority/main/background) retain their category tag even when archived, allowing the Build Queue algorithm to restore them correctly.
- Tags are displayed as intuitive SVG icons in the UI (flag icon for priority, house icon for main, box icon for background).
- New API endpoint: `POST /queue_manager/tag` for updating tags.

---

## 3. Drag-and-Drop Reordering

**Before:** Queue execution order was fixed (FIFO by insertion time).

**After:** Users can reorder pending queue items by dragging them with a mouse.

- **Library:** `@dnd-kit/core` + `@dnd-kit/sortable` (React 19 compatible).
- **Mechanism:** Drag handles appear on the "Queue" tab. When an item is dropped at a new position, the backend redistributes the existing `number` values among the reordered items — this ensures items on other pages are unaffected.
- **Optimistic UI:** The frontend updates immediately, then persists to the backend.
- **New API endpoint:** `POST /queue_manager/reorder`
- **New backend method:** `QM_Queue.reorder_items()`

---

## 4. Bulk Selection & Operations

**Before:** Actions (archive, delete, export) applied to all items or individual items only.

**After:** Checkboxes enable bulk selection on Queue, New, Archive, and Waiting tabs.

- Select all / deselect all via header checkbox.
- Bulk move selected items to Priority/Main/Background categories.
- Selection state is synced to the footer via `AppContext`, enabling bulk action buttons.
- Selection resets when data changes.

---

## 5. Settings Page

**Before:** All behavior was hardcoded (as noted in the original Roadmap: "Options. Toggles, big red buttons, levers and valves to control Queue Manager's behavior. Now everything is hardcoded.")

**After:** A new **Settings** tab allows users to configure:

- **Default status for new tasks** — choose where new tasks land (pending, new, priority, main, background).
- **Default tag for new tasks** — choose the default tag (priority, main, background, archive).

**New API endpoints:**
- `GET /queue_manager/settings` — retrieve current settings.
- `POST /queue_manager/settings` — save settings with validation.

**Backend:** `QM_Options.get()` improved to handle cached values with timestamp support.

---

## 6. UI/UX Enhancements

### 6.1 Navigation Tab Icons
Each tab now has a distinct Lucide icon for visual clarity:
- Queue: `List` icon
- New: `Sparkles` icon
- Waiting: `Clock` icon
- Archive: `Archive` icon
- Completed: `CheckCircle` icon
- Settings: `Settings` icon

### 6.2 Loading Spinners
Tab buttons show a spinning refresh icon while data is being fetched, providing visual feedback during asynchronous operations. Fetch ID tracking prevents stale state updates when switching tabs rapidly.

### 6.3 Enhanced Pagination
The pagination UI now:
- Dynamically handles varying numbers of pages.
- Uses smart ellipsis placement (`…`) to maintain UI consistency.
- Shows proper spacing and visual indicators for page gaps.

### 6.4 Category Toggle Filters (Waiting Tab)
The Waiting tab's filtering UI was redesigned from checkbox filters to **toggle buttons** that simultaneously control both status and tag filters. Selecting/deselecting a category applies filters immediately without a separate "Apply" button.

### 6.5 Tooltips & Icons
- All action buttons now have `title` attributes for tooltips.
- Status indicators (priority/main/background) use SVG icons instead of text labels.
- Consistent icon styling across all queue components.

### 6.6 Dark Mode
Dark mode styling added to navigation tabs (`dark:bg-neutral-800 bg-neutral-200 active` classes).

---

## 7. Code Quality & Architecture Improvements

### 7.1 Build Queue Refactoring
The `build_queue()` method was split into two distinct steps:
- `_build_queue_step1_archive_pending()` — archives current pending items.
- `_build_queue_step2_process_tiers()` — processes priority tiers (category + archive with matching tags).

This improves readability, testability, and logging granularity.

### 7.2 Performance Optimizations
- `fetchQueueItems()` converted to `useCallback` to prevent unnecessary re-renders.
- Filter and route logic moved into reusable `useCallback` hooks.
- Proper dependency management in `useEffect` hooks.
- Fetch ID tracking prevents stale responses on rapid tab switching.

### 7.3 Archive Tag Preservation (Bug Fix)
Two commits (`43fc731`, `2b3ca8c`) fixed a critical bug where archiving items would overwrite their existing tags. Now `archive_queue()` and `archive_items()` only change the status to 3 without modifying the tag field.

### 7.4 Queue Type Simplification
The separate priority/main/background queue types were removed from the UI as they were redundant with the new waiting status system. The status values (5/6/7) remain in the database schema for the categorization system.

---

## 8. New Files & Dependencies

### New Files
| File | Purpose |
|------|---------|
| `src/gui/components/WaitingQueue.js` | Waiting tab component with category toggle filters |
| `src/gui/components/Settings.js` | Settings page component |
| `remote_dev_runner.py` | Remote development auto-sync tool |
| `sync_files.sh` | Manual file sync script |
| `AGENTS.md` | Development conventions documentation |
| `plans/queue-architecture.md` | Architecture documentation |
| `plans/queue-tabs-feature.md` | Feature plan |
| `plans/queue-tabs-status.md` | Implementation status |
| `plans/queue-drag-reorder.md` | Drag-and-drop plan |
| `plans/analysis.md` | Project analysis |

### New Dependencies
- `@dnd-kit/core` — drag-and-drop framework
- `@dnd-kit/sortable` — sortable list support
- `lucide-react` — icon library (already present, new icons used)

---

## 9. API Changes

### New Endpoints
| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/queue_manager/move-to-category` | Move items to Priority/Main/Background |
| POST | `/queue_manager/build-queue` | Execute Build Queue algorithm |
| POST | `/queue_manager/reorder` | Reorder pending items |
| POST | `/queue_manager/tag` | Update item tags |
| GET | `/queue_manager/settings` | Get settings |
| POST | `/queue_manager/settings` | Save settings |

### Extended Routes
The `route` parameter now accepts: `queue`, `archive`, `completed`, `new`, `waiting`, `settings`.

---

## 10. Backward Compatibility

- **Database:** No migration required. Existing tasks with status=0 continue working. The `tag` column is added via `ALTER TABLE` if missing.
- **API:** All existing endpoints remain functional. New routes are additive.
- **UI:** The original Queue, Archive, and Completed tabs work identically to before. New tabs are additive.
- **External jobs:** Unchanged — they still bypass Queue Manager and go directly to the native queue.

---

## Summary

This Merge Request transforms the ComfyUI Queue Manager from a basic queue persistence tool into a **professional-grade queue management system** with:

- Multi-stage categorization (New → Priority/Main/Background → Pending → Execution)
- Visual drag-and-drop reordering
- Bulk operations with selection
- User-configurable settings
- Rich UI with icons, tooltips, and loading states
- Robust tag system with archive preservation
- Comprehensive documentation and development tooling

The original roadmap items for "Options" and "Better user and dev docs" have been addressed. Remaining roadmap items (Bin, Cover images, More columns) are left for future iterations.
