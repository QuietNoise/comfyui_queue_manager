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
        <h4 className={"sub"}>Version: v0.1.2</h4>
        <h4 className={"sub"}>Released: 27<sup>th</sup> September 2026</h4>
        <h2>What's new?</h2>
        <h3>Job cancellation fix</h3>
        <p>Fixed job history errors after cancelling a running job on recent ComfyUI versions.</p>
        <p><br/>
          <i>For more details check the updated manual on Github: <a href={"https://github.com/QuietNoise/comfyui_queue_manager?tab=readme-ov-file#manual"} target={"_blank"}>Queue Manager Manual</a>.</i><br/>
          <i>For full Release Notes view <a href={"https://github.com/QuietNoise/comfyui_queue_manager/blob/main/CHANGELOG.md"} target={"_blank"}>Changelog</a>.</i><br />
          <i>Leave a feedback or report an issue here <a href={"https://github.com/QuietNoise/comfyui_queue_manager/issues"} target={"_blank"}>Issues</a>. </i>
        </p>

      </div>
    </div>
  );
}
