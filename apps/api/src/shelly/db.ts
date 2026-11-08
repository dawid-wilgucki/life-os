import type {
  ShellyActivitySignal,
  ShellyAlert,
  ShellyAlertRule,
  ShellyAlertSettings,
  ShellyPeriod,
  ShellyReading,
  ShellyRun,
  ShellySchedule,
} from '@life-os/shared-types';

/** Row shapes of the Shelly tables (snake_case, as stored). */

export interface PeriodRow {
  id: string;
  device_id: string;
  recurring: boolean;
  start_md: string | null;
  end_md: string | null;
  starts_on: string | null;
  ends_on: string | null;
  alert_on_activity: boolean;
  note: string | null;
}

export interface DeviceRow {
  id: string;
  name: string;
  icon: string;
  model_code: string | null;
  gen: number | null;
  channel: number;
  has_power_meter: boolean;
  activity_signal: ShellyActivitySignal;
  active_power_min_w: number;
  nominal_power_w: number | null;
  offline_after_hours: number;
  schedule: ShellySchedule | null;
  alerts: ShellyAlertSettings | null;
  latitude: number | null;
  longitude: number | null;
  enabled: boolean;
  sort_order: number;
  shelly_device_periods?: PeriodRow[];
}

export interface StateRow {
  device_id: string;
  online: boolean;
  output: boolean | null;
  last_reading: ShellyReading | null;
  last_updated_raw: string | null;
  last_report_at: string | null;
  last_seen_online_at: string | null;
  offline_since: string | null;
  last_energy_wh: number | null;
  active_since: string | null;
  active_since_exact: boolean;
  active_energy_start_wh: number | null;
  last_active_at: string | null;
  last_run: ShellyRun | null;
  voltage_bad_streak: number;
  fw_version: string | null;
  fw_update: string | null;
  backfill_month: string | null;
  backfill_empty_months: number;
  backfill_errors: number;
  backfill_done: boolean;
}

export interface SettingsRow {
  id: number;
  quiet_from: string;
  quiet_to: string;
  latitude: number;
  longitude: number;
  api_failure_threshold: number;
  consecutive_failures: number;
  last_error: string | null;
  last_error_kind: string | null;
  last_success_at: string | null;
  last_attempt_at: string | null;
}

export interface AlertRow {
  id: string;
  device_id: string | null;
  rule: ShellyAlertRule;
  severity: 'critical' | 'warning';
  message: string;
  resolve_message: string | null;
  details: Record<string, unknown> | null;
  opened_at: string;
  resolved_at: string | null;
  resolution: 'normal' | 'break' | 'disabled' | null;
  ok_streak: number;
  notified_open_at: string | null;
  notified_resolved_at: string | null;
}

export const DEFAULT_SETTINGS: SettingsRow = {
  id: 1,
  quiet_from: '22:00:00',
  quiet_to: '07:00:00',
  latitude: 49.701879,
  longitude: 22.414214,
  api_failure_threshold: 4,
  consecutive_failures: 0,
  last_error: null,
  last_error_kind: null,
  last_success_at: null,
  last_attempt_at: null,
};

export function toPeriod(row: PeriodRow): ShellyPeriod {
  return {
    id: row.id,
    deviceId: row.device_id,
    recurring: row.recurring,
    startMd: row.start_md ?? undefined,
    endMd: row.end_md ?? undefined,
    startsOn: row.starts_on ?? undefined,
    endsOn: row.ends_on ?? undefined,
    alertOnActivity: row.alert_on_activity,
    note: row.note ?? undefined,
  };
}

export function toAlert(row: AlertRow, deviceName?: string): ShellyAlert {
  return {
    id: row.id,
    deviceId: row.device_id ?? undefined,
    deviceName,
    rule: row.rule,
    severity: row.severity,
    message: row.message,
    resolveMessage: row.resolve_message ?? undefined,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at ?? undefined,
    resolution: row.resolution ?? undefined,
    notifiedOpenAt: row.notified_open_at ?? undefined,
  };
}

/** Effective alert thresholds: per-device overrides on top of defaults. */
export function alertSettings(device: DeviceRow): Required<
  Pick<ShellyAlertSettings, 'voltage' | 'voltage_min' | 'voltage_max' | 'device_errors' | 'min_run_wh'>
> & { max_run_min: number | null } {
  const a = device.alerts ?? {};
  const sched = device.schedule;
  const fallbackMax = sched?.type === 'runs' ? Math.max(sched.duration_min * 2, sched.duration_min + 10) : null;
  return {
    voltage: a.voltage ?? true,
    voltage_min: a.voltage_min ?? 207,
    voltage_max: a.voltage_max ?? 253,
    device_errors: a.device_errors ?? true,
    min_run_wh: a.min_run_wh ?? 10,
    max_run_min: a.max_run_min ?? fallbackMax,
  };
}
