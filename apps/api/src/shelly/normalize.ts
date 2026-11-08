import type { ShellyReading } from '@life-os/shared-types';
import type { ShellyCloudDevice } from '../lib/shelly';
import type { DeviceRow } from './db';

/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Map a raw cloud status to one shape, whatever the generation:
 *  - Gen2/Gen3/Gen4 (RPC): `switch:<ch>` with output/apower/voltage/current/freq,
 *    aenergy.total in Wh, temperature.tC, errors[]
 *  - Gen1: relays[ch].ison, meters[ch].power, meters[ch].total in watt-minutes
 */
export function normalizeReading(status: Record<string, any>, channel: number): ShellyReading {
  const sw = status?.[`switch:${channel}`];
  const wifi = status?.wifi ?? status?.wifi_sta;
  const sys = status?.sys;
  const rssi = num(wifi?.rssi);
  const uptime = num(sys?.uptime) ?? num(status?.uptime);

  if (sw && typeof sw === 'object') {
    const errors: string[] = Array.isArray(sw.errors) ? sw.errors.filter((e: unknown) => typeof e === 'string') : [];
    return {
      output: typeof sw.output === 'boolean' ? sw.output : null,
      apowerW: num(sw.apower),
      voltageV: num(sw.voltage),
      currentA: num(sw.current),
      freqHz: num(sw.freq),
      energyTotalWh: num(sw.aenergy?.total),
      tempC: num(sw.temperature?.tC),
      rssi,
      uptimeS: uptime,
      errors,
      source: typeof sw.source === 'string' ? sw.source : null,
      timerStartedAt: num(sw.timer_started_at),
      timerDurationS: num(sw.timer_duration),
    };
  }

  // Gen1
  const relay = Array.isArray(status?.relays) ? status.relays[channel] : undefined;
  const meter = Array.isArray(status?.meters) ? status.meters[channel] : undefined;
  const errors: string[] = [];
  if (relay?.overpower === true || meter?.overpower === true) errors.push('overpower');
  if (status?.overtemperature === true) errors.push('overtemp');
  const totalWmin = num(meter?.total);
  return {
    output: typeof relay?.ison === 'boolean' ? relay.ison : null,
    apowerW: num(meter?.power),
    voltageV: num(meter?.voltage) ?? num(status?.voltage),
    currentA: null,
    freqHz: null,
    energyTotalWh: totalWmin === null ? null : totalWmin / 60,
    tempC: num(status?.tmp?.tC) ?? num(status?.temperature),
    rssi,
    uptimeS: uptime,
    errors,
    source: typeof relay?.source === 'string' ? relay.source : null,
    timerStartedAt: relay?.has_timer ? num(relay?.timer_started) : null,
    timerDurationS: relay?.has_timer ? num(relay?.timer_duration) : null,
  };
}

export interface DeviceMeta {
  modelCode?: string;
  gen?: number;
  hasPowerMeter?: boolean;
  latitude?: number;
  longitude?: number;
  fwVersion?: string;
  fwUpdate?: string;
}

/** Device identity / capability / location info from a cloud record. */
export function extractMeta(rec: ShellyCloudDevice, channel: number): DeviceMeta {
  const status = rec.status ?? {};
  const settings = rec.settings ?? {};
  const code = typeof rec.code === 'string' ? rec.code : typeof status.code === 'string' ? status.code : undefined;

  let gen: number | undefined = num(settings?.DeviceInfo?.gen) ?? undefined;
  if (!gen && code) {
    const m = /^S(\d)[A-Z]/.exec(code);
    if (m && Number(m[1]) >= 3) gen = Number(m[1]);
  }
  if (!gen && rec.gen === 'G1') gen = 1;
  if (!gen && rec.gen === 'G2') gen = 2;

  const sw = status[`switch:${channel}`];
  const meter = Array.isArray(status.meters) ? status.meters[channel] : undefined;
  const hasPowerMeter =
    sw && typeof sw === 'object' ? num(sw.apower) !== null : meter ? num(meter.power) !== null : undefined;

  const loc = settings?.sys?.location;
  const lat = num(loc?.lat);
  const lon = num(loc?.lon);

  const fwVersion =
    (typeof settings?.DeviceInfo?.ver === 'string' && settings.DeviceInfo.ver) ||
    (typeof status?.update?.old_version === 'string' && status.update.old_version) ||
    undefined;
  const stable = status?.sys?.available_updates?.stable?.version;
  const fwUpdate =
    (typeof stable === 'string' && stable) ||
    (status?.update?.has_update && typeof status.update.new_version === 'string' ? status.update.new_version : undefined);

  return {
    modelCode: code,
    gen,
    hasPowerMeter,
    latitude: lat ?? undefined,
    longitude: lon ?? undefined,
    fwVersion,
    fwUpdate: fwUpdate || undefined,
  };
}

export function isOnline(rec: ShellyCloudDevice | undefined): boolean {
  if (!rec) return false;
  if (rec.online === 1 || rec.online === true) return true;
  if (rec.online === 0 || rec.online === false) return false;
  return rec.status?.cloud?.connected === true;
}

/** `_updated` is "YYYY-MM-DD HH:MM:SS" in UTC (verified against HTTP Date). */
export function parseCloudUpdated(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return null;
  const t = Date.parse(`${raw.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? new Date(t) : null;
}

/** Is the device doing its job right now (per its activity signal)? */
export function isActive(device: DeviceRow, reading: ShellyReading | null): boolean {
  if (!reading) return false;
  if (device.activity_signal === 'power') {
    return reading.apowerW !== null && reading.apowerW >= device.active_power_min_w;
  }
  return reading.output === true;
}
