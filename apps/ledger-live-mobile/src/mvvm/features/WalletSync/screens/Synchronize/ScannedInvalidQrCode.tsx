import React from "react";
import { useTranslation } from "~/context/Locale";
import { ErrorComponent } from "../../components/Error/Simple";
import { AnalyticsButton, AnalyticsPage } from "../../hooks/useLedgerSyncAnalytics";
import { track } from "~/analytics";
import { useSelector } from "~/context/hooks";
import { flexSelector } from "~/reducers/flex";

interface Props {
  tryAgain: () => void;
}

export default function ScannedInvalidQrCode({ tryAgain }: Props) {
  const { t } = useTranslation();
  const flexError = useSelector(flexSelector).error;

  const onTryAgain = () => {
    tryAgain();
    track("button_clicked", {
      button: AnalyticsButton.Understand,
      page: AnalyticsPage.ScannedInvalidQrCode,
    });
  };

  return (
    <ErrorComponent
      title={t("walletSync.synchronize.qrCode.scannedInvalidQrCode.title")}
      desc={
        flexError
          ? `[flex error] ${flexError}`
          : t("walletSync.synchronize.qrCode.scannedInvalidQrCode.desc")
      }
      info={t("walletSync.synchronize.qrCode.scannedInvalidQrCode.info")}
      mainButton={{
        label: t("walletSync.synchronize.qrCode.scannedInvalidQrCode.tryAgain"),
        onPress: onTryAgain,
        outline: false,
      }}
      analyticsPage={AnalyticsPage.ScannedInvalidQrCode}
    />
  );
}
