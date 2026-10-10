import Button from "@mui/material/Button";
import CloseSharpIcon from '@mui/icons-material/CloseSharp';

export function SplashScreen({onClick}) {
  return (
    <div className="splash-screen">
      <Button className={"close"} onClick={onClick}>
        <CloseSharpIcon />
      </Button>
      <div className="splash-content">
        <h1>ComfyUI Queue Manager</h1>
        <h4 className={"sub"}>Version: v0.2.0</h4>
        <h4 className={"sub"}>Released: 8<sup>th</sup> October 2026</h4>
        <h2>What's new?</h2>
        <h3>Enhancements</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>Reorder pending and archived jobs.</li>
          <li>Select queue items and apply actions to the selected group.</li>
          <li>Rename pending and archived jobs directly in the Workflow column, individually or as a selected group.</li>
          <li>Switch filtered views between workflow identity and an exact workflow name.</li>
          <li>Hold Shift while archiving pending jobs to place them at the start of the Archive.</li>
          <li>Optional <strong>Clean caches on Pause</strong> setting to unload models and clear execution caches when the queue is paused. Off by default.</li>
          <li>Manage API-submitted jobs alongside jobs queued from the GUI.</li>
        </ul>
        <p><br/>
          <i>For more details check the updated manual on Github: <a href={"https://github.com/QuietNoise/comfyui_queue_manager?tab=readme-ov-file#manual"} target={"_blank"}>Queue Manager Manual</a>.</i><br/>
          <i>For full Release Notes view <a href={"https://github.com/QuietNoise/comfyui_queue_manager/blob/main/CHANGELOG.md"} target={"_blank"}>Changelog</a>.</i><br />
          <i>Leave a feedback or report an issue here <a href={"https://github.com/QuietNoise/comfyui_queue_manager/issues"} target={"_blank"}>Issues</a>. </i>
        </p>

      </div>
    </div>
  );
}
