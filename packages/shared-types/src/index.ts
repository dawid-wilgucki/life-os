// @life-os/shared-types
// Shared domain interfaces used by both the Angular frontend and the Worker API.
// Keep these framework-agnostic (no Angular / Hono / Supabase imports).

// ============================================================================
// Common
// ============================================================================

/** Uniform error body returned by the API on non-2xx responses. */
export interface ApiError {
  error: string;
  detail?: string;
}

/** ISO-8601 timestamp string, e.g. "2026-06-14T09:30:00Z". */
export type IsoDateTime = string;
/** Calendar date string, e.g. "2026-06-14". */
export type IsoDate = string;

// ============================================================================
// Auth
// ============================================================================

export interface AuthStatus {
  authenticated: boolean;
  email?: string;
  /** Google scopes currently granted. */
  scopes?: string[];
}

/** Returned by the OAuth callback (also delivered to the SPA via URL fragment). */
export interface SessionResponse {
  token: string;
  email: string;
}

// ============================================================================
// Tasks (Google Tasks + local UI metadata)
// ============================================================================

export type TaskStatus = 'needsAction' | 'completed';

export interface Task {
  id: string;
  title: string;
  notes?: string;
  status: TaskStatus;
  /** RFC3339, date-only granularity in Google Tasks. */
  due?: IsoDateTime;
  completed?: IsoDateTime;
  position?: string;
  parent?: string;
  updated?: IsoDateTime;
}

export interface TaskList {
  id: string;
  title: string;
  updated?: IsoDateTime;
}

/** Extra UI data we keep in Supabase, keyed by the Google task-list id. */
export interface TaskListMeta {
  googleListId: string;
  color: string | null;
  pinned: boolean;
  sortOrder: number | null;
}

/** A task list joined with its local UI metadata (frontend convenience shape). */
export interface TaskListWithMeta extends TaskList {
  meta?: TaskListMeta;
}

export interface CreateTaskInput {
  title: string;
  notes?: string;
  due?: IsoDateTime;
}

export interface UpdateTaskInput {
  title?: string;
  notes?: string;
  status?: TaskStatus;
  due?: IsoDateTime | null;
}

// ============================================================================
// Calendar (Google Calendar)
// ============================================================================

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  /** ISO datetime for timed events, or date string for all-day events. */
  start: IsoDateTime | IsoDate;
  end: IsoDateTime | IsoDate;
  allDay: boolean;
  htmlLink?: string;
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: IsoDateTime | IsoDate;
  end: IsoDateTime | IsoDate;
  allDay?: boolean;
}

export type UpdateEventInput = Partial<CreateEventInput>;

// ============================================================================
// Inbox (GTD capture)
// ============================================================================

export type InboxSource = 'web' | 'telegram';
export type InboxStatus = 'new' | 'archived' | 'converted';

export interface InboxItem {
  id: string;
  text: string;
  source: InboxSource;
  status: InboxStatus;
  capturedAt: IsoDateTime;
}

export interface CreateInboxInput {
  text: string;
  source?: InboxSource;
}

/** Triage action applied to an inbox item. */
export type InboxTriage =
  | { action: 'archive' }
  | { action: 'convert_task'; listId: string; due?: IsoDateTime }
  | { action: 'convert_event'; start: IsoDateTime; end: IsoDateTime };

// ============================================================================
// Investments (read-only, proxied from external Workers)
// ============================================================================

export interface GoldAlert {
  message: string;
  at: IsoDateTime;
}

export interface GoldStatus {
  spot: number;
  currency: string;
  alerts: GoldAlert[];
  /** True when the data is mocked because the upstream worker was unavailable. */
  mock?: boolean;
}

export interface GemRankingEntry {
  ticker: string;
  score: number;
}

export interface GemStatus {
  ranking: GemRankingEntry[];
  currentHolding: string | null;
  mock?: boolean;
}

// ============================================================================
// Wardrobe (read-only from Google Drive JSON)
// ============================================================================

export type WardrobeSection =
  | 'gora'
  | 'dol'
  | 'buty'
  | 'bielizna_i_dodatki'
  | 'silownia';

export interface WardrobeItem {
  id: string;
  nazwa: string;
  section: WardrobeSection;
  /** Drive file name of the photo; resolved to an id by the photo proxy. */
  nazwaPlikuDrive?: string;
  /** Convenience URL the frontend can use directly: /api/wardrobe/photo/:fileId. */
  photoUrl?: string;
  [extra: string]: unknown;
}

export type Wardrobe = Record<WardrobeSection, WardrobeItem[]>;

// ============================================================================
// Trips
// ============================================================================

export type TripSource = 'manual' | 'gmail';

export interface Trip {
  id: string;
  fromLoc: string;
  toLoc: string;
  departureAt: IsoDateTime;
  arrivalAt?: IsoDateTime;
  carrier?: string;
  trainNumber?: string;
  seat?: string;
  source: TripSource;
  rawEmailId?: string;
  createdAt: IsoDateTime;
}

export interface CreateTripInput {
  fromLoc: string;
  toLoc: string;
  departureAt: IsoDateTime;
  arrivalAt?: IsoDateTime;
  carrier?: string;
  trainNumber?: string;
  seat?: string;
}

// ============================================================================
// Home maintenance
// ============================================================================

export type MaintenanceCategory = 'ogrod' | 'dom' | 'auto';

export interface MaintenanceItem {
  id: string;
  name: string;
  category: MaintenanceCategory;
  nextDue: IsoDate;
  intervalDays: number;
  googleEventId?: string;
  reminderSent: boolean;
  createdAt: IsoDateTime;
}

export interface CreateMaintenanceInput {
  name: string;
  category: MaintenanceCategory;
  nextDue: IsoDate;
  intervalDays: number;
  mirrorToCalendar?: boolean;
}

// ============================================================================
// Habits
// ============================================================================

export interface Habit {
  id: string;
  name: string;
  icon: string;
  active: boolean;
  createdAt: IsoDateTime;
}

export interface HabitCheck {
  id: string;
  habitId: string;
  date: IsoDate;
}

/** Frontend shape: a habit enriched with streak info + today's state. */
export interface HabitWithStreak extends Habit {
  checkedToday: boolean;
  currentStreak: number;
  longestStreak: number;
  /** Monday..Sunday of the current week; true if checked that day. */
  weeklyChecks: boolean[];
}

export interface CreateHabitInput {
  name: string;
  icon: string;
}
