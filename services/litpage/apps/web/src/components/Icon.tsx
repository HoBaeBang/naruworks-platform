import type { CSSProperties, ReactNode } from 'react';
import * as L from 'lucide-react';

type LucideProps = { size?: number; strokeWidth?: number; className?: string; style?: CSSProperties; fill?: string };
type LucideComp = (p: LucideProps) => ReactNode;
const filled = (Comp: LucideComp): LucideComp => (p) => <Comp {...p} fill="currentColor" />;

const lucide: Record<string, LucideComp> = {
  sidebarLeft: L.PanelLeft, inbox: L.Inbox, compose: L.SquarePen, home: L.House, chat: L.MessageCircle, chatBubble: L.MessageCircle,
  chatBubblePlus: L.MessageCirclePlus, meetings: L.CalendarDays, calendar: L.Calendar, bookshelf: L.LibraryBig, library: L.LibraryBig,
  ellipsis: L.Ellipsis, ellipsisSmall: L.Ellipsis, plus: L.Plus, plusSmall: L.Plus, arrowDiagonalUpRightSmall: L.ArrowUpRight,
  search: L.Search, settings: L.Settings, gear: L.Settings, questionMark: L.CircleHelp, help: L.CircleHelp, apps: L.LayoutGrid, star: L.Star,
  starFilled: L.Star, lock: L.Lock, unlock: L.LockOpen, link: L.Link, share: L.Share, trash: L.Trash2, duplicate: L.Copy, copy: L.Copy,
  arrowTurnUpRight: L.CornerUpRight, commentFilled: L.MessageSquare, comment: L.MessageSquare, commentPencil: L.MessageSquareDiff,
  aiFace: L.Sparkles, ai: L.Sparkles, paperBolt: L.FileBox, blockColor: L.Paintbrush, arrowSquarePathUpDown: L.Repeat,
  textNormal: L.Type, listBullet: L.List, listNumber: L.ListOrdered, checklist: L.ListChecks, listToggle: L.ListCollapse,
  page: L.FileText, pageEmpty: L.File, calloutBlock: L.SquareChartGantt, quote: L.Quote, viewTable: L.Table2, dashLong: L.Minus,
  docSend: L.FileSymlink, photo: L.Image, playButton: L.CirclePlay, volumeOn: L.Volume2, code: L.CodeXml, paperClip: L.Paperclip,
  bookmark: L.Bookmark, viewBoard: L.SquareKanban, squareGrid2X2: L.LayoutGrid, listDash: L.LayoutList, newspaper: L.Newspaper,
  viewDashboard: L.LayoutDashboard, viewCalendar: L.CalendarDays, viewTimeline: L.ChartGantt, map: L.Map, chartBarXAxis: L.ChartColumn,
  chartBarYAxis: L.ChartBar, chartLine: L.ChartLine, donutChart: L.ChartPie, number: L.Hash, inlineBlockDouble: L.ClipboardList,
  databaseEmbed: L.Database, collectionArrow: L.SquareArrowOutUpRight, tableOfContents: L.TableOfContents, sumSquare: L.Sigma,
  arrowInRectangleRight: L.SquareMousePointer, docHashtag: L.Navigation, tabs: L.PanelsTopLeft, blockSync: L.RefreshCw,
  whaleTail: L.Workflow, aiBlock: L.Sparkle, paperMicrophone: L.FileAudio, personCircle: L.CircleUser, clock: L.Clock, emojiFace: L.Smile,
  squareRoot: L.Radical, linkCapture: L.SquareCode, filePdf: L.FileText, fileCsv: L.FileSpreadsheet, textJustifyLeft: L.FileType,
  zipFile: L.FileArchive, check: L.Check, checkmarkSmall: L.Check, close: L.X, xSmall: L.X, x: L.X, arrowLeft: L.ArrowLeft, arrowRight: L.ArrowRight,
  arrowUp: L.ArrowUp, arrowDown: L.ArrowDown, chevronLeft: L.ChevronLeft, chevronRight: L.ChevronRight, chevronDown: L.ChevronDown,
  chevronUp: L.ChevronUp, arrowChevronSingleRightSmall: L.ChevronRight, arrowChevronDoubleRight: L.ChevronsRight, arrowChevronDoubleLeft: L.ChevronsLeft,
  bell: L.Bell, bellOff: L.BellOff, upload: L.Upload, download: L.Download, import: L.Import, export: L.FileOutput, globe: L.Globe,
  user: L.User, users: L.Users, userPlus: L.UserPlus, filter: L.ListFilter, sort: L.ArrowUpDown, lightning: L.Zap, history: L.History,
  undo: L.Undo2, redo: L.Redo2, eye: L.Eye, eyeOff: L.EyeOff, pin: L.Pin, archive: L.Archive, refresh: L.RotateCw, edit: L.Pencil,
  pencil: L.Pencil, info: L.Info, warning: L.TriangleAlert, mail: L.Mail, phone: L.Phone, at: L.AtSign, hash: L.Hash, sliders: L.SlidersHorizontal,
  moon: L.Moon, sun: L.Sun, monitor: L.Monitor, logout: L.LogOut, template: L.LayoutTemplate, puzzle: L.Puzzle, building: L.Building2,
  team: L.Users, teamspace: L.Users, globeLock: L.Earth, sparkles: L.Sparkles, wand: L.WandSparkles, translate: L.Languages, text: L.Text,
  fullWidth: L.MoveHorizontal, fontSize: L.ALargeSmall, image: L.Image, video: L.Video, music: L.Music, file: L.File, folder: L.Folder,
  grip: L.GripVertical, move: L.Move, maximize: L.Maximize2, minimize: L.Minimize2, sidePeek: L.PanelRight, centerPeek: L.SquareSquare,
  fullPage: L.Maximize, openAsPage: L.ArrowUpRight, collapse: L.ChevronsDownUp, expand: L.ChevronsUpDown, checkboxChecked: L.SquareCheck,
  checkbox: L.Square, select: L.CircleChevronDown, multiSelect: L.List, status: L.Loader, date: L.Calendar, person: L.User, files: L.Paperclip,
  url: L.Link, email: L.AtSign, formula: L.Sigma, relation: L.ArrowUpRight, rollup: L.Search, createdTime: L.Clock, createdBy: L.CircleUser,
  editedTime: L.Clock, editedBy: L.CircleUser, button: L.SquareMousePointer, id: L.Fingerprint, verification: L.BadgeCheck, location: L.MapPin,
  textProp: L.AlignLeft, numberProp: L.Hash, rocket: L.Rocket, gift: L.Gift, mobile: L.Smartphone, desktop: L.Monitor, keyboard: L.Keyboard,
  shield: L.Shield, key: L.KeyRound, creditCard: L.CreditCard, sparkle: L.Sparkle, mic: L.Mic, send: L.Send, attach: L.Paperclip, stop: L.Square,
  cornerDownLeft: L.CornerDownLeft, wrap: L.WrapText, alignLeft: L.AlignLeft, alignCenter: L.AlignCenter, alignRight: L.AlignRight,
  crop: L.Crop, rotate: L.RotateCw, replace: L.Replace, captions: L.Captions, columns: L.Columns2, rows: L.Rows2, unfold: L.UnfoldVertical,
  // inline formatting toolbar / inline atoms (editor)
  textBold: L.Bold, textItalic: L.Italic, textUnderline: L.Underline, textStrikethrough: L.Strikethrough, textX: L.RemoveFormatting,
  emojiFacePlus: L.SmilePlus, globeSmall: L.Globe, docOnDoc: L.Copy, pencilLineSmall: L.PencilLine, alarm: L.AlarmClock,
  arrowTurnDownLeftSmall: L.CornerDownLeft, questionMarkCircle: L.CircleHelp, peopleFill: L.Users, arrowDiagonalUpRight: L.ArrowUpRight,
  thumbsUp: L.ThumbsUp, thumbsDown: L.ThumbsDown, arrowChevronSingleDownSmall: L.ChevronDown, pageLink: L.FileSymlink,
  emojiNature: L.Leaf, emojiFood: L.Carrot, emojiActivity: L.Volleyball, emojiTravel: L.Plane, emojiObjects: L.Lightbulb,
  emojiSymbols: L.CircleCheck, emojiFlags: L.Flag, emojiCustom: L.LayoutGrid, plusCircleFill: L.CirclePlus, arrowChevronSingleLeftSmall: L.ChevronLeft,
  // Lucide fallbacks for names previously represented by custom drawings.
  xMarkCircleFill: L.CircleX,
  litpage: L.FileText,
  lockFill: filled(L.Lock),
  arrowChevronSingleDownFill: L.ChevronDown,
  litAiFace: L.Sparkles,

  arrowCaretDownFillSmall: filled(L.Triangle),
  arrowChevronDoubleForward: L.ChevronsRight,
  arrowChevronDoubleForwardSmall: L.ChevronsRight,
  arrowChevronDoubleUpAndDownFillSmall: L.ChevronsUpDown,
  arrowChevronSingleDownFillSmall: L.ChevronDown,
  arrowChevronSingleLeft: L.ChevronLeft,
  arrowChevronSingleLeftFillSmall: L.ChevronLeft,
  arrowChevronSingleRight: L.ChevronRight,
  arrowChevronSingleRightFillSmall: L.ChevronRight,
  arrowChevronSingleUp: L.ChevronUp,
  arrowCircleLoopBackward: L.RotateCcw,
  arrowExpandDiagonalBottomLeftToTopRightSmall: L.ArrowUpRight,
  arrowExpandDiagonalSmall: L.Maximize2,
  arrowInCircleUpFill: L.ArrowUpCircle,
  arrowIntersectRightSmall: L.ArrowRight,
  arrowLineDownSmall: L.ArrowDownToLine,
  arrowRectangleLeft: L.SquareArrowLeft,
  arrowRectangleRight: L.SquareArrowRight,
  arrowStraightLeftFillSmall: L.ArrowLeft,
  arrowStraightRightFill: L.ArrowRight,
  arrowStraightRightFillSmall: L.ArrowRight,
  arrowStraightUpFillSmall: L.ArrowUp,
  arrowTurnLeftUp: L.CornerUpLeft,
  arrowUpDownSmall: L.ArrowUpDown,
  arrowUpDownStacked: L.ChevronsUpDown,
  arrowUTurnUpRightFill: L.CornerUpRight,
  checkmarkCircle: L.CircleCheck,
  circleFillSmall: filled(L.Circle),
  circleGrid2X2: L.Grid2X2,
  circlesConcentric: L.CircleDashed,
  dragHandle: L.GripVertical,
  dragHandleFillSmall: L.GripVertical,
  dragHandleSmall: L.GripVertical,
  emojiFaceFill: filled(L.Smile),
  emojiFacePlusSmall: L.SmilePlus,
  filterCircle: L.Filter,
  infoCircleFill: L.Info,
  peekCenter: L.SquareSquare,
  peekFull: L.Maximize,
  personCircleFill: filled(L.CircleUserRound),
  personKeyFill: L.KeyRound,
  plusCircleFillSmall: L.CirclePlus,
  rectangleSplit2Vertical: L.SquareSplitVertical,
  rectangleSplit2VerticalSmall: L.SquareSplitVertical,
  stack: L.Layers,
  xMarkFill: L.X,
  xMarkFillSmall: L.X,
  agentFace: L.Bot,
  aiAnalyze: L.BrainCircuit,
  aiNoticeDot: L.Sparkles,
  aiShieldCheck: L.ShieldCheck,
  aiSidebarMode: L.PanelLeft,
  aiSummarize: L.Summary,
  aiTaskTracker: L.ListChecks,
  arrowCaretRightFillSmall: filled(L.TriangleRight),
  burst: L.Sparkles,
  calendarConnect: L.CalendarSync,
  chevronDownNarrow: L.ChevronDown,
  commandSmall: L.Command,
  dbDuplicate: L.Copy,
  dbEye: L.Eye,
  dbEyeSlash: L.EyeOff,
  dbFilter: L.ListFilter,
  dbGroup: L.UsersRound,
  dbLightning: L.Zap,
  dbLink: L.Link,
  dbPageEmpty: L.File,
  dbPin: L.Pin,
  dbToolExpand: L.Maximize2,
  dbToolFilter: L.ListFilter,
  dbToolLightning: L.Zap,
  dbToolSearch: L.Search,
  dbToolSettings: L.Settings,
  dbTrash: L.Trash2,
  dbTurnInto: L.Replace,
  dbViewBoard: L.SquareKanban,
  dbViewCalendar: L.CalendarDays,
  dbViewChart: L.ChartNoAxesCombined,
  dbViewDashboard: L.LayoutDashboard,
  dbViewFeed: L.Rss,
  dbViewForm: L.ClipboardList,
  dbViewGallery: L.GalleryHorizontal,
  dbViewList: L.List,
  dbViewMap: L.Map,
  dbViewTable: L.Table2,
  dbViewTimeline: L.ChartGantt,
  dragHandleHorizontal: L.GripHorizontal,
  filePdfLabel: L.FileType2,
  font: L.Type,
  google: L.Globe,
  importAsana: L.Import,
  importConfluence: L.Import,
  importEvernote: L.Import,
  importGoogleDocs: L.Import,
  importJira: L.Import,
  importMonday: L.Import,
  importQuip: L.Import,
  importTrello: L.Import,
  importWord: L.Import,
  importWorkflowy: L.Import,
  libCaretRight: L.ChevronRight,
  libClockFill: L.Clock3,
  libDocFill: L.FileText,
  libGridFill: L.Grid2X2,
  libLocationFill: L.MapPin,
  libPaperMic: L.FileAudio,
  libPaperSkill: L.FileBadge,
  libSitemapFill: L.Network,
  libTextLines: L.List,
  libUserCircleFill: filled(L.CircleUserRound),
  lockKeyhole: L.LockKeyhole,
  magicWand: L.WandSparkles,
  magicWandSmall: L.WandSparkles,
  magicWandSparkle: L.WandSparkles,
  marketplaceMark: L.Store,
  markRead: L.MailCheck,
  markUnread: L.MailOpen,
  microsoft: L.Globe,
  litLogo: L.SquareKanban,
  numero: L.Hash,
  openAi: L.Bot,
  pageControlComment: L.MessageSquare,
  pageControlCover: L.Image,
  pageControlFace: L.Smile,
  paintRoller: L.PaintRoller,
  pathRoundEnds: L.Spline,
  peekSideFill: L.PanelRight,
  propCheckbox: L.SquareCheck,
  propDate: L.Calendar,
  propEmail: L.AtSign,
  propMultiSelect: L.List,
  propNumber: L.Hash,
  propPerson: L.User,
  propPhone: L.Phone,
  propRelation: L.ArrowUpRight,
  propRollup: L.Search,
  propSelect: L.CircleChevronDown,
  propText: L.AlignLeft,
  propUrl: L.Link,
  rectangleSplit2: L.TableColumnsSplit,
  rectangleSplit3: L.TableColumnsSplit,
  rectangleSplit4: L.TableColumnsSplit,
  rectangleSplit5: L.TableColumnsSplit,
  sidebarTabChat: L.MessageCircle,
  sidebarTabCustom: L.Puzzle,
  sidebarTabHome: L.House,
  sidebarTabMeetings: L.CalendarDays,
  slidersTwo: L.SlidersHorizontal,
  sum: L.Sigma,
  textAlignLeft: L.AlignLeft,
  textFormat: L.Type,
  textH1: L.Heading1,
  textH1Toggle: L.Heading1,
  textH2: L.Heading2,
  textH2Toggle: L.Heading2,
  textH3: L.Heading3,
  textH3Toggle: L.Heading3,
  textH4: L.Heading4,
  textH4Toggle: L.Heading4,
  textTranslate: L.Languages,
  triangleDown: filled(L.Triangle),
  triangleRight: filled(L.TriangleRight),
  warningTriangleFill: filled(L.TriangleAlert),
};
/** Feature-local icon names can register Lucide components without editing this table. Existing names win. */
const extra: Record<string, LucideComp> = {};
const overrides: Record<string, LucideComp> = {};
export function registerIcons(map: Record<string, LucideComp>, opts?: { override?: boolean }) {
  for (const [k, v] of Object.entries(map)) {
    if (opts?.override) overrides[k] = v;
    else if (!lucide[k] && !extra[k]) extra[k] = v;
  }
}

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
  title?: string;
}

export function Icon({ name, size = 20, color, className, style, strokeWidth, title }: IconProps) {
  const st: CSSProperties = { color: color ?? 'currentColor', display: 'block', flexShrink: 0, ...style };
  const Comp = overrides[name] ?? lucide[name] ?? extra[name] ?? L.Circle;
  return (
    <span className={`lit-icon ${name} ${className ?? ''}`} style={{ ...st, display: 'inline-flex' }} role="graphics-symbol" aria-label={title}>
      <Comp size={size} strokeWidth={strokeWidth ?? (size <= 16 ? 1.75 : 1.6)} />
    </span>
  );
}

export function hasIcon(name: string) {
  return !!lucide[name] || !!extra[name] || !!overrides[name];
}

/** Every registered icon name. */
export function iconNames(): string[] {
  return [...new Set([lucide, extra, overrides].flatMap((m) => Object.keys(m)))].sort();
}

/** Where a registered icon comes from. */
export function iconSource(name: string): 'lucide' | null {
  return overrides[name] || lucide[name] || extra[name] ? 'lucide' : null;
}
