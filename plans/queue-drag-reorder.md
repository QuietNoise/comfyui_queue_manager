# Drag-and-Drop Reordering of Queue Items

## Overview

Add the ability to reorder pending queue items by dragging them with a mouse. A dedicated drag-handle column will be added to the table. The new order must persist to the database and affect actual execution order.

---

## 1. How Queue Ordering Works (Backend)

The execution order is determined by the `number` column in the `queue` table:

- [`get_current_queue()`](../src/comfyui_queue_manager/qm_queue.py:69) uses `ORDER BY number` (line 79) to return items in priority order.
- [`queue_get()`](../src/comfyui_queue_manager/qm_queue.py:268) picks the item with the **smallest `number`** (highest priority) from the DB (line 282-288: `ORDER BY number LIMIT 1`).
- The `number` column is essentially the **priority/order field** — lower = earlier execution.
- The native ComfyUI queue (`heapq`) typically holds only 0-1 items; the rest live in SQLite.

**Key insight**: To reorder, we just need to reassign `number` values among the reordered items.

---

## 2. Library Choice: `@dnd-kit`

**Selected: [`@dnd-kit`](https://dndkit.com/)** (`@dnd-kit/core` + `@dnd-kit/sortable`)

Reasons:
- Actively maintained, works with React 19 and Next.js 15
- Lightweight with tree-shaking (no unnecessary dependencies)
- Has `@dnd-kit/sortable` for sortable lists out of the box
- Works well with `<table>` layouts via `useSortable` hook
- Provides `DragOverlay` for custom drag previews
- Good TypeScript support

Alternatives considered and rejected:
- `react-beautiful-dnd` — deprecated, no React 19 support
- `@hello-pangea/dnd` — maintained fork but heavier API
- `react-dnd` — older, more complex, less ergonomic for sortable lists

---

## 3. Scope

**Only the "queue" tab** (route=`queue`, status=0 pending items). The drag handle column will only appear when `appStatus.route === 'queue'`.

The `WaitingQueue` component is out of scope — it shows categorized items (status 5/6/7) which are not in the execution queue.

---

## 4. Pagination Consideration

The queue endpoint returns 100 items per page (`page_size=100`). The frontend only sees and can reorder items on the **current page**. This means:

- We must NOT assign completely new `number` values from the global counter, because that would conflict with items on other pages.
- Instead, we **redistribute the existing `number` values** among the reordered items.

**Algorithm**:
1. Read current `number` values for all `item_ids` being reordered.
2. Sort these numbers ascending (this is their current order).
3. Assign them back in the new desired order (first item gets the smallest number = highest priority).

This ensures items on other pages keep their original numbers, and the global ordering is preserved.

---

## 5. Backend Changes

### 5.1 New API Endpoint

Add to [`QM_Server.__init__()`](../src/comfyui_queue_manager/qm_server.py:13):

```python
@PromptServer.instance.routes.post("/queue_manager/reorder")
async def reorder_queue(request):
    json_data = await request.json()
    if "items" not in json_data:
        return web.json_response({"error": "Missing items"}, status=400)
    reordered = self.queue.reorder_items(json_data["items"])
    return web.json_response({"reordered": reordered})
```

### 5.2 New Method in `QM_Queue`

Add to [`QM_Queue`](../src/comfyui_queue_manager/qm_queue.py:16):

```python
def reorder_items(self, item_ids: list):
    """
    Reorder pending queue items by redistributing their current 'number' values.
    item_ids: list of db_ids in the desired execution order (first = highest priority).
    Only items on the current page are reordered; items on other pages are unaffected.
    """
    with self.native_queue.mutex:
        # 1. Read current numbers for all items being reordered
        placeholders = ",".join("?" for _ in item_ids)
        rows = read_query(
            f"SELECT id, number FROM queue WHERE id IN ({placeholders})",
            tuple(item_ids),
        )
        if not rows:
            return 0

        # Build id->number map
        num_map = {row[0]: row[1] for row in rows}

        # 2. Sort existing numbers ascending
        sorted_numbers = sorted(num_map.values())

        # 3. Assign numbers in new order (first item gets smallest number = highest priority)
        for i, db_id in enumerate(item_ids):
            if db_id in num_map:
                write_query(
                    "UPDATE queue SET number = ? WHERE id = ?",
                    (sorted_numbers[i], db_id),
                    commit=False,
                )

        get_conn().commit()

        # 4. Clear native queue so next queue_get() picks up the new order
        self.native_queue.queue = []
        heapq.heapify(self.native_queue.queue)

        # 5. Notify the queue processing loop
        PromptServer.instance.prompt_queue.not_empty.notify()
        PromptServer.instance.send_sync(
            "queue-manager-queue-updated",
            {"reordered": len(item_ids)},
        )
        PromptServer.instance.queue_updated()

        return len(item_ids)
```

**Why this works with pagination**:
- Only the `number` values of the reordered items change.
- Items on other pages keep their original `number` values.
- The global `ORDER BY number` still produces a correct total ordering.
- No conflicts with newly added items (they get numbers from `PromptServer.instance.number` which is much higher).

---

## 6. Frontend Changes

### 6.1 Install Dependencies

```bash
cd src/gui
npm install @dnd-kit/core @dnd-kit/sortable
```

### 6.2 Modify [`Queue.js`](../src/gui/components/Queue.js)

#### a) Add imports

```javascript
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import {CSS} from "@dnd-kit/utilities";
import {GripVertical} from "lucide-react";
```

#### b) Add state for active drag item

```javascript
const [activeId, setActiveId] = useState(null);
```

#### c) Add sensors configuration

```javascript
const sensors = useSensors(
  useSensor(PointerSensor, {
    activationConstraint: {
      distance: 5, // 5px movement required to activate drag
    },
  })
);
```

#### d) Compute sortable items list

```javascript
const sortableItems = state.pending
  .filter(item => item[3] && item[3].db_id)
  .map(item => item[3].db_id);
```

#### e) Wrap `<tbody>` with DndContext + SortableContext

Only when `appStatus.route === 'queue'`:

```jsx
{appStatus.route === 'queue' ? (
  <DndContext
    sensors={sensors}
    collisionDetection={closestCenter}
    onDragStart={handleDragStart}
    onDragEnd={handleDragEnd}
    onDragCancel={handleDragCancel}
  >
    <SortableContext
      items={sortableItems}
      strategy={verticalListSortingStrategy}
    >
      <tbody>
        {state.pending.map((item, index) => (
          <SortableQueueItemRow
            item={item}
            key={item[3].db_id}
            className={'pending'}
            index={index}
          />
        ))}
      </tbody>
    </SortableContext>
    <DragOverlay>
      {activeId ? <QueueItemRow item={/* find by id */} /> : null}
    </DragOverlay>
  </DndContext>
) : (
  <tbody>
    {state.pending.map((item, index) => (
      <QueueItemRow item={item} key={item[3].db_id} className={'pending'} index={index} />
    ))}
  </tbody>
)}
```

#### f) Create `SortableQueueItemRow` wrapper

```javascript
function SortableQueueItemRow({item, className, index}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({id: item[3].db_id});

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={"dark:odd:bg-neutral-900 odd:bg-neutral-100" + (className ? ' ' + className : '')}
    >
      {/* Drag handle column (only on queue route) */}
      {appStatus.route === 'queue' && (
        <td className="px-2 py-1 text-center w-8 cursor-grab active:cursor-grabbing drag-handle" {...attributes} {...listeners}>
          <GripVertical size={16} />
        </td>
      )}
      {/* ... rest of columns ... */}
    </tr>
  );
}
```

#### g) Handle drag start/end/cancel

```javascript
function handleDragStart(event) {
  setActiveId(event.active.id);
}

function handleDragCancel() {
  setActiveId(null);
}

async function handleDragEnd(event) {
  const {active, over} = event;
  setActiveId(null);

  if (!over || active.id === over.id) return;

  const oldIndex = sortableItems.indexOf(active.id);
  const newIndex = sortableItems.indexOf(over.id);
  const newOrder = arrayMove(sortableItems, oldIndex, newIndex);

  // Optimistically update local state
  setState(prev => {
    const reordered = arrayMove(prev.pending, oldIndex, newIndex);
    return {...prev, pending: reordered};
  });

  // Persist to backend
  await apiCall("queue_manager/reorder", {items: newOrder});
}
```

#### h) Add drag handle column to `<thead>`

```jsx
{appStatus.route === 'queue' && (
  <th className="px-2 py-2 text-center w-8"></th>
)}
```

### 6.3 Styling

Add to [`globals.scss`](../src/gui/app/globals.scss):

```scss
.drag-handle {
  cursor: grab;
  color: var(--foreground-faded);
  opacity: 0.4;
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 1;
  }

  &:active {
    cursor: grabbing;
  }
}
```

---

## 7. Data Flow

```mermaid
sequenceDiagram
    participant User
    participant Queue.js
    participant @dnd-kit
    participant API
    participant QM_Server
    participant QM_Queue
    participant SQLite

    User->>Queue.js: Drag handle → move item down
    Queue.js->>@dnd-kit: onDragStart
    @dnd-kit->>Queue.js: onDragEnd (active.id, over.id)
    Queue.js->>Queue.js: Optimistic reorder (arrayMove)
    Queue.js->>API: POST /queue_manager/reorder {items: [id3, id1, id2]}
    API->>QM_Server: reorder_queue()
    QM_Server->>QM_Queue: reorder_items([id3, id1, id2])
    QM_Queue->>SQLite: Read current numbers for items
    SQLite-->>QM_Queue: {id3: 105, id1: 101, id2: 103}
    QM_Queue->>QM_Queue: Sort numbers: [101, 103, 105]
    QM_Queue->>SQLite: Assign: id3→101, id1→103, id2→105
    QM_Queue->>QM_Queue: Clear native queue
    QM_Queue->>API: queue_updated() + send_sync
    API-->>Queue.js: 200 OK
    Queue.js->>Queue.js: fetchQueueItems() (refresh)
```

---

## 8. Files to Modify

| File | Change |
|------|--------|
| [`src/gui/package.json`](../src/gui/package.json) | Add `@dnd-kit/core`, `@dnd-kit/sortable` |
| [`src/gui/components/Queue.js`](../src/gui/components/Queue.js) | Add drag-and-drop logic, drag handle column, SortableQueueItemRow |
| [`src/gui/app/globals.scss`](../src/gui/app/globals.scss) | Add `.drag-handle` styles |
| [`src/comfyui_queue_manager/qm_server.py`](../src/comfyui_queue_manager/qm_server.py) | Add `POST /queue_manager/reorder` endpoint |
| [`src/comfyui_queue_manager/qm_queue.py`](../src/comfyui_queue_manager/qm_queue.py) | Add `reorder_items()` method |

---

## 9. Edge Cases & Considerations

1. **Only pending items**: Drag-and-drop should only work for status=0 items. Running items are not reorderable.
2. **Concurrent adds**: If a new item is added while dragging, the optimistic update might conflict. The `fetchQueueItems()` call after the API response will correct any inconsistencies.
3. **Empty native queue**: After reorder, the native queue is cleared. The next `queue_get()` will pick the item with the smallest `number` from the DB.
4. **Paused queue**: Reordering should work even when paused. The `number` update is independent of the pause state.
5. **Large lists / pagination**: Only items on the current page are reordered. Their existing `number` values are redistributed, so items on other pages are unaffected.
6. **Touch devices**: `PointerSensor` works with both mouse and touch. The `activationConstraint: {distance: 5}` prevents accidental drags on click.
7. **Accessibility**: The drag handle should have `aria-label="Reorder"` and keyboard support via `@dnd-kit`'s built-in keyboard sensor.

---

## 10. Todo List

- [ ] Install `@dnd-kit/core` and `@dnd-kit/sortable` in `src/gui`
- [ ] Add `reorder_items()` method to `QM_Queue` in `qm_queue.py`
- [ ] Add `POST /queue_manager/reorder` endpoint to `QM_Server` in `qm_server.py`
- [ ] Add drag handle column and DnD logic to `Queue.js`
- [ ] Add drag-handle styles to `globals.scss`
- [ ] Test: drag item to new position, verify order persists after page refresh
- [ ] Test: verify execution order follows the new ordering
- [ ] Test: verify no regressions on other tabs (archive, waiting, etc.)
