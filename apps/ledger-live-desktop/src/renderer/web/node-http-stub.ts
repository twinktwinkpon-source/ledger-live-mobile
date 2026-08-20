/**
 * Minimal browser stand-in for Node's `http`/`https` modules.
 *
 * The FLEX_DEMO renderer imports `live-network` which, at module init, does
 * `new https.Agent({ keepAlive: true })` to configure axios. In the browser,
 * axios uses XHR/fetch and ignores `httpsAgent`, so a no-op `Agent` is safe:
 * we only need the constructor to exist to satisfy module-level code.
 */
export class Agent {
  constructor(_options: Record<string, unknown> = {}) {
    void _options;
  }
}

export default { Agent };
