import {
  useCurrentFrame,
  interpolate,
  AbsoluteFill,
  spring,
} from "remotion";

type Beat = { start: number; end: number };

const TG_ACCENT = "#64B5F6";

export const TestReport = ({
  beats,
  fps,
}: {
  beats: Beat[];
  fps: number;
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame;
  const totalFrames = 6 * fps;

  // File upload animation - spring entrance
  const uploadSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 12, stiffness: 100 },
    delay: 0,
  });
  const uploadOpacity = interpolate(uploadSpring, [0, 1], [0, 1], {
    extrapolateRight: "clamp",
  });
  const uploadY = interpolate(uploadSpring, [0, 1], [30, 0]);

  // Bot response
  const analysisSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 90 },
    delay: 15,
  });
  const analysisOpacity = interpolate(analysisSpring, [0, 1], [0, 1], {
    extrapolateRight: "clamp",
  });
  const analysisY = interpolate(analysisSpring, [0, 1], [20, 0]);

  // Action
  const actionSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 90 },
    delay: 35,
  });
  const actionOpacity = interpolate(actionSpring, [0, 1], [0, 1], {
    extrapolateRight: "clamp",
  });
  const actionY = interpolate(actionSpring, [0, 1], [20, 0]);

  // Typing indicator for analysis lines
  const line1Opacity = interpolate(localFrame, [22, 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const line2Opacity = interpolate(localFrame, [28, 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const line3Opacity = interpolate(localFrame, [34, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        gap: 16,
        backgroundColor: "#0a0a0a",
        opacity: interpolate(
          localFrame,
          [totalFrames - 15, totalFrames - 2],
          [1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        ),
      }}
    >
      {/* File upload - user message style */}
      <div
        style={{
          opacity: uploadOpacity,
          transform: `translateY(${uploadY}px)`,
          alignSelf: "flex-end",
          marginRight: 280,
          marginBottom: 8,
        }}
      >
        <div
          style={{
            backgroundColor: "#2B5278",
            borderRadius: "14px 14px 4px 14px",
            padding: "12px 18px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          {/* File icon */}
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: "rgba(0,0,0,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                stroke="#F5F5F5"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M14 2v6h6M8 13h8M8 17h5"
                stroke="#F5F5F5"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <div
              style={{
                fontFamily: "sans-serif",
                fontSize: 14,
                fontWeight: 500,
                color: "#F5F5F5",
              }}
            >
              test-results.log
            </div>
            <div
              style={{
                fontFamily: "sans-serif",
                fontSize: 11,
                color: "rgba(255,255,255,0.45)",
                marginTop: 1,
              }}
            >
              42 failures
            </div>
          </div>
        </div>
      </div>

      {/* Bot analysis - Telegram bubble */}
      <div
        style={{
          opacity: analysisOpacity,
          transform: `translateY(${analysisY}px)`,
          alignSelf: "flex-start",
          marginLeft: 80,
        }}
      >
        {/* Bot avatar + name */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #37AEE2 0%, #2B9AD6 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z"
                fill="white"
              />
            </svg>
          </div>
          <span
            style={{
              fontFamily: "sans-serif",
              fontSize: 13,
              color: "#708499",
              fontWeight: 500,
            }}
          >
            Jules Dispatch
          </span>
        </div>

        <div
          style={{
            backgroundColor: "#182533",
            borderRadius: "14px 14px 14px 4px",
            padding: "16px 20px",
            maxWidth: 520,
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 14,
              lineHeight: 1.8,
            }}
          >
            <div
              style={{
                color: "#F5F5F5",
                opacity: line1Opacity,
              }}
            >
              42 failures analyzed.
            </div>
            <div
              style={{
                color: "#4ECA64",
                opacity: line2Opacity,
              }}
            >
              38 snapshot drift — ignored.
            </div>
            <div
              style={{
                color: "#E86C60",
                opacity: line3Opacity,
              }}
            >
              4 real regressions — fixing now.
            </div>
          </div>
        </div>
      </div>

      {/* Action - sessions spawned */}
      <div
        style={{
          opacity: actionOpacity,
          transform: `translateY(${actionY}px)`,
          alignSelf: "flex-start",
          marginLeft: 80,
          marginTop: 4,
        }}
      >
        <div
          style={{
            backgroundColor: "#182533",
            borderRadius: "14px 14px 14px 4px",
            padding: "12px 18px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background:
                "linear-gradient(135deg, #F59E0B 0%, #F97316 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <span
            style={{
              fontFamily: "sans-serif",
              fontSize: 14,
              fontWeight: 500,
              color: "#F5F5F5",
            }}
          >
            Two sessions spawned
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
