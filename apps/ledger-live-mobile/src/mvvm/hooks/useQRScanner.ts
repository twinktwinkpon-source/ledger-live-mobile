import { useCallback, useRef } from "react";
import { useCameraDevice, useCodeScanner, Code } from "react-native-vision-camera";

export function useQRScanner(onScan: (data: string) => void) {
  const device = useCameraDevice("back");

  // Vision-camera fires onCodeScanned for EVERY frame while a QR is visible
  // (many times per second). Re-entering the scan handler that many times
  // spawned concurrent activations/navigations and destabilized Hermes
  // (SIGSEGV in drainMicrotasks). Deduplicate identical codes within a window.
  const lastRef = useRef<{ value: string; at: number } | null>(null);

  const onCodeScanned = useCallback(
    (codes: Code[]) => {
      const code = codes[0];
      if (!code?.value) return;
      const now = Date.now();
      const last = lastRef.current;
      if (last && last.value === code.value && now - last.at < 1500) return;
      lastRef.current = { value: code.value, at: now };
      onScan(code.value);
    },
    [onScan],
  );

  const codeScanner = useCodeScanner({
    codeTypes: ["qr"],
    onCodeScanned,
  });

  return { device, codeScanner };
}
