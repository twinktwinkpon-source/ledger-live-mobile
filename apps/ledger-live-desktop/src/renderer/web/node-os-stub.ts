/**
 * Minimal browser stand-in for Node's `os` module.
 *
 * The renderer reads `os.type()`/`os.release()` for OS support checks and
 * `os.platform()` etc. for telemetry. In the browser there is no OS concept
 * for the PWA itself, so we report a neutral, "supported" value.
 */
export function type(): string {
  return "Browser";
}

export function release(): string {
  return "";
}

export function platform(): string {
  return "browser";
}

export function arch(): string {
  return "browser";
}

export function homedir(): string {
  return "/";
}

export function tmpdir(): string {
  return "/tmp";
}

export function hostname(): string {
  return "localhost";
}

export function cpus(): Array<{ model: string; speed: number; times: Record<string, number> }> {
  return [{ model: "Browser", speed: 1, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }];
}

export function networkInterfaces(): Record<string, unknown> {
  return {};
}

export function totalmem(): number {
  return 0;
}

export function freemem(): number {
  return 0;
}

export function endianness(): "LE" | "BE" {
  return "LE";
}

export function userInfo(): { username: string; uid: number; gid: number; shell: string | null; homedir: string } {
  return { username: "browser", uid: 0, gid: 0, shell: null, homedir: "/" };
}

export const EOL = "\n";

export default {
  type,
  release,
  platform,
  arch,
  homedir,
  tmpdir,
  hostname,
  cpus,
  networkInterfaces,
  totalmem,
  freemem,
  endianness,
  userInfo,
  EOL,
};
