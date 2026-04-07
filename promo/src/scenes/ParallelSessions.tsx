import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  AbsoluteFill,
  spring,
} from "remotion";

type Beat = { start: number; end: number };

const SESSIONS = [
  {
    id: "s1",
    name: "payment routes",
    color: "#4ECA64",
    colorRgb: "78, 202, 100",
    files: [
      "src/routes/pay.ts",
      "src/routes/checkout.ts",
      "src/middleware/stripe.ts",
      "tests/pay.test.ts",
    ],
    doneAt: 70,
  },
  {
    id: "s2",
    name: "auth patches",
    color: "#64B5F6",
    colorRgb: "100, 181, 246",
    files: [
      "src/auth/jwt.ts",
      "src/auth/refresh.ts",
      "src/middleware/auth.ts",
      "tests/auth.test.ts",
    ],
    doneAt: 65,
  },
  {
    id: "s3",
    name: "integration tests",
    color: "#C084FC",
    colorRgb: "192, 132, 252",
    files: [
      "tests/e2e/login.test.ts",
      "tests/e2e/checkout.test.ts",
      "tests/e2e/webhook.test.ts",
      "tests/e2e/api.test.ts",
    ],
    doneAt: 120,
  },
  {
    id: "s4",
    name: "rate limiter",
    color: "#FBBF24",
    colorRgb: "251, 191, 36",
    files: [
      "src/middleware/rate.ts",
      "src/lib/redis-client.ts",
      "src/config/limits.ts",
      "tests/rate.test.ts",
    ],
    doneAt: 75,
  },
];

// Terminal line types per session
const TERMINAL_OPS = ["modify", "create", "test", "merge"];

