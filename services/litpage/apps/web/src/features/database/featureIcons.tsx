// Icons of the task-database features (sub-items, dependencies, sprints, layout builder, permissions) under 
// icon names (glyphs from Lucide — no SVGs).
import * as L from 'lucide-react';
import { registerIcons } from '../../components/Icon.tsx';

registerIcons({
  listToggleIndent: L.ListTree, arrowTurnDownRight: L.CornerDownRight, integration: L.Puzzle, sprint: L.IterationCw,
  calendarRepeat: L.CalendarSync, radioOn: L.CircleDot, radioOff: L.Circle, pin: L.Pin, pinFill: L.Pin, panelRight: L.PanelRight,
  panelRightClose: L.PanelRightClose, rows: L.Rows3, tabs: L.PanelTop, verified: L.BadgeCheck, unverified: L.BadgeAlert,
  personShield: L.ShieldUser, shieldCheck: L.ShieldCheck, eyeOff: L.EyeOff, copy: L.Copy, mapPin: L.MapPin, crosshair: L.LocateFixed,
  download: L.Download, maximize: L.Maximize, gripVertical: L.GripVertical, arrowDiagonalDownLeftSmall: L.ArrowDownLeft, infoCircleSmall: L.Info,
});
