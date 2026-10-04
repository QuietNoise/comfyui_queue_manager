import VerticalAlignTopIcon from '@mui/icons-material/VerticalAlignTop';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import VerticalAlignBottomIcon from '@mui/icons-material/VerticalAlignBottom';
import {moveSelectionTo} from '../internals/queueReorder.mjs';

export function QueueMoveButtons({ids, selected, route, disabled, onMove}) {
  const list = route === 'archive' ? 'archive' : 'queue';
  const actions = [
    {destination: 'start', label: `Start of ${list}`, Icon: VerticalAlignTopIcon,
      title: `Move selected jobs to the start of the ${list}.`},
    {destination: 'page_top', label: 'Top of page', Icon: KeyboardArrowUpIcon,
      title: 'Move selected jobs to top of this page'},
    {destination: 'page_bottom', label: 'Bottom of page', Icon: KeyboardArrowDownIcon,
      title: 'Move selected jobs to bottom of this page'},
    {destination: 'end', label: `End of ${list}`, Icon: VerticalAlignBottomIcon,
      title: `Move selected jobs to the end of the queue ${list}.`},
  ];
  const renderAction = ({destination, label, Icon, title}) => {
    const request = moveSelectionTo(ids, selected, destination);
    return <button key={destination} type="button" className="shiny-button" title={title}
      disabled={disabled || !request} onClick={() => onMove(request)}>
      <Icon fontSize="small" />{label}
    </button>;
  };
  return <div className="selection-move-toolbar" role="group" aria-label="Move selected jobs" data-selection-ignore>
    <div className="selection-move-start">{actions.slice(0, 2).map(renderAction)}</div>
    <span className="selection-move-label">- Move selection to -</span>
    <div className="selection-move-end">{actions.slice(2).map(renderAction)}</div>
  </div>;
}
