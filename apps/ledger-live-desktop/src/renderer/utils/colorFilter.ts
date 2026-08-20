import Color from "color";

export function getCryptoIconColorFilter(color: string): string {
  const c = Color(color);
  const { red, green, blue } = c.rgb().object();

  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const invertPct = Math.round((1 - luminance) * 100);
  const sepiaPct = 100;
  const saturatePct = 5000;
  const hueDeg = Math.round(
    (Math.atan2(
      Math.sqrt(3) * (g - b),
      2 * r - g - b
    ) * 180) / Math.PI
  );

  return `brightness(0) saturate(100%) invert(${invertPct}%) sepia(${sepiaPct}%) saturate(${saturatePct}%) hue-rotate(${hueDeg}deg)`;
}
