import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "~/context/Locale";
import Video, { OnLoadData, ReactVideoSource, VideoRef } from "react-native-video";
import useIsAppInBackground from "~/components/useIsAppInBackground";
import { VideoTitleText } from "./WelcomePage.styles";

type VideoBackgroundProps = {
  videoSource: ReactVideoSource;
  titleKey: string;
  isOnStage?: boolean;
  onVideoLoad?: (data: OnLoadData) => void;
  onVideoEnd?: () => void;
};

/**
 * VideoBackground component to display a video background with a title.
 * @param param0 {VideoBackgroundProps} - Props for the VideoBackground component.
 * @returns React.JSX.Element
 */
export function VideoBackground({
  videoSource,
  titleKey,
  isOnStage = false,
  onVideoLoad,
  onVideoEnd,
}: Readonly<VideoBackgroundProps>) {
  const { t } = useTranslation();
  const videoRef = useRef<VideoRef | null>(null);
  // Keep <Video> mounted even when app starts in background state —
  // unmounting on cold start left a permanent black circle (videos never came back).
  const isInBackground = useIsAppInBackground();

  useEffect(() => {
    if (!isOnStage) {
      videoRef.current?.seek(0);
    }
  }, [isOnStage]);

  // Warm up the first frame: seek(0) once on mount so the very first visible
  // frame is decoded before the container is displayed (prevents grey flash).
  useEffect(() => {
    videoRef.current?.seek(0);
  }, []);

  return (
    <View style={[styles.container, { display: isOnStage ? "flex" : "none" }]}>
      <Video
        ref={videoRef}
        resizeMode="cover"
        muted
        disableFocus
        repeat={!isOnStage}
        source={videoSource}
        style={[styles.backgroundVideo]}
        onLoad={onVideoLoad}
        onError={e => {
          console.warn("[WelcomePage] video error:", String(e?.error?.errorCode || e?.error?.errorString || e));
        }}
        onEnd={() => {
          if (isOnStage) onVideoEnd?.();
        }}
        paused={!isOnStage || isInBackground}
      />
      <VideoTitleText>{t(titleKey)}</VideoTitleText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    backgroundColor: "#000000",
  },
  backgroundVideo: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
  },
});
