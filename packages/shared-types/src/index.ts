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
  /** Defaults to 'primary'. Pass the Google Calendar ID to write to a shared calendar. */
  calendarId?: string;
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
  /** Live SPOT, PLN per gram of .999 gold (NBP cenyzlota). */
  spot: number;
  currency: string;
  /** NBP quote date for this SPOT, e.g. "2026-06-10". */
  asOf?: string;
  alerts: GoldAlert[];
}

/**
 * Premium calculator result (POST /api/investments/gold/check).
 * Mirrors the gold-tracker worker's `isOpportunity` thresholds.
 */
export interface GoldCheckResult {
  /** Offer price in PLN. */
  price: number;
  /** Pure gold content in grams. */
  weightGrams: number;
  /** SPOT PLN/g used for the calculation. */
  spotPerGram: number;
  /** Fair gold value = weightGrams × spotPerGram. */
  spotValue: number;
  /** Premium over SPOT, percent. */
  overSpotPct: number;
  /** Max premium % for the price tier, or null when out of the tracker's range. */
  threshold: number | null;
  /** True when overSpotPct is within the tier threshold. */
  isOpportunity: boolean;
  /** Human label for the matched price tier. */
  tier: string;
}

/** A single NumiTracker gold offer (PL), as surfaced by Life.OS. */
export interface GoldOffer {
  id: number;
  title: string;
  slug: string;
  /** Sale price in PLN. */
  price: number;
  /** Premium over SPOT, percent (as computed by NumiTracker). */
  overSpot: number;
  /** Pure gold content in grams, or null when NumiTracker doesn't expose it. */
  weightGrams: number | null;
  dealer: string | null;
  dealerUrl: string | null;
  numitrackerUrl: string;
}

/**
 * Result of an offer check (POST /api/investments/gold/offers).
 * Offers are capped at `maxPrice` and sorted by premium ascending.
 */
export interface GoldOffersResult {
  maxPrice: number;
  spotPerGram: number | null;
  asOf?: string;
  count: number;
  offers: GoldOffer[];
}

/**
 * Latest daily opportunity snapshot (GET /api/investments/gold/opportunities).
 * Populated once a day by the cron; offers already pass the tier thresholds.
 */
export interface GoldOpportunities {
  /** ISO date of the last daily check, or null if it hasn't run yet. */
  date: string | null;
  spotPerGram: number | null;
  count: number;
  offers: GoldOffer[];
}

export interface GemRankingEntry {
  ticker: string;
  score: number;
}

