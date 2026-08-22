/**
 * Welcome videos are kept in assets/videos/ (registered in react-native.config.js)
 * so they are bundled into native resources and resolvable by the native video
 * player in release builds. The old src/mvvm/.../assets requires produced
 * noop:/// URIs that never loaded (black circle at first launch).
 */
export default {
  welcomeBasic1: require("../../../../assets/videos/welcome-basic-1.mp4"),
  welcomeBasic2: require("../../../../assets/videos/welcome-basic-2.mp4"),
  welcomeBasic3: require("../../../../assets/videos/welcome-basic-3.mp4"),
};
