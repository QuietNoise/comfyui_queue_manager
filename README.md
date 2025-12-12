# ComfyUI Queue Manager

An extension supporting more streamlined prompt queue management.

## Table of Contents
- [Quickstart](#quickstart)
- [Important](#important)
- [Features](#features)
- [Compatibility](#compatibility)
- [Roadmap](#roadmap)
- [Manual](#manual)
  - [Pause / Resume Queue](#pause--resume-queue)
  - [Running and main Queue Manager window](#running-and-main-queue-manager-window)
  - [Archive](#archive)
  - [Export and Import](#export-and-import)
  - [Filter by workflow](#filter-by-workflow)
  - [Restore client focus](#restore-client-focus)
  - [Workflow Name node](#workflow-name-node)
  - [External jobs](#external-jobs)
  - [Comfy API / Partner Nodes](#comfy-api--partner-nodes)
- [Troubleshooting](#troubleshooting)
- [Tips and words of wisdom](#tips-and-words-of-wisdom)
- [Development](#development)
- [Have fun!](#have-fun)

## Quickstart

1. Install [ComfyUI](https://docs.comfy.org/get_started).
2. Install [ComfyUI-Manager](https://github.com/ltdrdata/ComfyUI-Manager) if it is not already installed (recent versions come with it already).
3. Look up this extension in ComfyUI-Manager (ComfyUI Queue Manager). If you are installing manually, clone this repository under `ComfyUI/custom_nodes`.
4. Restart ComfyUI.

## Important

- EARLY ACCESS RELEASE, PROOF OF CONCEPT, PROTOTYPE. This is an early access release of the ComfyUI Queue Manager. While fully functional, things will change, a lot.
- Releasing just because I want to get feedback and free labour for testing. Been using it for a while now, and it helped me immensely to manage my renders.
- Many features still not implemented, but the core functionality is there and roadmap is set.

## Features
- Persistence. Queue is now saved in a local database and restored on ComfyUI restart.
- Option to archive queue items to play them later.
- Export and import queue to / from a file.
- Pause and resume queue.
- Filter by workflows and then archive, delete and export filtered view only.

## Compatibility
- This extension requires the new ComfyUI menu.
- When this extension is enabled then the native queue will no longer display pending queue items. However, history will still be there.
- This extension hijacks several native queue processes from ComfyUI and front end and alters / disables some of them to provide a more streamlined experience.
- This extension might be incompatible with other extensions that directly manipulate or read the native queue object.
- Other than that an effort was made to retain compatibility as much as possible (internal events, messages, queue api endpoints still work as before).

### IMPORTANT! Multiple accounts / users are not supported
- This extension does not support multiple accounts / users.
- If you intend your ComfyUI instance to be used by multiple users logged in to Comfy.org at the same time then this extension will produce unexpected results.
- It's highly recommended to avoid using this extension in such multi-user scenarios as users will see each other's jobs, might unintentionally end-up using each other's Comfy Cloud credits etc.
- Let me reiterate: this extension is NOT intended to be used to manage queues in multi-account ComfyUI deployments.
- If there is enough demand for multi-user support I will consider adding it in future releases.

## Roadmap
In no particular order, just some ideas I have for the future of this extension.
- [ ] Options. Toggles, big red buttons, levers and valves to control Queue Manager's behavior. Now everything is hardcoded.
- [ ] Queue Manager nodes. On top of Workflow Name node add some other queue related strings you could use to streamline your workflows i.e. custom file names.
- [ ] Bin. Can't think of a use case for it yet but I feel like it should be there at some stage.
- [ ] Cover images, thumbnails, previews of rendered images in the queue. In other words what we have in core queue History with some spices added.
- [ ] More columns in the queue table. Suggest your favourites.
- [ ] Better user and dev docs.
- [ ] Better progress feedback for longer running actions (like import).

and other things I forgot about.

## Manual
### Pause / Resume Queue
Click the pause button to pause the queue.
Currently running workflow will finish, but no new workflows will be started until you resume the queue.

![pause.png](readme-img/pause.png)

Click the play button to resume the queue.

![resume.png](readme-img/resume.png)

### Running and main Queue Manager window
You can start running jobs as usual using the Run button in the main ComfyUI window.

To view the Queue Manager window, click the Queue Manager button in the sidebar menu.

![main-window.png](readme-img/main-window.png)

On the right you have action buttons like Delete, Load, Archive, Run which are applicable to a single item in the queue.

On the bottom you have buttons like Archive All, Export Queue etc. which are applicable to all items in the current tab.

When button on the bottom has a asterisk `*` next to it, it means that the action will be applied to the items in filtered view only (see **Filter by workflow** below).


### Archive
**Archive** is a place where you can park your queue items to play them later.

When in the **Queue** tab you can archive individual items by clicking the **Archive** button in the actions columns or you can archive all items in the queue by clicking the **Archive All** button on the bottom of the window.

Similarly, when in **Archive** tab you can play archived items by clicking the **Run** button in the actions column or you can play all archived items by clicking the **Run All** button on the bottom of the window.

### Export and Import

You can export items from any tab (Queue, Archive, Completed) to a file by clicking the Export Queue/Archive/Completed button on the bottom of the window.
You can import items from a file to the Queue or to the Archive by clicking the Import Queue/Archive button on the bottom of the window.

### Filter by workflow
You can filter the currently displayed list of items by workflow by clicking on the name in the workflow column.

Once filtered out the group actions on the bottom of the window (like `Archive All *`, `Run All *`, `Delete All *`) will only apply to the filtered items.

Asterisk `*` next to the button label indicates that the action will be applied to the filtered items only.

![filters.png](readme-img/filters.png)

### Restore client focus
When you restart ComfyUI or browser, you might lose the client focus. When that happens the progress of running renders in ComfyUI will no longer update (no progress view, no previews, no highlights which nodes is being executed).

To restore the client focus, click the three vertical dots menu and select `Take over focus`. The effect will take place after currently running job (if any) finishes.

![focus.png](readme-img/focus.png)

### Workflow Name node
You can use the Workflow Name node to get the name of the currently running workflow.
Typical use case is to connect the `workflow_name` output to a node that accepts a string input, like **Save Image**'s `filename_prefix`, to have output images saved with the workflow's name as a prefix.

![workflow_name_use_case.png](web/docs/workflow_name_use_case.png)

### External jobs
- Some third parties that queue through API don't supply full ComfyUI workflow context (i.e. ComfyUI plugin for Krita).
- Since these renders won't benefit from the Queue Manager features we delegate these jobs to native queue handler and mark as external.
- These jobs will appear in the native queue side bar; and the Queue Manager itself will indicate if such job is currently running.

![external-job.png](readme-img/external-job.png)
- Also any such jobs will always take precedence over items queued in Queue Manager.
- **IMPORTANT! This accommodation for such external jobs is a workaround measure.** When I have time I will investigate if there is a better way to handle this scenario. To avoid potential conflicts and unexpected behavior it's recommended to avoid using such third party plugins while running jobs from Queue Manager (and vice versa).

### Comfy API / Partner Nodes
1. This extension supports usage of Comfy API (Partner Nodes) in queued workflows.
2. To use Partner Nodes in queued workflows you must be logged in to Comfy.org using Comfy API Key (https://docs.comfy.org/account/login#logging-in-with-an-api-key).
3. When your Comfy API Key is deleted or revoked then all jobs in the queue that were queued with that key and used Partner Nodes, will fail. To run such jobs you need to requeue them; the best way to do it is to export them, log-in with your new Comfy API Key and then import the exported items back.
4. **IMPORTANT!** When you queue jobs while logged in with Comfy API key then those jobs will get through (and use your credits if you used Partner nodes) even if you log out from ComfyUI or Comfy.org.
5. Conversely, if you queue jobs with Partner nodes while NOT logged in with Comfy API key then those jobs will NOT be able to use Partner nodes even if you log in later before running them. (See point 3. above for export-import workaround).

## Troubleshooting
#### I updated custom nodes and can no longer load items from queue or play from Archive or items imported from file.

Sometimes updates to custom nodes introduce breaking changes to the node's internals that are incompatible with that node's old version. When that happens trying to play workflows with old version of the affected custom node will fail.

There is no permanent fix for this. You can either re-create the affected workflows with the updated version of the custom node or downgrade the offending custom note to the same version as the node used to queue the workflow that failed.

#### I updated ComfyUI and Queue Manager is no longer working properly.

In rare cases updates to ComfyUI introduce breaking changes that affect Queue Manager functionality.
Report the issue on the extension's GitHub page and I will try to address it as soon as possible.

#### I exported queue to file and imported on another device but I can't play it there

Similarly to points above, if the target device has different versions of custom nodes or different versions of ComfyUI they might be incompatible. There is no fix for that other than ensuring source and destination devices have same versions of ComfyUI and affected custom nodes.
Check the error message in the ComfyUI terminal to identify the affected custom nodes.


## Tips and words of wisdom
- Before updating ComfyUI or custom nodes it's best to finish all queued and archived jobs to avoid potential incompatibility issues with new versions of ComfyUI or custom nodes.
- While the ComfyUI Queue Manager offers data persistence between restarts and crashes as well as import/export functionality, it's not intended to provide a long term storage for queue jobs. Updates to ComfyUI and custom nodes might introduce breaking changes that will affect queued and archived jobs and make them unplayable. Run your queued and archived jobs as soon as possible to avoid such issues.


## Development
Don't lol. Things will change and move around a lot.
Nevertheless, here are some pointers if you have some PR ideas for critical fixes or features:
- `/web` is the front end part of the extension.
  - Inside is `.gui` folder which is hidden from default ComfyUI UI, but it's where the build version of the Queue Manager is.
- The core front end functionality of the Queue Manager is a Next.js app loaded in an iframe (from  `.gui` folder). It communicates with loading part of the extension by postMessage API.
- Server side (python) part of the extension is in `/src/comfyui_queue_manager`
- Source code for the Next.js app is in `/src/gui`
- database is in `/data/` (sqlite files are created automatically on first run)

Better docs will come later.

## Have fun!
Queue all the way to the moon.
