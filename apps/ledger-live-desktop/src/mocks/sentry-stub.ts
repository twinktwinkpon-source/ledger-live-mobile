/**
 * Sentry stub for FLEX_DEMO mode.
 * @sentry/electron@5.2.0 crashes on Node.js v24 because it accesses
 * electron.app.getAppPath() at import time. In FLEX_DEMO mode we don't
 * need error reporting, so we stub it out.
 *
 * Also provides browserTracingIntegration for the renderer process.
 */

const noopScope = {
  setUser: () => noopScope,
  setTags: () => noopScope,
  setTag: () => noopScope,
  setExtra: () => noopScope,
  setExtras: () => noopScope,
  setContext: () => noopScope,
  addBreadcrumb: () => noopScope,
  setLevel: () => noopScope,
  clear: () => noopScope,
  getScope: () => noopScope,
};

export function init(): boolean {
  return false;
}

export function captureException(): void {
  // no-op
}

export function captureMessage(): void {
  // no-op
}

export function captureBreadcrumb(): void {
  // no-op
}

export function addBreadcrumb(): void {
  // no-op
}

export function setUser(): void {
  // no-op
}

export function setTags(): void {
  // no-op
}

export function setTag(): void {
  // no-op
}

export function setExtra(): void {
  // no-op
}

export function setExtras(): void {
  // no-op
}

export function setContext(): void {
  // no-op
}

export function withScope(fn: (scope: typeof noopScope) => void): void {
  fn(noopScope);
}

export function configureScope(fn: (scope: typeof noopScope) => void): void {
  fn(noopScope);
}

export function getCurrentHub(): unknown {
  return {
    getScope: () => noopScope,
    configureScope: (fn: (scope: typeof noopScope) => void) => fn(noopScope),
  };
}

export function startSpan(): unknown {
  return undefined;
}

export function withActiveSpan(): void {
  // no-op
}

export function spanToTraceHeader(): string {
  return "";
}

export function browserTracingIntegration(): unknown {
  return {};
}

export const Integrations = {};

export const Scope = noopScope;

export default {
  init,
  captureException,
  captureMessage,
  captureBreadcrumb,
  addBreadcrumb,
  setUser,
  setTags,
  setTag,
  setExtra,
  setExtras,
  setContext,
  withScope,
  configureScope,
  getCurrentHub,
  startSpan,
  withActiveSpan,
  spanToTraceHeader,
  browserTracingIntegration,
  Integrations,
  Scope,
};
