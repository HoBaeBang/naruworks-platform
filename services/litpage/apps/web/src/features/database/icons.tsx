import * as L from 'lucide-react';
import { registerIcons } from '../../components/Icon.tsx';
registerIcons({
  arrowLineRight: L.ArrowRightToLine, eyeSlash: L.EyeOff,
  alarmClock: L.AlarmClock, numbers123: L.Hash,
  flag: L.Flag, checkmarkSquare: L.SquareCheck, arrowExpandHorizontal: L.MoveHorizontal, collection: L.Database,
  archiveBoxSmall: L.Archive, questionMarkCircleSmall: L.CircleHelp, viewChart: L.ChartPie, form: L.ClipboardPen,
  bulletedList: L.List, minus: L.Minus, squareOnSquarePlus: L.CopyPlus, curlyBraces: L.Braces, equalSquare: L.SquareEqual, pencilLine: L.PencilLine,
  // arrowUpDown glyph reads ↓↑ (down arrow first: toolbar / header menu / view settings)
  xMarkSmall: L.X, xMark: L.X, filterSmall: L.ListFilter,
  arrowUpDown: L.ArrowDownUp, lightningSmall: L.Zap, magnifyingGlassSmall: L.Search, sliders: L.SlidersHorizontal,
  arrowExpandDiagonal: L.Maximize2, pinSlash: L.PinOff, arrowUTurnDownLeft: L.CornerDownLeft, layout: L.LayoutTemplate,
  plusFillSmall: L.Plus, pointer: L.Navigation, arrowStraightLeftSmall: L.ArrowLeft, lockSmall: L.Lock, cursorButton: L.SquareMousePointer,
  arrowTriangleDownCircle: L.CircleChevronDown, friends: L.Users, attachment: L.Paperclip, phoneCall: L.Phone, username: L.AtSign,
  calendarDate: L.CalendarDays, linkSmall: L.Link, sortAscending: L.ArrowUpNarrowWide, sortDescending: L.ArrowDownWideNarrow,
  pageEmpty: L.File, folderSmall: L.Folder, upload: L.Upload, tableRows: L.Rows3, dotsSixVertical: L.GripVertical, eyeOpen: L.Eye,
});

export {};
