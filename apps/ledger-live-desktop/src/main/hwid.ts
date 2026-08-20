/**
 * HWID Generator — creates a unique hardware ID from CPU + GPU info.
 * Used for license binding.
 *
 * On Windows: uses PowerShell `Get-CimInstance` (modern replacement for deprecated `wmic`)
 * On macOS: uses `system_profiler`
 * On Linux: uses `lscpu` + `lspci`
 */

import { execSync } from "child_process";
import crypto from "crypto";
import os from "os";

function safeExec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

function getWindowsHwid(): string {
  // wmic is deprecated/removed in Windows 11 — use PowerShell Get-CimInstance instead
  const cpuSerial = safeExec(
    'powershell -NoProfile -Command "(Get-CimInstance Win32_Processor).ProcessorId"',
  );
  const gpuName = safeExec(
    'powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController).Name"',
  );
  const mbSerial = safeExec(
    'powershell -NoProfile -Command "(Get-CimInstance Win32_BaseBoard).SerialNumber"',
  );

  return `WIN|${cpuSerial}|${gpuName}|${mbSerial}`;
}

function getMacHwid(): string {
  const cpu = safeExec("sysctl -n machdep.cpu.brand_string");
  const gpu = safeExec("system_profiler SPDisplaysDataType -json 2>/dev/null");
  const ioReg = safeExec(
    "ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformSerialNumber",
  );
  const serial = ioReg.split('"=')[1]?.trim().replace(/"/g, "") || "";

  return `MAC|${cpu}|${gpu.slice(0, 200)}|${serial}`;
}

function getLinuxHwid(): string {
  const cpu = safeExec("cat /proc/cpuinfo | grep -i 'serial' | head -1");
  const cpuModel = safeExec("cat /proc/cpuinfo | grep -i 'model name' | head -1");
  const gpu = safeExec("lspci | grep -i vga");

  return `LINUX|${cpu}|${cpuModel}|${gpu}`;
}

export function getHwid(): string {
  let raw: string;

  switch (process.platform) {
    case "win32":
      raw = getWindowsHwid();
      break;
    case "darwin":
      raw = getMacHwid();
      break;
    case "linux":
      raw = getLinuxHwid();
      break;
    default:
      raw = `UNKNOWN|${process.platform}|${process.arch}`;
  }

  // If we couldn't get any hardware info, fall back to machine info
  if (!raw || raw.length < 10) {
    raw = `FALLBACK|${process.platform}|${process.arch}|${os.hostname()}`;
  }

  // Normalize: trim each segment and collapse spaces around the | separators
  // so the same hardware always produces an identical HWID string (the server
  // hashes this exact string, so any whitespace drift breaks key binding).
  raw = raw
    .split("|")
    .map(s => s.trim())
    .join("|")
    .replace(/\s+/g, " ")
    .trim();

  return raw;
}

/**
 * Returns a hashed HWID for sending to the server.
 * The server stores only the hash, never the raw hardware info.
 */
export function getHwidHash(): string {
  const raw = getHwid();
  const salt = process.env.HWID_SALT || "ledger-2024";
  return crypto
    .createHash("sha256")
    .update(raw + salt)
    .digest("hex");
}
