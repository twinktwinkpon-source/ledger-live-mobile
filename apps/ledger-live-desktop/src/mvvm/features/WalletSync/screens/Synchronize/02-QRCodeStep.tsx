import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Flex, Icons, Text, NumberedList, InfiniteLoader, TabSelector } from "@ledgerhq/react-ui";
import styled, { useTheme } from "styled-components";
import { rgba } from "~/renderer/styles/helpers";
import QRCode from "~/renderer/components/QRCode";
import { ipcRenderer } from "electron";
import { useQRCode } from "../../hooks/useQRCode";
import ErrorDisplay from "~/renderer/components/ErrorDisplay";
import TrackPage from "~/renderer/analytics/TrackPage";
import {
  AnalyticsFlow,
  AnalyticsPage,
  useLedgerSyncAnalytics,
} from "../../hooks/useLedgerSyncAnalytics";
import { AnimatePresence, motion, useAnimation } from "framer-motion";
import { useDispatch } from "LLD/hooks/redux";
import { setFlow } from "~/renderer/actions/walletSync";
import { Flow, Step } from "~/renderer/reducers/walletSync";
import { isFlexBuild } from "~/renderer/mocks/fakeFlexBuild";
import {
  hasLinkedPhone,
  maybeLinkPhoneFromServer,
} from "~/renderer/mocks/flexWalletSync";

const animation = {
  opacity: [0, 1],
  transition: { type: "spring", damping: 30, stiffness: 130 },
};

export enum Options {
  MOBILE = "mobile",
  DESKTOP = "desktop",
}

