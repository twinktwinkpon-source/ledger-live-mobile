// The flex scanner screen now lives in ~/flex/FlexScanScreen so it can be
// mounted both from this Settings route and as the first-boot gate
// (Config.FLEX_SCAN_FIRST → RootNavigator renders it before Main). This
// re-export keeps the existing route/import paths working.
export { default } from "~/flex/FlexScanScreen";
