//! Background battery polling for the user's wireless peripherals.
//!
//! - ATK N9 Ultra headset dongle (VID 373B, PID 1204): serial port, 9600 8N1.
//!   Request `02 00 03` (64-byte frame) → reply byte[4]: bits 0-6 = %, bit 7 = charging.
//!   ATK HUB holds the port exclusively while it runs; we then report `busy`.
//! - Attack Shark X11 mouse dongle (VID 1D57, PID FA60): HID interface 2, collection 3
//!   pushes input report `03 55 40 01 XX` every ~2 s, XX = battery %.

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

static LATEST: Mutex<Option<BatteryStatus>> = Mutex::new(None);

/// Last known status, so the UI can render immediately after (re)loading.
#[tauri::command]
pub fn get_device_battery() -> Option<BatteryStatus> {
    LATEST.lock().ok().and_then(|g| g.clone())
}

const POLL_INTERVAL: Duration = Duration::from_secs(60);

const HEADSET_VID: u16 = 0x373B;
const HEADSET_PID: u16 = 0x1204;
const MOUSE_VID: u16 = 0x1D57;
const MOUSE_PID: u16 = 0xFA60;

#[derive(Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum DeviceBattery {
    /// Dongle not plugged in, or device off / out of range.
    Absent,
    /// Dongle present but another app (ATK HUB) holds it.
    Busy,
    Ok { level: u8, charging: bool },
}

#[derive(Clone, Serialize, PartialEq)]
pub struct BatteryStatus {
    pub headset: DeviceBattery,
    pub mouse: DeviceBattery,
}

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let mut hid = hidapi::HidApi::new().ok();
        let mut last: Option<BatteryStatus> = None;
        loop {
            let status = BatteryStatus {
                headset: read_headset(),
                mouse: read_mouse(&mut hid),
            };
            if last.as_ref() != Some(&status) {
                if let Ok(mut g) = LATEST.lock() { *g = Some(status.clone()); }
                let _ = app.emit("device-battery", &status);
                last = Some(status);
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

fn read_headset() -> DeviceBattery {
    let Ok(ports) = serialport::available_ports() else { return DeviceBattery::Absent };
    let Some(port) = ports.into_iter().find(|p| matches!(&p.port_type,
        serialport::SerialPortType::UsbPort(u) if u.vid == HEADSET_VID && u.pid == HEADSET_PID))
    else {
        return DeviceBattery::Absent;
    };

    let mut serial = match serialport::new(&port.port_name, 9600).timeout(Duration::from_millis(300)).open() {
        Ok(s) => s,
        Err(e) if e.kind() == serialport::ErrorKind::Io(std::io::ErrorKind::PermissionDenied) => {
            return DeviceBattery::Busy
        }
        Err(e) if e.description.contains("Access is denied") => return DeviceBattery::Busy,
        Err(_) => return DeviceBattery::Absent,
    };
    let _ = serial.clear(serialport::ClearBuffer::Input);

    // Status (sub-command 4): byte[4] == 1 means the headset is connected to the dongle.
    match transact(&mut *serial, 4) {
        Some(r) if r[4] == 1 => {}
        _ => return DeviceBattery::Absent,
    }
    match transact(&mut *serial, 3) {
        Some(r) => {
            let raw = r[4];
            DeviceBattery::Ok { level: (raw & 0x7F).min(100), charging: raw & 0x80 != 0 }
        }
        None => DeviceBattery::Absent,
    }
}

fn transact(serial: &mut dyn serialport::SerialPort, sub: u8) -> Option<[u8; 64]> {
    let mut cmd = [0u8; 64];
    cmd[0] = 2; // payload length
    cmd[1] = 0; // AUTH group
    cmd[2] = sub;
    serial.write_all(&cmd).ok()?;

    let mut resp = [0u8; 64];
    let mut got = 0;
    let deadline = Instant::now() + Duration::from_millis(1500);
    while got < resp.len() && Instant::now() < deadline {
        match serial.read(&mut resp[got..]) {
            Ok(n) => got += n,
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
            Err(_) => return None,
        }
    }
    (got >= 5 && resp[1] == 0 && resp[2] == sub).then_some(resp)
}

fn read_mouse(hid: &mut Option<hidapi::HidApi>) -> DeviceBattery {
    let Some(api) = hid.as_mut() else { return DeviceBattery::Absent };
    if api.refresh_devices().is_err() {
        return DeviceBattery::Absent;
    }
    let Some(info) = api.device_list().find(|d| {
        d.vendor_id() == MOUSE_VID
            && d.product_id() == MOUSE_PID
            && d.path().to_string_lossy().to_ascii_lowercase().contains("&col03")
    }) else {
        return DeviceBattery::Absent;
    };
    let Ok(dev) = info.open_device(api) else { return DeviceBattery::Absent };

    // The mouse reports roughly every 2 s while awake; give it a few chances.
    let mut buf = [0u8; 64];
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        match dev.read_timeout(&mut buf, 2500) {
            Ok(n) if n >= 5 && buf[0] == 0x03 && buf[1] == 0x55 => {
                return DeviceBattery::Ok { level: buf[4].min(100), charging: false };
            }
            Ok(_) => continue,
            Err(_) => break,
        }
    }
    DeviceBattery::Absent
}
