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

export interface GoldStatus {
  /** PLN per gram (NBP cena). */
  pricePerGram: number;
  /** PLN per troy ounce (pricePerGram × 31.1035). */
  pricePerOz: number;
  /** Date of the NBP quotation, e.g. "2026-06-28". */
  date: IsoDate;
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

// --- Gold on-demand check (port of gold-tracker /check) ---
export interface GoldOffer {
  title: string;
  price: number;
  grams: number | null;
  /** % premii wg NumiTracker (over_spot). */
  overSpot: number;
  /** (price/grams/spot - 1)*100; null gdy brak wagi lub spotu. */
  premiumVsNbpPct: number | null;
  dealer: string | null;
  numiUrl: string;
  dealerUrl: string | null;
}

export interface GoldCheckResult {
  maxPrice: number;
  maxPremium: number | null;
  spotPlnPerGram: number | null;
  count: number;
  /** Pełna lista, posortowana rosnąco po overSpot. */
  offers: GoldOffer[];
}

export interface GoldAnalysisResult {
  analysis: string;
}

// --- GEM on-demand analysis (port of runGemStrategy) ---
export interface GemMomentumEntry {
  name: string;
  /** % momentum (12m-1m). */
  momentum: number;
}

export interface GemRunResult {
  /** Posortowane malejąco po momentum. */
  ranking: GemMomentumEntry[];
  leader: string | null;
  currentHolding: string | null;
  /** leader !== currentHolding. */
  rotate: boolean;
  errorCount: number;
  ts: IsoDateTime;
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
// Life Profile
// ============================================================================

export interface LifeProfile {
  sections: Record<string, string>;
  updated_at: string | null;
}

// ============================================================================
// Chat (AI assistant with live context + actions)
// ============================================================================

export type ChatRole = 'user' | 'model';

export interface ChatMessage {
  role: ChatRole;
  text: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
}

export interface ChatResponse {
  reply: string;
  actions_taken: string[];
}

// ============================================================================
// Job Search
// ============================================================================

export type JobSource = 'justjoin' | 'nofluffjobs' | 'remotive';

export interface JobOffer {
  id: string;
  title: string;
  company: string;
  salary_from: number | null;
  salary_to: number | null;
  currency: string | null;
  url: string;
  source: JobSource;
  location: string | null;
  remote: boolean;
  created_at: string;
  dismissed: boolean;
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

// ============================================================================
// Shelly (urządzenia smart home przez Shelly Cloud)
// ============================================================================

/** Co oznacza „pracuje”: stan wyjścia albo pobór mocy (np. bojler w gniazdku). */
export type ShellyActivitySignal = 'output' | 'power';

/** Harmonogram oczekiwanej pracy (ISO dni tygodnia: 1 = pn … 7 = nd). */
export type ShellySchedule =
  | {
      type: 'runs';
      days: number[];
      /** Punkt odniesienia startu: wschód / zachód słońca albo stała godzina `time` (HH:MM). */
      at: 'sunrise' | 'sunset' | 'time';
      time?: string;
      offset_min?: number;
      duration_min: number;
      tolerance_min?: number;
    }
  | { type: 'night'; tolerance_min?: number };

/** Nadpisania progów alertów (shelly_devices.alerts). */
export interface ShellyAlertSettings {
  voltage?: boolean;
  voltage_min?: number;
  voltage_max?: number;
  device_errors?: boolean;
  max_run_min?: number;
  min_run_wh?: number;
}

/** Znormalizowany odczyt jednego urządzenia (Gen1 / Gen2+). */
export interface ShellyReading {
  output: boolean | null;
  apowerW: number | null;
  voltageV: number | null;
  currentA: number | null;
  freqHz: number | null;
  /** Narastający licznik energii, Wh. */
  energyTotalWh: number | null;
  /** Temperatura modułu Shelly (nie urządzenia odbiorczego). */
  tempC: number | null;
  rssi: number | null;
  uptimeS: number | null;
  /** Błędy zgłaszane przez urządzenie (overpower, overtemp, …). */
  errors: string[];
  /** Co ostatnio przełączyło wyjście (init, loopback = harmonogram, button, cloud, …). */
  source: string | null;
  timerStartedAt: number | null;
  timerDurationS: number | null;
}

export interface ShellyPeriod {
  id: string;
  deviceId: string;
  /** true: powtarza się co roku (startMd/endMd), false: jednorazowo (startsOn/endsOn). */
  recurring: boolean;
  startMd?: string;
  endMd?: string;
  startsOn?: IsoDate;
  endsOn?: IsoDate;
  alertOnActivity: boolean;
  note?: string;
}

export interface ShellyRun {
  start: IsoDateTime;
  end: IsoDateTime;
  energyWh: number | null;
  avgW: number | null;
  /** true gdy początek znany dokładnie (webhook / timer urządzenia). */
  exact: boolean;
}

export interface ShellyDeviceState {
  online: boolean;
  output: boolean | null;
  active: boolean;
  reading: ShellyReading | null;
  lastReportAt?: IsoDateTime;
  lastSeenOnlineAt?: IsoDateTime;
  offlineSince?: IsoDateTime;
  activeSince?: IsoDateTime;
  lastActiveAt?: IsoDateTime;
  lastRun?: ShellyRun;
  fwVersion?: string;
  fwUpdate?: string;
}

export interface ShellyScheduleInfo {
  description: string;
  nextRunAt?: IsoDateTime;
  sunrise?: IsoDateTime;
  sunset?: IsoDateTime;
}

export interface ShellyDevice {
  id: string;
  name: string;
  icon: string;
  modelCode?: string;
  gen?: number;
  channel: number;
  hasPowerMeter: boolean;
  activitySignal: ShellyActivitySignal;
  activePowerMinW: number;
  nominalPowerW?: number;
  offlineAfterHours: number;
  schedule?: ShellySchedule;
  alerts: ShellyAlertSettings;
  enabled: boolean;
  sortOrder: number;
  periods: ShellyPeriod[];
  state: ShellyDeviceState | null;
  /** Trwający okres przerwy (alerty wyłączone). */
  activeBreak: ShellyPeriod | null;
  /** Ostatni dzień trwającej przerwy. */
  breakUntil?: IsoDate;
  scheduleInfo?: ShellyScheduleInfo;
}

export type ShellyAlertRule =
  | 'api'
  | 'offline'
  | 'device_error'
  | 'voltage'
  | 'break_activity'
  | 'schedule'
  | 'missed_run'
  | 'run_too_long';

export interface ShellyAlert {
  id: string;
  deviceId?: string;
  deviceName?: string;
  rule: ShellyAlertRule;
  severity: 'critical' | 'warning';
  message: string;
  resolveMessage?: string;
  openedAt: IsoDateTime;
  resolvedAt?: IsoDateTime;
  resolution?: 'normal' | 'break' | 'disabled';
  notifiedOpenAt?: IsoDateTime;
}

export interface ShellyHealth {
  configured: boolean;
  lastSuccessAt?: IsoDateTime;
  lastAttemptAt?: IsoDateTime;
  consecutiveFailures: number;
  lastError?: string;
  quietFrom: string;
  quietTo: string;
}

export interface ShellyOverview {
  devices: ShellyDevice[];
  openAlerts: ShellyAlert[];
  recentAlerts: ShellyAlert[];
  health: ShellyHealth;
}

export type ShellyRange = '24h' | '30d' | '12m';

export interface ShellySeriesPoint {
  start: IsoDateTime;
  /** Zużycie w kubełku (Wh); null = brak danych. */
  wh: number | null;
  source: 'own' | 'cloud' | 'mixed' | 'estimate' | null;
  /** Czas pracy w kubełku (h); null = brak danych. */
  activeHours: number | null;
  inBreak: boolean;
}

export interface ShellySeries {
  deviceId: string;
  range: ShellyRange;
  bucket: 'hour' | 'day' | 'month';
  points: ShellySeriesPoint[];
  totalWh: number | null;
  totalActiveHours: number | null;
  /** true gdy wh to szacunek (moc nominalna × czas pracy). */
  estimated: boolean;
}

export interface CreateShellyDeviceInput {
  id: string;
  name: string;
  icon?: string;
  hasPowerMeter?: boolean;
  activitySignal?: ShellyActivitySignal;
  nominalPowerW?: number | null;
}

export interface UpdateShellyDeviceInput {
  name?: string;
  icon?: string;
  hasPowerMeter?: boolean;
  activitySignal?: ShellyActivitySignal;
  activePowerMinW?: number;
  nominalPowerW?: number | null;
  offlineAfterHours?: number;
  enabled?: boolean;
}

export interface CreateShellyPeriodInput {
  recurring: boolean;
  startMd?: string;
  endMd?: string;
  startsOn?: IsoDate;
  endsOn?: IsoDate;
  alertOnActivity?: boolean;
  note?: string;
}
