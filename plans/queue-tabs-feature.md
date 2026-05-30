# Queue Tabs Feature Implementation Plan

## Overview
Add new queue management tabs (New, Priority, Main, Background) and a "Build Queue" button to enable multi-stage queue workflow.

## Status Values
- **0**: pending (working queue)
- **1**: running
- **2**: finished
- **3**: archive
- **4**: new (newly created tasks)
- **5**: priority
- **6**: main
- **7**: background

## Implementation Steps

### Phase 1: Database Schema Updates
- [ ] Update `qm_db.py` schema comment to document new status values (4-7)
- [ ] No migration needed - existing tasks remain with their current status

### Phase 2: Backend Logic Changes (`qm_queue.py`)

#### 2.1 Modify Task Creation
- [ ] Update `queue_put()` method to set `status = 4` (new) instead of `status = 0` (pending) for new tasks
- [ ] Ensure backward compatibility: tasks without `extra_pnginfo` still go directly to pending (status=0)

#### 2.2 Add New Methods
- [ ] `move_to_category(item_ids, category_status)` - Move items from New (status=4) to Priority/Main/Background (status 5/6/7)
- [ ] `build_queue(client_id)` - Archive current queue (status 0→3), then move Priority→Main→Background items to pending (status 0)

#### 2.3 Update Route Queries
- [ ] Extend `get_route_query()` to handle new routes: "new", "priority", "main", "background"
- [ ] Map routes to status values: new→4, priority→5, main→6, background→7

#### 2.4 Update Task Execution Logic
- [ ] Ensure `queue_get()` only processes tasks with `status = 0` (no changes needed - already correct)
- [ ] Verify `get_tasks_remaining()` counts only status 0 and 1 (no changes needed)

### Phase 3: Backend API Routes (`qm_server.py`)

#### 3.1 Add New Endpoints
- [ ] `POST /queue_manager/move-to-category` - Move items to Priority/Main/Background
  - Request body: `{ items: [db_ids], category: "priority"|"main"|"background" }`
- [ ] `POST /queue_manager/build-queue` - Execute Build Queue algorithm
  - Request body: `{ client_id: string }`

#### 3.2 Update Route Validation
- [ ] Extend `get_the_route()` to accept: "new", "priority", "main", "background"

### Phase 4: Frontend GUI Updates (`src/gui/`)

#### 4.1 Add New Tabs (`layout.js`)
- [ ] Add tab buttons: "New", "Priority", "Main", "Background"
- [ ] Update `appStatus.route` to handle new route values
- [ ] Ensure tab styling matches existing tabs

#### 4.2 Add Action Buttons (`Queue.js`)
- [ ] On "New" tab, add buttons for each item: "Priority", "Main", "Background"
- [ ] Implement `moveToCategory(category)` function that calls the new API endpoint
- [ ] Hide these buttons on other tabs

#### 4.3 Add Build Queue Button (`layout.js`)
- [ ] Add "Build Queue" button at the bottom of the interface
- [ ] Implement `buildQueue()` function that calls the new API endpoint
- [ ] Show confirmation dialog before executing (optional)

#### 4.4 Update Data Fetching
- [ ] Ensure `fetchQueueItems()` works with new route values
- [ ] Verify filters apply correctly to new tabs

### Phase 5: Testing & Validation
- [ ] Test new task creation → appears in "New" tab
- [ ] Test moving tasks from New → Priority/Main/Background
- [ ] Test Build Queue: archives current queue, moves all categorized tasks to working queue
- [ ] Test backward compatibility: existing pending tasks continue working
- [ ] Test filters work on new tabs
- [ ] Test pause/resume functionality still works correctly

## Algorithm Details

### Build Queue Algorithm
```
1. Archive all items with status=0 (pending) → status=3
2. Move all items with status=5 (priority) → status=0, assign sequential numbers
3. Move all items with status=6 (main) → status=0, assign sequential numbers
4. Move all items with status=7 (background) → status=0, assign sequential numbers
5. Notify frontend of queue update
```

### Move to Category Algorithm
```
1. Validate items exist and have status=4 (new)
2. Update status to target category (5/6/7)
3. Notify frontend of queue update
```

## File Changes Summary
- `src/comfyui_queue_manager/qm_db.py` - Update schema comments
- `src/comfyui_queue_manager/qm_queue.py` - Add new methods, modify queue_put()
- `src/comfyui_queue_manager/qm_server.py` - Add new API endpoints, update route validation
- `src/gui/app/layout.js` - Add new tabs, add Build Queue button
- `src/gui/components/Queue.js` - Add category action buttons for New tab

## Backward Compatibility
- Existing tasks with status=0 continue to work as before
- Only newly created tasks (via queue_put) will have status=4
- All existing API endpoints remain functional
- No database migration required