export interface GemStatus {
  ranking: GemRankingEntry[];
  currentHolding: string | null;
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

export type WardrobeSeason = 'wiosna' | 'lato' | 'jesien' | 'zima' | 'caloroczny';
export type WardrobeCondition = 'nowe' | 'uzywane' | 'vintage';

export interface WardrobeItem {
  id: string;
  nazwa: string;
  section: WardrobeSection;
  /** Drive file name of the photo; resolved to an id by the photo proxy. */
  nazwaPlikuDrive?: string;
  /** Convenience URL the frontend can use directly: /api/wardrobe/photo/:fileId. */
  photoUrl?: string;
  kolor?: string;
  rozmiar?: string;
  marka?: string;
  material?: string;
  sezon?: WardrobeSeason;
  stan?: WardrobeCondition;
  notatki?: string;
  [extra: string]: unknown;
}

/** Payload accepted by POST /api/wardrobe/item (id is generated server-side). */
export interface CreateWardrobeItemInput {
  section: WardrobeSection;
  nazwa: string;
  nazwaPlikuDrive?: string;
  kolor?: string;
  rozmiar?: string;
  marka?: string;
  material?: string;
  sezon?: WardrobeSeason;
  stan?: WardrobeCondition;
  notatki?: string;
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

// ============================================================================
// Subscriptions
// ============================================================================

export type BillingCycle = 'monthly' | 'yearly' | 'weekly';

export interface Subscription {
  id: string;
  name: string;
  costPln: number;
  billingCycle: BillingCycle;
  renewalDate?: IsoDate;
  color?: string;
  icon?: string;
  createdAt: IsoDateTime;
}

export interface CreateSubscriptionInput {
  name: string;
  costPln: number;
  billingCycle: BillingCycle;
  renewalDate?: IsoDate;
  color?: string;
  icon?: string;
}

// ============================================================================
// Lists (Google Keep-style pinned lists)
// ============================================================================

export interface List {
  id: string;
  title: string;
  pinned: boolean;
  type: 'list' | 'note';
  content?: string;
  orderIndex: number;
  /** Locked lists cannot be deleted (only their items can change). */
  locked: boolean;
  /** 'google_tasks' lists mirror the user's default Google Tasks list. */
  source: 'local' | 'google_tasks';
  createdAt: IsoDateTime;
}

export interface ListItem {
  id: string;
  listId: string;
  text: string;
  checked: boolean;
  sortOrder: number;
  createdAt: IsoDateTime;
}

export interface ListWithItems extends List {
  items: ListItem[];
}

export interface CreateListItemInput {
  text: string;
}

// ============================================================================
// Meal Plan (Gemini-generated 7-day plan)
// ============================================================================

export interface MealDay {
  day_id: number;
  day_name: string;
  meal_name: string;
  prep_time_min: number;
  is_batch_leftover: boolean;
  tags: string[];
  recipe_steps: string[];
}

export interface MealPlan {
  meal_plan: MealDay[];
  generatedAt: IsoDateTime;
}

// ============================================================================
// Wardrobe Suggestion (Gemini-powered, KV-cached)
// ============================================================================

export interface WardrobeSuggestion {
  item: string;
  reason: string;
  category: WardrobeSection;
  cached: boolean;
}

// ============================================================================
// Shopping list generation result
// ============================================================================

export interface ShoppingListResult {
  added: number;
  skipped: number;
}

// ============================================================================
// Outfit Suggestion (Gemini-powered, KV-cached daily)
// ============================================================================

export interface OutfitSuggestion {
  top: string;
  bottom: string;
  shoes: string;
  note: string;
  temp_range: string;
  cached?: boolean;
}

// ============================================================================
// Day Plan (Gemini-powered, KV-cached hourly)
// ============================================================================

export interface DayPlanAlert {
  /** 'warning' for things that look missing or need checking. */
  type: string;
  message: string;
}

export interface DayPlanItem {
  order: number;
  type: 'task' | 'habit' | 'alert';
  title: string;
  duration_min: number;
  reason: string;
  source: 'google_tasks' | 'habit_tracker' | 'ai_generated' | string;
}

export interface DayPlan {
  /** HH:MM the plan was generated. */
  generated_at: string;
  summary: string;
  alerts: DayPlanAlert[];
  plan: DayPlanItem[];
  cached?: boolean;
}

// ============================================================================
// Solar (Solarman PV inverter)
// ============================================================================

export type SolarStatus = 'online' | 'offline' | 'alarm' | 'unknown';

export interface SolarCurrentData {
  /** Instantaneous AC output power, in watts (APo_t1). */
  powerNow: number;
  /** Energy generated today, in kWh (Etdy_ge1). */
  energyToday: number;
  /** Lifetime energy generated, in kWh (Et_ge0). */
  energyTotal: number;
  status: SolarStatus;
  /** Radiator temperature, in °C (T_RDT1). */
  temperature: number;
  /** PV1 DC voltage, in volts (DV1). */
  pvVoltage: number;
  /** PV1 DC current, in amperes (DC1). */
  pvCurrent: number;
  /** PV1 DC power, in watts (DP1). */
  pvPower: number;
  /** Solarman collectionTime, unix seconds. */
  collectionTime: number;
  updatedAt: IsoDateTime;
}

/** Result of forcing a Solarman token refresh (token stays server-side in KV). */
export interface SolarTokenRefreshResult {
  success: boolean;
  expiresIn: number;
}
