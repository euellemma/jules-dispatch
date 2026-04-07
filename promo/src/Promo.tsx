import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Title } from "./scenes/Title";
import { Notification } from "./scenes/Notification";
import { TelegramChat } from "./scenes/TelegramChat";
import { ParallelSessions } from "./scenes/ParallelSessions";
import { TestReport } from "./scenes/TestReport";
import { Deploy } from "./scenes/Deploy";

const FPS = 30;

const BEATS = [
  { start: 0, end: 4 }, // Title intro
  { start: 4, end: 6.5 }, // Notification
  { start: 6.5, end: 15.5 }, // Telegram chat
  { start: 15.5, end: 23.5 }, // Parallel sessions
  { start: 23.5, end: 29.5 }, // Test report
  { start: 29.5, end: 36.5 }, // Deploy
];

const TRANSITION_FRAMES = 12;

export const Promo = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <TransitionSeries>
        {/* Title - 4s */}
        <TransitionSeries.Sequence durationInFrames={4 * FPS}>
          <Title beats={BEATS} fps={FPS} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Notification - 2.5s */}
        <TransitionSeries.Sequence durationInFrames={Math.round(2.5 * FPS)}>
          <Notification beats={BEATS} fps={FPS} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Telegram Chat - 9s */}
        <TransitionSeries.Sequence durationInFrames={9 * FPS}>
          <TelegramChat beats={BEATS} fps={FPS} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Parallel Sessions - 8s */}
        <TransitionSeries.Sequence durationInFrames={8 * FPS}>
          <ParallelSessions beats={BEATS} fps={FPS} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Test Report - 6s */}
        <TransitionSeries.Sequence durationInFrames={6 * FPS}>
          <TestReport beats={BEATS} fps={FPS} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Deploy - 7s */}
        <TransitionSeries.Sequence durationInFrames={7 * FPS}>
          <Deploy beats={BEATS} fps={FPS} />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
