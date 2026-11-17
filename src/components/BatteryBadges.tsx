import React, { useRef } from 'react';

export type DeviceBattery =
  | { state: 'absent' }
  | { state: 'busy' }
  | { state: 'ok'; level: number; charging: boolean };

export interface BatteryStatus {
  headset: DeviceBattery;
  mouse: DeviceBattery;
}

type LastReading = { level: number; charging: boolean; at: Date };

const LOW = 15;
const STORAGE_KEY = "device-battery-last";

// Keep the last reading across restarts, so opening the app while ATK HUB runs still shows something.
const loadLast = (): { headset?: LastReading; mouse?: LastReading } => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    for (const k of Object.keys(raw)) raw[k].at = new Date(raw[k].at);
    return raw;
  } catch {
    return {};
  }
};

/** 0% → đỏ, 50% → vàng, 100% → xanh lá (hue 0 → 120). */
const levelColor = (level: number) =>
  `hsl(${Math.round(Math.max(0, Math.min(100, level)) * 1.2)}, 45%, 62%)`;

const formatClock = (d: Date) =>
  `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;

const Badge: React.FC<{ icon: string; label: string; device: DeviceBattery; last?: LastReading }> = ({
  icon,
  label,
  device,
  last,
}) => {
  if (device.state === 'absent') return null;

  if (device.state === 'busy') {
    // Another app (ATK HUB) holds the device: show the last known value, dimmed.
    return (
      <span
        className="battery-badge busy"
        title={
          last
            ? `${label}: ${last.level}% (cập nhật lúc ${formatClock(last.at)}). ATK HUB đang mở nên chưa đọc lại được`
            : `${label}: ATK HUB đang mở, tắt ATK HUB để xem pin`
        }
      >
        <i className={icon} style={last ? { color: levelColor(last.level) } : undefined} />
        {last ? `~${last.level}%` : '—'}
      </span>
    );
  }

  const className = `battery-badge${device.level <= LOW && !device.charging ? ' low' : ''}`;
  return (
    <span
      className={className}
      style={{ color: levelColor(device.level) }}
      title={`${label}: ${device.level}%${device.charging ? ' (đang sạc)' : ''}`}
    >
      <i className={icon} />
      {device.charging && <i className="fa-solid fa-bolt battery-bolt" />}
      {device.level}%
    </span>
  );
};

export const BatteryBadges: React.FC<{ status: BatteryStatus; placement: "top" | "progress" }> = ({ status, placement }) => {
  const lastRef = useRef<{ headset?: LastReading; mouse?: LastReading }>(loadLast());
  for (const key of ['headset', 'mouse'] as const) {
    const d = status[key];
    if (d.state === 'ok') {
      const prev = lastRef.current[key];
      if (!prev || prev.level !== d.level || prev.charging !== d.charging) {
        lastRef.current[key] = { level: d.level, charging: d.charging, at: new Date() };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lastRef.current)); } catch { /* ignore */ }
      }
    }
  }

  if (status.headset.state === 'absent' && status.mouse.state === 'absent') return null;
  return (
    <div className={`battery-badges battery-badges-${placement}`}>
      <Badge icon="fa-solid fa-headphones" label="Tai nghe" device={status.headset} last={lastRef.current.headset} />
      <Badge icon="fa-solid fa-computer-mouse" label="Chuột" device={status.mouse} last={lastRef.current.mouse} />
    </div>
  );
};