function MiniTerminal({
  session,
  localFrame,
  fps,
  delay,
}: {
  session: (typeof SESSIONS)[0];
  localFrame: number;
  fps: number;
  delay: number;
}) {
  const panelSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 80, mass: 0.9 },
    delay,
  });

  const panelOpacity = interpolate(panelSpring, [0, 1], [0, 1]);
  const panelScale = interpolate(panelSpring, [0, 1], [0.85, 1]);
  const panelY = interpolate(panelSpring, [0, 1], [30, 0]);

  // Progress bar
  const progress = interpolate(
    localFrame,
    [delay + 15, session.doneAt],
    [0, 100],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Is session done?
  const isDone = localFrame >= session.doneAt + delay;

  // Checkmark spring
  const checkSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 10, stiffness: 120 },
    delay: session.doneAt + delay + 5,
  });
  const checkScale = localFrame >= session.doneAt + delay ? interpolate(checkSpring, [0, 1], [0, 1]) : 0;

  // Scroll through file lines
  const visibleLines = Math.min(
    session.files.length,
    Math.floor((localFrame - delay - 5) / 12) + 1
  );

  // Blinking cursor for active session
  const cursorVisible = !isDone && Math.floor(localFrame / 8) % 2 === 0;

  return (
    <div
      style={{
        opacity: panelOpacity,
        transform: `scale(${panelScale}) translateY(${panelY}px)`,
        width: 380,
        height: 240,
        backgroundColor: "#1a1b26",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05), inset 0 0 0 1px rgba(${session.colorRgb}, ${isDone ? 0.15 : 0.08})`,
      }}
    >
      {/* Mini title bar */}
      <div
        style={{
          height: 32,
          backgroundColor: "#15161e",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          gap: 8,
          borderBottom: `1px solid rgba(${session.colorRgb}, 0.1)`,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: isDone ? session.color : session.color,
            boxShadow: isDone ? "none" : `0 0 6px ${session.color}`,
            opacity: isDone ? 1 : undefined,
          }}
        />
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            color: "rgba(255,255,255,0.5)",
            fontWeight: 500,
          }}
        >
          {session.name}
        </span>
        <div style={{ flex: 1 }} />
        {isDone ? (
          <div
            style={{
              transform: `scale(${checkScale})`,
              width: 16,
              height: 16,
              borderRadius: "50%",
              backgroundColor: session.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 8l3 3 5-5"
                stroke="#000"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        ) : (
          <div
            style={{
              width: 12,
              height: 12,
              border: `2px solid ${session.color}`,
              borderTopColor: "transparent",
              borderRadius: "50%",
            }}
          />
        )}
      </div>

      {/* Terminal content */}
      <div
        style={{
          padding: "10px 14px",
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          fontSize: 11,
          lineHeight: 1.7,
          height: 172,
          overflow: "hidden",
        }}
      >
        {session.files.slice(0, visibleLines).map((file, i) => {
          const lineDelay = delay + 5 + i * 12;
          const lineOpacity = interpolate(
            localFrame,
            [lineDelay, lineDelay + 4],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          const op = TERMINAL_OPS[i % TERMINAL_OPS.length];
          const opColor =
            op === "modify"
              ? "#E0AF68"
              : op === "create"
                ? "#4ECA64"
                : op === "test"
                  ? "#64B5F6"
                  : "#C084FC";

          return (
            <div
              key={i}
              style={{
                opacity: lineOpacity,
                display: "flex",
                gap: 8,
              }}
            >
              <span style={{ color: opColor, minWidth: 48 }}>{op}</span>
              <span style={{ color: "rgba(255,255,255,0.6)" }}>{file}</span>
            </div>
          );
        })}

        {/* Cursor */}
        {!isDone && visibleLines > 0 && (
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <span style={{ width: 48 }} />
            {cursorVisible && (
              <div
                style={{
                  width: 6,
                  height: 13,
                  backgroundColor: session.color,
                  opacity: 0.7,
                }}
              />
            )}
          </div>
        )}

        {/* Done summary */}
        {isDone && (
          <div
            style={{
              marginTop: 8,
              opacity: interpolate(
                localFrame,
                [session.doneAt + delay + 3, session.doneAt + delay + 12],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              ),
            }}
          >
            <span style={{ color: session.color }}>
              {"\u2713"} {session.files.length} files modified
            </span>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 3,
          backgroundColor: "rgba(255,255,255,0.05)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            backgroundColor: session.color,
            opacity: isDone ? 1 : 0.6,
            boxShadow: isDone ? "none" : `0 0 8px ${session.color}`,
          }}
        />
      </div>
    </div>
  );
}

export const ParallelSessions = ({
  beats,
  fps,
}: {
  beats: Beat[];
  fps: number;
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame;
  const totalFrames = 8 * fps;

  // Fade out at end
  const fadeOut = interpolate(
    localFrame,
    [totalFrames - 20, totalFrames - 4],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Central orchestrator node
  const orchestratorSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 15, stiffness: 80 },
  });
  const orchScale = interpolate(orchestratorSpring, [0, 1], [0, 1]);
  const orchOpacity = interpolate(orchestratorSpring, [0, 1], [0, 1]);

  // Connection lines from center to panels
  const lineProgress = interpolate(localFrame, [10, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Panel positions (2x2 grid centered)
  const panelPositions = [
    { x: -210, y: -145 }, // top-left
    { x: 210, y: -145 }, // top-right
    { x: -210, y: 145 }, // bottom-left
    { x: 210, y: 145 }, // bottom-right
  ];

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#0a0a0a",
        opacity: fadeOut,
      }}
    >
      {/* Subtle background grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.03,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)
          `,
          backgroundSize: "50px 50px",
        }}
      />

      {/* Connection lines SVG */}
      <svg
        width="100%"
        height="100%"
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        {panelPositions.map((pos, i) => {
          const cx = 960;
          const cy = 540;
          const tx = cx + pos.x;
          const ty = cy + pos.y;
          const lineLen = Math.sqrt(pos.x ** 2 + pos.y ** 2);
          const dashOffset = lineLen * (1 - lineProgress);
          const session = SESSIONS[i];

          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={tx}
              y2={ty}
              stroke={session.color}
              strokeWidth="1.5"
              strokeDasharray={lineLen}
              strokeDashoffset={dashOffset}
              opacity={0.15}
            />
          );
        })}

        {/* Flowing dots along lines */}
        {panelPositions.map((pos, i) => {
          const cx = 960;
          const cy = 540;
          const session = SESSIONS[i];
          const dotDelay = 20 + i * 8;
          const dotPos = interpolate(
            localFrame,
            [dotDelay, dotDelay + 30],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          if (localFrame < dotDelay) return null;

          return (
            <circle
              key={`dot-${i}`}
              cx={cx + pos.x * dotPos}
              cy={cy + pos.y * dotPos}
              r="3"
              fill={session.color}
              opacity={0.5}
            />
          );
        })}
      </svg>

      {/* Central orchestrator */}
      <div
        style={{
          position: "absolute",
          opacity: orchOpacity,
          transform: `scale(${orchScale})`,
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow:
              "0 4px 20px rgba(99, 102, 241, 0.3), 0 0 40px rgba(99, 102, 241, 0.1)",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
              fill="white"
              opacity="0.9"
            />
          </svg>
        </div>
      </div>

      {/* "4 parallel sessions" label */}
      <div
        style={{
          position: "absolute",
          top: 60,
          opacity: interpolate(localFrame, [10, 25], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <span
          style={{
            fontFamily: "sans-serif",
            fontSize: 14,
            color: "rgba(255,255,255,0.25)",
            letterSpacing: 4,
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          4 parallel sessions
        </span>
      </div>

      {/* Session panels */}
      <div
        style={{
          position: "relative",
          width: 800,
          height: 540,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          gap: 20,
        }}
      >
        {SESSIONS.map((session, i) => (
          <MiniTerminal
            key={session.id}
            session={session}
            localFrame={localFrame}
            fps={fps}
            delay={i * 8 + 5}
          />
        ))}
      </div>

      {/* "Not a session manager. An orchestrator." text */}
      <div
        style={{
          position: "absolute",
          bottom: 50,
          opacity: interpolate(localFrame, [totalFrames - 50, totalFrames - 35], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <span
          style={{
            fontFamily: "sans-serif",
            fontSize: 16,
            color: "rgba(255,255,255,0.35)",
            letterSpacing: 2,
            fontWeight: 400,
          }}
        >
          Not a session manager. An orchestrator.
        </span>
      </div>
    </AbsoluteFill>
  );
};
