import type React from "react";
import {
  ShieldCheck,
  LockKeyhole,
  UserRound,
  CalendarDays,
  Copy,
  Search,
  NotebookPen,
  ChevronDown,
  TriangleAlert,
  Clock,
  Check,
  Info,
  House,
  Folder,
  ClipboardCheck,
  Upload,
  ArrowDown,
  ArrowUp,
  Minus,
  ArrowRight,
  ArrowLeft,
  X,
  Calculator,
  RefreshCw,
  LogOut,
  Unlink,
  Languages,
  Eye,
  Pencil,
  RotateCcw,
  FileText,
  SlidersHorizontal,
  Hourglass,
  Circle,
  type LucideIcon,
} from "lucide-react";
import type { MessageKey } from "../i18n/messages";
const icons: Record<string, LucideIcon> = {
  admin: ShieldCheck,
  adminLocked: LockKeyhole,
  user: UserRound,
  calendar: CalendarDays,
  copy: Copy,
  search: Search,
  note: NotebookPen,
  chevron: ChevronDown,
  alert: TriangleAlert,
  clock: Clock,
  check: Check,
  info: Info,
  home: House,
  cases: Folder,
  reviews: ClipboardCheck,
  imports: Upload,
  decrease: ArrowDown,
  increase: ArrowUp,
  equal: Minus,
  arrow: ArrowRight,
  back: ArrowLeft,
  close: X,
  calculator: Calculator,
  refresh: RefreshCw,
  logout: LogOut,
  unlink: Unlink,
  language: Languages,
  present: Eye,
  edit: Pencil,
  reset: RotateCcw,
  file: FileText,
  options: SlidersHorizontal,
  waiting: Hourglass,
  todo: Circle,
};
export function Icon({
  name,
  ...props
}: { name: string } & React.SVGProps<SVGSVGElement>) {
  const Component = icons[name];
  if (!Object.hasOwn(icons,name) || !Component) throw new Error(`Unknown icon: ${name}`);
  return (
    <Component
      aria-hidden="true"
      focusable="false"
      {...props}
      className={[
        name === "arrow" || name === "back" ? "directional-icon" : "",
        props.className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
export const iconOnly: Partial<Record<MessageKey, string>> = {
  signOut: "logout",
  refreshConnections: "refresh",
  copyLinkCode: "copy",
  lineRemove: "unlink",
  calendarDisconnect: "unlink",
  mcpCopy: "copy",
  mcpRevoke: "unlink",
  pricingEdit: "edit",
  copy: "copy",
  close: "close",
  resetFilters: "reset",
  handoff: "note",
};
export const labeled: Partial<Record<MessageKey, string>> = {
  pricingPresent: "present",
  scheduleFind: "search",
  scheduleBook: "calendar",
  calendarConnect: "calendar",
  lineConnect: "user",
  lineConfirm: "check",
  lineTest: "info",
  mcpIssue: "user",
  saveRecord: "note",
  saveComplete: "check",
  approve: "check",
  reject: "close",
  sample: "imports",
  sampleShown: "check",
  reviewOpen: "reviews",
};
