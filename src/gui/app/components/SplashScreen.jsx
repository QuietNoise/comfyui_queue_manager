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
        <h4 className={"sub"}>Version: v0.2.1</h4>
        <h4 className={"sub"}>Released: 18<sup>th</sup> October 2026</h4>
        <h2>What's new?</h2>
        <h3>Bugfixes</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>Fixed empty image or GIF output lists crashing job completion and stopping further prompt execution.</li>
          <li>Restored Pause/Resume and Clear pending buttons on ComfyUI 0.41 after the toolbar refactor.</li>
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
