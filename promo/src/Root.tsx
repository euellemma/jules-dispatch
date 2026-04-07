import { Composition } from "remotion";
import { Promo } from "./Promo";

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

// Scene durations: 4 + 2.5 + 9 + 8 + 6 + 7 = 36.5s
// 5 transitions × 12 frames overlap = 60 frames
// Total: 1095 - 60 = 1035 frames (34.5s)
const DURATION_FRAMES = 1035;

export const RemotionRoot = () => {
  return (
    <Composition
      id="Promo"
      component={Promo}
      durationInFrames={DURATION_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