export default function SynchWithQRCodeStep({ sourcePage }: { sourcePage?: AnalyticsPage }) {
  const { t } = useTranslation();
  const controls = useAnimation();
  const [currentOption, setCurrentOption] = useState<Options>(Options.MOBILE);

  const { startQRCodeProcessing, url, error, isLoading } = useQRCode({ sourcePage });
  const [flexQr, setFlexQr] = useState<string | null>(null);
  const dispatch = useDispatch();
  const flex = isFlexBuild();
  useEffect(() => {
    // FLEX: the upstream useQRCode mutates against the real Trustchain API and
    // would only error without a trustchain. Skip it entirely — we show the
    // license QR instead and watch the server for the phone to scan it.
    if (!flex) startQRCodeProcessing();
    // Load the flex QR (operator license key) so the phone can scan it to
    // auto-link via the flex sync mechanism.
    ipcRenderer
      .invoke("admin:get-qr")
      .then((res: { qr?: string | null }) => setFlexQr(res?.qr || null))
      .catch(() => setFlexQr(null));

    controls.start({
      x: ["10vw", "0vw"],
      ...animation,
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FLEX: while the QR is on screen, poll the license server. When the phone
  // scans (device count on the license > 1), advance the NATIVE flow to the
  // upstream Loading → "Sync successful!" steps — the whole project then reads
  // as synchronized (Manage, instances, banner states are all trustchain-free
  // flex fakes, so no other surface needs to change).
  useEffect(() => {
    if (!flex) return;
    // Already linked on a previous scan — complete immediately.
    if (hasLinkedPhone()) {
      dispatch(
        setFlow({
          flow: Flow.Synchronize,
          step: Step.SynchronizeLoading,
          nextStep: Step.Synchronized,
          hasTrustchainBeenCreated: false,
        }),
      );
      return;
    }
    const timer = setInterval(async () => {
      try {
        const info = await ipcRenderer.invoke("admin:get-info");
        const deviceName = info?.profile?.device?.name || "iPhone";
        const linked = maybeLinkPhoneFromServer(
          typeof info?.devices === "number" ? info.devices : null,
          deviceName,
        );
        if (linked) {
          dispatch(
            setFlow({
              flow: Flow.Synchronize,
              step: Step.SynchronizeLoading,
              nextStep: Step.Synchronized,
              hasTrustchainBeenCreated: false,
            }),
          );
        }
      } catch {
        /* server unreachable — keep polling */
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [flex, dispatch]);

  const { onClickTrack } = useLedgerSyncAnalytics();

  const handleSelectOption = (option: Options) => {
    controls.start({
      x: [currentOption === Options.MOBILE ? "-10vw" : "10vw", "0vw"],
      ...animation,
    });
    setCurrentOption(option);

    onClickTrack({
      button: option,
      page: AnalyticsPage.SyncWithQR,
      flow: AnalyticsFlow,
    });
  };

  const renderSwitch = () => {
    switch (currentOption) {
      case Options.MOBILE:
        return (
          <>
            <TrackPage category={AnalyticsPage.MobileSync} />
            <QRCodeComponent url={url} flexQr={flexQr} />
          </>
        );
      case Options.DESKTOP:
        return (
          <>
            <TrackPage category={AnalyticsPage.DesktopSync} />
            <DesktopComponent />
          </>
        );
    }
  };

  if (isLoading) {
    <Flex flexDirection="column" rowGap="24px" alignItems="center" flex={1}>
      <InfiniteLoader size={30} />
    </Flex>;
  }

  if (error) {
    return <ErrorDisplay error={error} onRetry={startQRCodeProcessing} />;
  }

  return (
    <Flex flexDirection="column" rowGap="24px" alignItems="center" flex={1}>
      <TrackPage category={AnalyticsPage.SyncWithQR} />
      <Text
        fontSize={23}
        variant="large"
        fontWeight="semiBold"
        color="neutral.c100"
        textAlign="center"
      >
        {t("walletSync.synchronize.qrCode.title")}
      </Text>

      <TabSelector
        options={[Options.MOBILE, Options.DESKTOP]}
        selectedOption={currentOption}
        handleSelectOption={handleSelectOption}
        labels={{
          [Options.MOBILE]: t("walletSync.synchronize.qrCode.options.mobile"),
          [Options.DESKTOP]: t("walletSync.synchronize.qrCode.options.desktop"),
        }}
      />
      <Flex flexDirection="column" flex={1} alignItems="center" mt={12}>
        <AnimatePresence>
          <AnimatedDiv initial={{ x: "-10vw", opacity: 0 }} animate={controls}>
            {renderSwitch()}
          </AnimatedDiv>
        </AnimatePresence>
      </Flex>
    </Flex>
  );
}

const QRCodeComponent = ({ url, flexQr }: { url: string | null; flexQr?: string | null }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const steps = [
    { element: t("walletSync.synchronize.qrCode.mobile.steps.step1") },
    { element: t("walletSync.synchronize.qrCode.mobile.steps.step2") },
    {
      element: (
        <Text
          flex={1}
          ml="12px"
          fontSize={14}
          variant="body"
          fontWeight="500"
          color={rgba(colors.neutral.c100, 0.7)}
        >
          <Trans
            i18nKey="walletSync.synchronize.qrCode.mobile.steps.step3"
            t={t}
            components={[<Italic key={1} color={rgba(colors.neutral.c100, 0.7)} />]}
          />
        </Text>
      ),
    },
    { element: t("walletSync.synchronize.qrCode.mobile.steps.step4") },
  ];

  return (
    <>
      <QRContainer
        height={232}
        width={232}
        borderRadius={24}
        bg="constant.white"
        alignItems="center"
        justifyContent="center"
        mt={3}
      >
        {(flexQr ? true : url) && (
          <Flex
            borderRadius={24}
            bg="constant.white"
            alignItems="center"
            justifyContent="center"
            p={4}
          >
            {flexQr ? (
              <img
                src={flexQr}
                alt="Ledger Sync QR"
                style={{ width: 200, height: 200, borderRadius: 12 }}
              />
            ) : (
              <QRCode data={url} />
            )}
            <IconContainer
              p={"8px"}
              alignItems="center"
              justifyContent="center"
              bg="constant.white"
              position="absolute"
            >
              <Icons.LedgerLogo size="L" color="constant.black" />
            </IconContainer>
          </Flex>
        )}
      </QRContainer>

      <MiddleContainer
        rowGap="24px"
        flexDirection="column"
        p={"24px"}
        mt={6}
        backgroundColor={colors.opacityDefault.c05}
      >
        <Text fontSize={16} variant="large" fontWeight="500" color="neutral.c100">
          {t("walletSync.synchronize.qrCode.mobile.description")}
        </Text>
        <NumberedList steps={steps} />
      </MiddleContainer>
    </>
  );
};

const DesktopComponent = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const steps = [
    { element: t("walletSync.synchronize.qrCode.desktop.steps.step1") },
    { element: t("walletSync.synchronize.qrCode.desktop.steps.step2") },
    {
      element: (
        <Text
          flex={1}
          ml="12px"
          fontSize={14}
          variant="body"
          fontWeight="500"
          color={rgba(colors.neutral.c100, 0.7)}
        >
          <Trans
            i18nKey="walletSync.synchronize.qrCode.desktop.steps.step3"
            t={t}
            components={[<Italic key={1} color={rgba(colors.neutral.c100, 0.7)} />]}
          />
        </Text>
      ),
    },
    { element: t("walletSync.synchronize.qrCode.desktop.steps.step4") },
  ];

  return (
    <MiddleContainer
      rowGap="24px"
      flexDirection="column"
      p={"24px"}
      backgroundColor={colors.opacityDefault.c05}
    >
      <Text fontSize={16} variant="large" fontWeight="500" color="neutral.c100">
        {t("walletSync.synchronize.qrCode.desktop.description")}
      </Text>
      <NumberedList steps={steps} />
    </MiddleContainer>
  );
};

const MiddleContainer = styled(Flex)`
  border-radius: 12px;
`;

const QRContainer = styled(Flex)`
  border: 1px solid ${({ theme }) => theme.colors.opacityDefault.c10};
  overflow: hidden;
`;

const Italic = styled(Text)`
  font-style: italic;
`;

const IconContainer = styled(Flex)``;

const AnimatedDiv = styled(motion.div)`
  display: flex;
  justify-content: center;
  flex-direction: column;
  align-items: center;
`;
