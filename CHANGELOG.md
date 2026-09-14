# Release Notes

## v0.1.1

_Sep 14, 2026_

### Enhancements

- Enhanced **Workflow Name** node with a single `text` input that accepts a typed value or a connected string. As such **Queue Manager** can now use the first active **Workflow Name** node to name queued jobs.

---

## v0.1.0
_Sep 06, 2026_
### New features and enhancements
- Major update with focus on providing previews for completed jobs, gallery and UI improvements.
- A new settings panel is available in **ComfyUI Menu → Settings → Queue Manager** where you can influence certain features of the extension (#11, #17).
- From now on completed jobs will show total execution time (#3).

### Bugfixes
- Fixed: Export function did not respect the tab from which it was used.
- Light theme color fixes;

## v0.0.19
_Sep 06, 2025_
### New features and enhancements
Fixed PLAY and STOP buttons disappearing when toggling side-bar [#28]

---

## v0.0.18
_Sep 05, 2025_
### New features and enhancements
Fixed PLAY and STOP buttons for new versions of ComfyUI

---

## v0.0.17
_Dec 21, 2025_
### New features and enhancements
- Added legacy-like **Stop / Clear queue** button removed in ComfyUI 0.4.0
- Added **Delete All Pending** button (equivalent to native Stop / Clear all)
- Added **queue counter badge** to the Queue Manager tab button (required since native Queue tab removal in ComfyUI 0.4.0+) (#24)

---

## v0.0.16
_Dec 13, 2025_
### Bugfixes
- Fixed **Pause / Play button** compatibility with ComfyUI 1.33.1+ (#21)

---

## v0.0.15
_Dec 12, 2025_
### Enhancements
- Compatibility fixes for **ComfyUI 0.3.68** (#15, #16)
- Added support for **Partner Nodes**
- Improved handling of **Comfy API keys**
- Added warning regarding **lack of multi-account support**
- Troubleshooting improvements and common issue fixes

---

## v0.0.14
_Nov 25, 2025_
### Bugfixes
- Fixed **Pause / Resume button** not displaying correctly (#13)

---

## v0.0.13
_Nov 25, 2025_
### Bugfixes
- Fixed error: `this.fetchApi is not a function`

  _(Resolved issues #8, #18, and #20)_

---

## v0.0.12
_Nov 06, 2025_
### Bugfixes
- Workaround fix for **“Works for only one generation”** issue (#15)

---

## v0.0.11
_Nov 06, 2025_
### Bugfixes
- Fixed **bad asset URLs**
- Included missing build files in packaged release

---
## v0.0.9
_Nov 04, 2025_
### Enhancements
- Better handling of external jobs (#12)

---

## v0.0.8
_Oct 26, 2025_
### Bugfixes
- Fixed inability to cancel running jobs on older ComfyUI versions when using newer extension versions (#10)

---

## v.0.0.6
_Oct 20, 2025_
### Bugfixes
- Fix to the container size inside ComfyUI sidebar;

---

## v.0.0.5
_Oct 19, 2025_
### Bugfixes
- Side bar icon label fix
- Failed to load GUI on windows. (#4)
- No longer able to cancel current item in queue. (#7)

---

## v.0.0.3
_Jun 29, 2025_
### New features
- Added **Workflow Name** string node. The node emits the currently running workflow's name as a string.

---

## v.0.0.2
_Jun 25, 2025_
### Bugfixes
- addressed "missing NODE_CLASS_MAPPINGS" nag (#1)

---

## v.0.0.1 - Initial Release
_Jun 25, 2025_
- First stable draft of the project.
