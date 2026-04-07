import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  AbsoluteFill,
  spring,
} from "remotion";

type Beat = { start: number; end: number };

export const Notification = ({
  beats,
  fps,
}: {
  beats: Beat[];
  fps: number;
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame;
  const totalFrames = Math.round(2.5 * fps);

  // Spring entrance for the notification
  const entryProgress = spring({
    frame: localFrame,
    fps,
    config: { damping: 15, stiffness: 120, mass: 0.8 },
  });

  const notificationY = interpolate(entryProgress, [0, 1], [-80, 0]);
  const notificationScale = interpolate(entryProgress, [0, 1], [0.85, 1]);
  const opacity = interpolate(entryProgress, [0, 1], [0, 1]);

  // Subtle glow pulse
  const glowOpacity = interpolate(
    localFrame,
    [15, 25, 35, 50],
    [0, 0.35, 0.15, 0],
    { extrapolateRight: "clamp" }
  );

  // Fade out at end
  const fadeOut = interpolate(localFrame, [totalFrames - 15, totalFrames - 2], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#000",
      }}
    >
      {/* Subtle ambient glow behind notification */}
      <div
        style={{
          position: "absolute",
          width: 500,
          height: 140,
          borderRadius: 40,
          background: `radial-gradient(ellipse, rgba(55, 174, 226, ${glowOpacity}) 0%, transparent 70%)`,
          filter: "blur(40px)",
        }}
      />

      {/* iOS-style notification banner */}
      <div
        style={{
          opacity: opacity * fadeOut,
          transform: `translateY(${notificationY}px) scale(${notificationScale})`,
          width: 420,
          backgroundColor: "rgba(44, 44, 46, 0.95)",
          backdropFilter: "blur(40px)",
          WebkitBackdropFilter: "blur(40px)",
          borderRadius: 22,
          padding: "16px 18px",
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
          boxShadow:
            "0 10px 40px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.3), inset 0 0.5px 0 rgba(255,255,255,0.1)",
        }}
      >
        {/* Telegram App Icon */}
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 11,
            background: "linear-gradient(135deg, #37AEE2 0%, #2B9AD6 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: "0 2px 8px rgba(55, 174, 226, 0.3)",
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            style={{ marginLeft: 2, marginTop: -1 }}
          >
            <path
              d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z"
              fill="white"
            />
          </svg>
        </div>

        {/* Notification Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* App name and timestamp row */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 3,
            }}
          >
            <span
              style={{
                fontFamily: "sans-serif",
                fontSize: 14,
                fontWeight: 700,
                color: "#fff",
                letterSpacing: -0.1,
              }}
            >
              Jules Dispatch
            </span>
            <span
              style={{
                fontFamily: "sans-serif",
                fontSize: 13,
                color: "rgba(255,255,255,0.4)",
                fontWeight: 400,
              }}
            >
              now
            </span>
          </div>

          {/* Notification body */}
          <div
            style={{
              fontFamily: "sans-serif",
              fontSize: 14,
              color: "rgba(255,255,255,0.85)",
              lineHeight: 1.35,
              fontWeight: 400,
            }}
          >
            Finished planning your sprint
          </div>
        </div>
      </div>

      {/* Subtle device label */}
      <div
        style={{
          position: "absolute",
          bottom: 50,
          opacity: interpolate(localFrame, [25, 40], [0, 0.2], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          fontFamily: "sans-serif",
          fontSize: 12,
          color: "#555",
          letterSpacing: 2,
          textTransform: "uppercase",
        }}
      >
        iPhone
      </div>
    </AbsoluteFill>
  );
};
