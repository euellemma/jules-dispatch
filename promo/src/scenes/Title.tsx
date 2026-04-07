import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  AbsoluteFill,
  spring,
} from "remotion";

type Beat = { start: number; end: number };

const TITLE = "JULES DISPATCH";
const TAGLINE = "AI orchestration for developers";

export const Title = ({
  beats,
  fps,
}: {
  beats: Beat[];
  fps: number;
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame;
  const totalFrames = 4 * fps;

  // Fade out at end
  const fadeOut = interpolate(
    localFrame,
    [totalFrames - 20, totalFrames - 4],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Logo mark
  const logoSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 12, stiffness: 80, mass: 1.2 },
  });
  const logoScale = interpolate(logoSpring, [0, 1], [0, 1]);
  const logoOpacity = interpolate(logoSpring, [0, 1], [0, 1]);

  // Logo glow pulse
  const glowPulse = interpolate(
    localFrame,
    [0, 20, 40, 60],
    [0, 0.5, 0.3, 0.4],
    { extrapolateRight: "clamp" }
  );

  // Title letters
  const letters = TITLE.split("");

  // Tagline
  const taglineSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 20, stiffness: 60 },
    delay: 25,
  });
  const taglineOpacity = interpolate(taglineSpring, [0, 1], [0, 1]);
  const taglineY = interpolate(taglineSpring, [0, 1], [20, 0]);

  // Decorative lines
  const lineWidth = interpolate(localFrame, [15, 35], [0, 120], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const lineOpacity = interpolate(localFrame, [15, 35], [0, 0.3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#0a0a0a",
        opacity: fadeOut,
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 300,
          borderRadius: 100,
          background: `radial-gradient(ellipse, rgba(99, 102, 241, ${glowPulse * 0.08}) 0%, transparent 70%)`,
          filter: "blur(60px)",
        }}
      />

      {/* Logo mark */}
      <div
        style={{
          opacity: logoOpacity,
          transform: `scale(${logoScale})`,
          marginBottom: 28,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #A78BFA 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 8px 32px rgba(99, 102, 241, 0.3), 0 0 60px rgba(99, 102, 241, ${glowPulse * 0.15})`,
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path
              d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
              fill="white"
              opacity="0.95"
            />
          </svg>
        </div>
      </div>

      {/* Decorative line - left */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-${240 + lineWidth}px, -50%)`,
          width: lineWidth,
          height: 1,
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.2))",
          opacity: lineOpacity,
        }}
      />

      {/* Decorative line - right */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(240px, -50%)`,
          width: lineWidth,
          height: 1,
          background: "linear-gradient(90deg, rgba(255,255,255,0.2), transparent)",
          opacity: lineOpacity,
        }}
      />

      {/* Title - letter by letter */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        {letters.map((letter, i) => {
          const letterSpring = spring({
            frame: localFrame,
            fps,
            config: {
              damping: 8,
              stiffness: 120,
              mass: 0.6,
            },
            delay: 5 + i * 2.5,
          });

          const letterY = interpolate(letterSpring, [0, 1], [60, 0]);
          const letterScale = interpolate(letterSpring, [0, 1], [0.3, 1]);
          const letterOpacity = interpolate(letterSpring, [0, 1], [0, 1]);

          return (
            <span
              key={i}
              style={{
                fontFamily: "sans-serif",
                fontSize: letter === " " ? 0 : 64,
                fontWeight: 800,
                color: "#fff",
                letterSpacing: letter === " " ? 24 : 6,
                transform: `translateY(${letterY}px) scale(${letterScale})`,
                opacity: letterOpacity,
                display: "inline-block",
              }}
            >
              {letter === " " ? "\u00A0\u00A0\u00A0" : letter}
            </span>
          );
        })}
      </div>

      {/* Tagline */}
      <div
        style={{
          opacity: taglineOpacity,
          transform: `translateY(${taglineY}px)`,
        }}
      >
        <span
          style={{
            fontFamily: "sans-serif",
            fontSize: 18,
            color: "rgba(255,255,255,0.45)",
            fontWeight: 400,
            letterSpacing: 3,
            textTransform: "uppercase",
          }}
        >
          {TAGLINE}
        </span>
      </div>
    </AbsoluteFill>
  );
};
