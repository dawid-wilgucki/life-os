import type { ShellyDevice, ShellyDeviceState, ShellyHealth } from '@life-os/shared-types';
import { toPeriod, type DeviceRow, type SettingsRow, type StateRow } from './db';
import { isActive } from './normalize';
import { breakEnd, breakOn, describeSchedule, localParts, nextRun, sunTimes } from './time';
import { deviceLocation } from './poll';

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export function toDeviceState(device: DeviceRow, s: StateRow | undefined): ShellyDeviceState | null {
  if (!s) return null;
  return {
    online: s.online,
    output: s.output,
    active: s.online && isActive(device, s.last_reading),
    reading: s.last_reading,
    lastReportAt: opt(s.last_report_at),
    lastSeenOnlineAt: opt(s.last_seen_online_at),
    offlineSince: opt(s.offline_since),
    activeSince: opt(s.active_since),
    lastActiveAt: opt(s.last_active_at),
    lastRun: opt(s.last_run),
    fwVersion: opt(s.fw_version),
    fwUpdate: opt(s.fw_update),
  };
}

export function toDeviceView(device: DeviceRow, state: StateRow | undefined, settings: SettingsRow, now: Date): ShellyDevice {
  const periods = device.shelly_device_periods ?? [];
  const today = localParts(now).date;
  const br = breakOn(periods, today);
  const { lat, lon } = deviceLocation(device, settings);

  let scheduleInfo: ShellyDevice['scheduleInfo'];
  if (device.schedule) {
    const sun = sunTimes(today, lat, lon);
    const next = device.schedule.type === 'runs' ? nextRun(device.schedule, now, lat, lon, periods) : null;
    scheduleInfo = {
      description: describeSchedule(device.schedule),
      nextRunAt: next?.toISOString(),
      sunrise: sun.sunrise?.toISOString(),
      sunset: sun.sunset?.toISOString(),
    };
  }

  return {
    id: device.id,
    name: device.name,
    icon: device.icon,
    modelCode: opt(device.model_code),
    gen: opt(device.gen),
    channel: device.channel,
    hasPowerMeter: device.has_power_meter,
    activitySignal: device.activity_signal,
    activePowerMinW: device.active_power_min_w,
    nominalPowerW: opt(device.nominal_power_w),
    offlineAfterHours: device.offline_after_hours,
    schedule: opt(device.schedule),
    alerts: device.alerts ?? {},
    enabled: device.enabled,
    sortOrder: device.sort_order,
    periods: [...periods]
      .sort((a, b) => Number(b.recurring) - Number(a.recurring) || (a.start_md ?? a.starts_on ?? '').localeCompare(b.start_md ?? b.starts_on ?? ''))
      .map(toPeriod),
    state: toDeviceState(device, state),
    activeBreak: br ? toPeriod(br) : null,
    breakUntil: br ? opt(breakEnd(periods, today)) : undefined,
    scheduleInfo,
  };
}

export function toHealth(settings: SettingsRow, configured: boolean): ShellyHealth {
  return {
    configured,
    lastSuccessAt: opt(settings.last_success_at),
    lastAttemptAt: opt(settings.last_attempt_at),
    consecutiveFailures: settings.consecutive_failures,
    lastError: opt(settings.last_error),
    quietFrom: settings.quiet_from.slice(0, 5),
    quietTo: settings.quiet_to.slice(0, 5),
  };
}
