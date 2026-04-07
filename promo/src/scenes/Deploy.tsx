import {
  useCurrentFrame,
  interpolate,
  AbsoluteFill,
} from "remotion";

type Beat = { start: number; end: number };

const TERMINAL_LINES = [
  { text: "npx jules-dispatch", type: "command", delay: 20 },
  { text: "  \u2713 Convex Hobby (free tier)", type: "success", delay: 35 },
  { text: "  \u2713 Telegram bot connected", type: "success", delay: 48 },
  { text: "  \u2713 Deployed.", type: "success", delay: 62 },
  { text: "", type: "spacer", delay: 75 },
  { text: "github.com/anomalyco/jules-dispatch", type: "link", delay: 82 },
];

export const Deploy = ({
  beats,
  fps,
}: {
  beats: Beat[];
  fps: number;
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame;
  const totalFrames = 7 * fps;

  // Terminal window entrance
  const terminalOpacity = interpolate(localFrame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });
  const terminalScale = interpolate(localFrame, [0, 15], [0.95, 1], {
    extrapolateRight: "clamp",
  });

  // Cursor blink before command appears
  const cursorVisible =
    localFrame < 20 ? Math.floor(localFrame / 10) % 2 === 0 : false;

  // Fade out
  const fadeOut = interpolate(
    localFrame,
    [totalFrames - 15, totalFrames - 2],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#0a0a0a",
      }}
    >
      {/* Subtle ambient glow */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 400,
          borderRadius: 40,
          background:
            "radial-gradient(ellipse, rgba(78, 202, 100, 0.04) 0%, transparent 70%)",
          filter: "blur(60px)",
        }}
      />

      {/* Terminal window */}
      <div
        style={{
          opacity: terminalOpacity * fadeOut,
          transform: `scale(${terminalScale})`,
          backgroundColor: "#1a1b26",
          borderRadius: 12,
          width: 680,
          overflow: "hidden",
          boxShadow:
            "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)",
        }}
      >
        {/* Terminal title bar - macOS style */}
        <div
          style={{
            height: 40,
            backgroundColor: "#15161e",
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            position: "relative",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {/* Traffic light buttons */}
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: "#FF5F57",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: "#FEBC2E",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: "#28C840",
              }}
            />
          </div>

          {/* Title */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              fontFamily: "sans-serif",
              fontSize: 13,
              color: "rgba(255,255,255,0.35)",
              fontWeight: 500,
            }}
          >
            bash — 80×24
          </div>
        </div>

        {/* Terminal content */}
        <div
          style={{
            padding: "20px 24px",
            fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
            fontSize: 14,
            lineHeight: 1.8,
            minHeight: 180,
          }}
        >
          {/* Blinking cursor before command */}
          {localFrame < 20 && (
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ color: "#7AA2F7", marginRight: 8 }}>$</span>
              {cursorVisible && (
                <div
                  style={{
                    width: 8,
                    height: 16,
                    backgroundColor: "#C0CAF5",
                    display: "inline-block",
                  }}
                />
              )}
            </div>
          )}

          {TERMINAL_LINES.map((line, i) => {
            const opacity = interpolate(
              localFrame,
              [line.delay, line.delay + 6],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }
            );

            if (localFrame < line.delay) return null;

            if (line.type === "spacer") {
              return <div key={i} style={{ height: 12 }} />;
            }

            let color = "#C0CAF5";
            if (line.type === "success") color = "#9ECE6A";
            if (line.type === "link") color = "#7AA2F7";

            return (
              <div
                key={i}
                style={{
                  opacity,
                  color,
                  fontWeight: line.type === "link" ? 600 : 400,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {line.type === "command" && (
                  <span style={{ color: "#7AA2F7", marginRight: 8 }}>$</span>
                )}
                {line.type === "command" ? line.text : line.text}
              </div>
            );
          })}

          {/* Final cursor after all lines */}
          {localFrame > 80 && (
            <div style={{ display: "flex", alignItems: "center", marginTop: 8 }}>
              <span style={{ color: "#7AA2F7", marginRight: 8 }}>$</span>
              {Math.floor(localFrame / 10) % 2 === 0 && (
                <div
                  style={{
                    width: 8,
                    height: 16,
                    backgroundColor: "#C0CAF5",
                    display: "inline-block",
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
