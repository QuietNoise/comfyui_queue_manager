# Queue Manager API

This guide covers Queue Manager v0.2.0. Use the same address as your ComfyUI browser window, for example `http://127.0.0.1:8188`, followed by one of the paths below.

For ComfyUI's built-in endpoints, see the [official ComfyUI server API documentation](https://docs.comfy.org/development/comfyui-server/comms_overview).

Send JSON bodies with `Content-Type: application/json`, except for file imports. GET and DELETE requests shown here have no body. Responses are JSON unless stated otherwise. Example IDs are placeholders; response examples shorten the saved workflow data.

- [Add jobs](#add-jobs)
- [Browse and filter jobs](#browse-and-filter-jobs)
- [Pause, resume and stop](#pause-resume-and-stop)
- [Archive and run later](#archive-and-run-later)
- [Rename, reorder and group actions](#rename-reorder-and-group-actions)
- [Delete jobs](#delete-jobs)
- [Export and import](#export-and-import)
- [Settings and helper actions](#settings-and-helper-actions)

## Add jobs

### POST /prompt

Submit a workflow using ComfyUI's own endpoint. Queue Manager automatically manages the new job, including submissions without a saved GUI workflow.

The `prompt` must contain an API-format workflow. This small example saves a black image; replace its `prompt` with your own workflow.

Request body:

```json
{
  "prompt": {
    "1": {
      "class_type": "EmptyImage",
      "inputs": {
        "width": 512,
        "height": 512,
        "batch_size": 1,
        "color": 0
      }
    },
    "2": {
      "class_type": "SaveImage",
      "inputs": {
        "images": [
          "1",
          0
        ],
        "filename_prefix": "api-example"
      }
    }
  },
  "extra_data": {
    "queue_manager": {
      "name": "Example render",
      "workflow_id": "example-workflow"
    }
  }
}
```

The `"1"` and `"2"` keys identify nodes inside the workflow. The connection `["1", 0]` means the first output of node `"1"`; outputs are counted from `0`.

Response (`number` is the queue priority; lower numbers run first):

```json
{
  "prompt_id": "11111111-1111-4111-8111-111111111111",
  "number": 12,
  "node_errors": {}
}
```

The `queue_manager` fields are optional. `name` labels the job; reusing `workflow_id` groups jobs under the same workflow filter. Jobs without a name or workflow identity get an automatic label and a separate identity per submission. These fields do not change the workflow's node inputs. An optional top-level `client_id` identifies the browser that should receive progress updates.

## Browse and filter jobs

### GET /queue_manager/queue

Read one page of jobs from Queue, Archive or Completed.

Example request:

```http
GET /queue_manager/queue?route=queue&page=0&page_size=25
```

| URL option | Meaning |
| --- | --- |
| `route` | `queue`, `archive` or `completed`. Defaults to `queue`. |
| `page` | Page number, starting at `0`. |
| `page_size` | Jobs per page, from `1` to `200`. Uses the saved setting if omitted. |
| `order` | Completed only: `desc` for newest first, `asc` for oldest first. Uses the saved setting if omitted. |
| `filters` | Limit the results using the filters below. |

Response:

```json
{
  "running": [],
  "pending": [
    [
      12,
      "11111111-1111-4111-8111-111111111111",
      {},
      {
        "db_id": 42,
        "queue_manager": {
          "name": "Example render",
          "workflow_id": "example-workflow"
        }
      },
      [
        "2"
      ]
    ]
  ],
  "info": {
    "total": 1,
    "page": 0,
    "page_size": 25,
    "last_page": 0
  }
}
```

`pending` holds the requested page, including when browsing Archive or Completed. `running` holds currently running jobs when browsing Queue. `info.total` counts the matching jobs in the requested tab, excluding running jobs.

Each job is a list with five parts: queue priority (`12`), prompt ID, workflow instructions, extra information, and output node IDs (`"2"`). The workflow instructions are shortened to `{}` above. `info.page` and `info.last_page` count pages from `0`; both are `0` here because there is just one page.

**Use the right job ID:** Queue Manager actions use the numeric `db_id` in the fourth part, such as `42` (`job[3].db_id`). ComfyUI's cancel/delete requests use the text `prompt_id` in the second part (`job[1]`). The queue number and visible row number are not job IDs.

For GUI jobs, the saved name and workflow identity are usually in `extra_pnginfo.workflow.workflow_name` and `extra_pnginfo.workflow.id`, inside that same fourth part. API job details are in `queue_manager.name` and `queue_manager.workflow_id` when present.

Completed jobs also include `outputs`, file counts (`total_files`, `total_images`, `total_videos`), and `execution_time` in seconds in their extra information. `outputs` may be absent and `execution_time` may be `null`.

### Filters shared by several endpoints

Use one of these JSON values as `filters`:

**Workflow identity:**

```json
{
  "workflow": {
    "value": "example-workflow",
    "valueLabel": "Example workflow"
  }
}
```

**Exact name:**

```json
{
  "workflow_name": {
    "value": "Example render",
    "valueLabel": "Example render"
  }
}
```

**Job IDs:**

```json
{
  "items": [
    42,
    43
  ]
}
```

`42` and `43` are the jobs' `db_id` values from `GET /queue_manager/queue`. Replace them with the IDs of the jobs you want to match.

Names match exactly, including capital letters and spaces. An ID list accepts 1–200 positive numeric IDs. If you combine filters in one object, a job must match all of them. Include `valueLabel` with workflow/name filters; exports use it in the download filename.

For a URL's `filters` option, send the object as JSON text and let your request tool encode spaces and quotes for the URL. For a JSON request body, send it as an ordinary object.

Example URL for jobs named **Example render**:

```text
http://127.0.0.1:8188/queue_manager/queue?route=queue&filters=%7B%22workflow_name%22%3A%7B%22value%22%3A%22Example%20render%22%2C%22valueLabel%22%3A%22Example%20render%22%7D%7D
```

Filters are supported by listing, archiving all, running the archive, exporting, and deleting from a tab. For bulk actions, they apply to the whole matching list, not just the page open in the browser.

## Pause, resume and stop

### GET /queue_manager/playback

Check whether the queue is paused.

Response:

```json
{
  "paused": true
}
```

### GET /queue_manager/toggle

Switch from running to paused, or from paused to running. Each call reverses the current state. Pausing lets the current job finish and prevents the next job from starting.

Example request:

```http
GET /queue_manager/toggle?clean_caches=true
```

Response:

```json
{
  "paused": true
}
```

`clean_caches=true` also requests model unloading and cache cleanup when entering Pause, after any running job finishes. Set it to `false` to skip cleanup, or omit it to use the saved **Clean caches on Pause** setting. Resuming does not trigger cleanup.

### POST /api/interrupt

Stop the current job using ComfyUI's endpoint. Queue Manager also removes its running-job record. This does not pause the rest of the queue.

Request body, to stop the current job:

```json
{}
```

Or target a particular running job:

```json
{
  "prompt_id": "11111111-1111-4111-8111-111111111111"
}
```

Response: `200 OK`, with no response body.

## Archive and run later

### POST /queue_manager/archive

Move pending jobs into Archive. Running jobs are skipped.

Request body:

```json
{
  "archive": [
    42,
    43
  ],
  "front": true
}
```

`42` and `43` identify the two jobs to archive. Replace them with the jobs' numeric `db_id` values from `GET /queue_manager/queue`.

Response (`archived` counts the jobs moved):

```json
{
  "archived": 2
}
```

`front` is optional and defaults to `false`. Set it to `true` to place the jobs at the start of Archive, keeping their queue order.

### GET /queue_manager/archive-queue

Archive all pending jobs, or only those matching `filters`.

Example request:

```http
GET /queue_manager/archive-queue?front=true
```

Response (`archived` counts the jobs moved):

```json
{
  "archived": 12
}
```

`front=true` places the group at the start of Archive. Without `filters`, this acts on every pending job.

### POST /queue_manager/play

Move archived jobs back to Queue. They wait if the queue is paused.

Request body:

```json
{
  "items": [
    42
  ],
  "front": false
}
```

`42` is the archived job's `db_id`, returned by `GET /queue_manager/queue?route=archive`.

Response (`moved` counts the jobs returned to Queue):

```json
{
  "moved": 1
}
```

`front: true` places jobs at the front of Queue. Optional `clientId` identifies the browser that should receive progress updates. This endpoint spells it `clientId`; the other endpoints use `client_id`. To run a group in its saved Archive order, use the group action below.

### POST /queue_manager/play-archive

Move the whole Archive, or jobs matching `filters`, back to Queue in their Archive order.

Request body:

```json
{
  "front": true,
  "filters": {
    "workflow_name": {
      "value": "Example render",
      "valueLabel": "Example render"
    }
  }
}
```

Response (`queued` counts the jobs returned to Queue):

```json
{
  "queued": 3
}
```

All fields are optional: `{}` moves the whole Archive to the end of Queue. `front: true` moves it to the front. Optional `client_id` chooses the browser receiving progress updates. A paused queue stays paused.

## Rename, reorder and group actions

These actions use numeric job IDs from the listing. Group requests accept 1–200 IDs and skip jobs that have disappeared or moved out of the requested tab. Rename and reorder apply only to pending or archived jobs.

### POST /queue_manager/rename

Change the saved name of one job or a group. Empty names are rejected; characters unsuitable for filenames are cleaned up. The response contains the name actually saved.

Use `id` for one job's `db_id`, or `ids` for several. Here, `42` and `43` identify the jobs to rename.

Request body for one job:

```json
{
  "id": 42,
  "name": "Portrait test"
}
```

Response:

```json
{
  "id": 42,
  "name": "Portrait test"
}
```

Request body for a group (`route` is required here):

```json
{
  "ids": [
    42,
    43
  ],
  "route": "queue",
  "name": "Portrait test"
}
```

Response:

```json
{
  "ids": [
    42,
    43
  ],
  "name": "Portrait test"
}
```

### POST /queue_manager/reorder

Move jobs within Queue or Archive while keeping the group's existing order. Running jobs stay in place. `route` defaults to `queue`; use `archive` for Archive.

Request body, to place jobs beside another job:

```json
{
  "route": "queue",
  "ids": [
    42,
    43
  ],
  "target_id": 50,
  "position": "before"
}
```

`42` and `43` are the `db_id` values of the jobs to move; `50` is the `db_id` of the job to place them beside. Use `before` or `after` for `position`. The target must be a different job in the same tab.

Alternatively, move to the start or end of the whole tab:

```json
{
  "route": "archive",
  "ids": [
    42,
    43
  ],
  "destination": "start"
}
```

`destination` accepts `start` or `end` and replaces `target_id` and `position`. It includes jobs on other pages and jobs hidden by filters.

Response for either form:

```json
{
  "ids": [
    42,
    43
  ],
  "changed": true
}
```

`changed` is `false` if the jobs were already in that position.

### POST /queue_manager/selection

Apply one action to a chosen group. Browser selection mode does not need to be turned on.

| `route` | Available `action` values |
| --- | --- |
| `queue` | `archive`, `delete`, `export` |
| `archive` | `play`, `delete`, `export` |
| `completed` | `delete`, `export` |

Request body:

```json
{
  "route": "archive",
  "action": "play",
  "ids": [
    42,
    43
  ],
  "front": true
}
```

`42` and `43` are the selected jobs' `db_id` values.

Response (`affected` counts the jobs the action applied to):

```json
{
  "affected": 2
}
```

Optional `front` places archived jobs at the front of Queue when playing, or pending jobs at the start of Archive when archiving. Group order is preserved. Optional `client_id` is used when playing jobs. Running jobs are not included.

For `action: "export"`, the response is a saved job list like the [export example](#get-queue_managerexport), instead of an `affected` count. An empty result is `[]`.

## Delete jobs

### DELETE /queue_manager/queue

Remove saved jobs from a tab. Use `filters` to limit which jobs are deleted. With no filters, this deletes the whole tab; Queue deletion excludes running jobs. Saved output files are kept.

Example request:

```http
DELETE /queue_manager/queue?route=archive
```

Response (`deleted` counts the jobs removed):

```json
{
  "deleted": 12
}
```

`route` accepts `queue`, `archive` or `completed` and defaults to `queue`. For a chosen group, use `/queue_manager/selection` with `action: "delete"`.

### POST /api/queue

Use ComfyUI's queue controls to delete jobs by their text prompt IDs or clear all pending jobs. Use this `/api/queue` path so Queue Manager's saved records are updated too.

Request body to delete jobs:

```json
{
  "delete": [
    "11111111-1111-4111-8111-111111111111"
  ]
}
```

Or clear all pending jobs:

```json
{
  "clear": true
}
```

Response: `200 OK`, with no response body. Clearing pending jobs leaves the running job alone.

## Export and import

### GET /queue_manager/export

Download saved jobs as a JSON file. Accepts `route` (`queue`, `archive` or `completed`, default `queue`) and optional `filters`. Queue exports include pending and running jobs.

Example request:

```http
GET /queue_manager/export?route=archive
```

Shortened response:

```json
[
  [
    12,
    "11111111-1111-4111-8111-111111111111",
    {},
    {
      "queue_manager": {
        "name": "Example render",
        "workflow_id": "example-workflow"
      }
    },
    [
      "2"
    ]
  ]
]
```

As in the listing, `12` is the queue priority and `"2"` identifies an output node in the workflow.

The actual download includes the full workflow instructions. It omits the separate field containing saved API keys. Import the downloaded file unchanged; the shortened example above is not a runnable workflow.

### POST /queue_manager/import

Upload an exported job list into Queue or Archive. Jobs whose prompt IDs already exist are skipped.

Send a file upload (`multipart/form-data`), not a JSON request body. `queue_json` must be the first field.

| Form field | Meaning |
| --- | --- |
| `queue_json` | Required JSON file from an export. |
| `archive` | Include this field to import into Archive. Omit it to import into Queue. |
| `client_id` | Optional browser ID for progress updates. |
| `api_key_comfy_org` | Optional replacement Comfy API key for Partner Nodes. |

Example request:

```sh
curl -X POST "http://127.0.0.1:8188/queue_manager/import" \
  -F "queue_json=@queue-export.json;type=application/json" \
  -F "archive=true"
```

Response (`submitted` is the number of jobs in the file; `imported` is how many were added):

```json
{
  "imported": 8,
  "submitted": 10
}
```

## Settings and helper actions

### GET /queue_manager/options

Read saved Queue Manager display and startup options. This is separate from ComfyUI's **Settings → Queue Manager** panel.

Example response:

```json
{
  "thumb_size": 150,
  "cover_size": 50,
  "thumb_mode": "cover",
  "queue_paused": false,
  "splash_screen": "0.2.0",
  "show_gallery_ui": true,
  "__version__": "0.2.0"
}
```

To read one saved value, use `GET /queue_manager/options?key=thumb_size`:

```json
{
  "thumb_size": 150
}
```

The full response supplies defaults for missing options. A single-key request returns `404` if that option has not yet been saved.

### POST /queue_manager/options

Save one option.

Request body:

```json
{
  "key": "thumb_size",
  "value": 200
}
```

Response:

```json
{
  "success": true
}
```

| Key | Accepted value |
| --- | --- |
| `thumb_size` | Whole number from `50` to `500`. |
| `cover_size` | Whole number from `25` to `200`. |
| `thumb_mode` | `none`, `cover` or `grid`. |
| `show_gallery_ui` | `true` or `false`. |
| `queue_paused` | `true` or `false`; saves the state used by the **Last state** startup option. Use `/queue_manager/toggle` to pause or resume now. |
| `splash_screen` | Any supplied value is replaced by the current version, marking its splash as seen. |

### GET /queue_manager/takeover

Restore progress updates for already queued jobs to a chosen browser, taking effect as those jobs start. `client_id` must be its 32-character ID, using lowercase `a`–`f` and digits.

Example request:

```http
GET /queue_manager/takeover?client_id=0123456789abcdef0123456789abcdef
```

Response:

```json
{
  "client_id": "0123456789abcdef0123456789abcdef",
  "timestamp": "2026-10-09 12:00:00"
}
```

### GET /queue_manager/open_location

Open an output file's folder on the computer running ComfyUI. Use the job's numeric `db_id` as `id` (`42` in this example), the output's `filename`, and its `subfolder`; use an empty `subfolder` for files directly in the output folder.

Example request:

```http
GET /queue_manager/open_location?id=42&filename=api-example_00001_.png&subfolder=
```

Response:

```json
"Location opened"
```

### GET /queue_manager/version

Read the installed extension version.

Response:

```json
{
  "version": "0.2.0"
}
```

### GET /queue_manager/poke_status

Ask ComfyUI to send a fresh queue-status update to connected browsers.

Response:

```json
{
  "success": true
}
```

## When a request fails

Queue Manager normally returns an error message with the HTTP status, for example:

```json
{
  "error": "Only pending or archived jobs can be renamed"
}
```

Common statuses are `400` for invalid values, `404` for something not found, `409` when a job can no longer be changed as requested, and `422` for an unknown tab. Import errors may be plain text. Read the returned message for the reason.
