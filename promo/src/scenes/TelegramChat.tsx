import {
  useCurrentFrame,
  interpolate,
  AbsoluteFill,
  spring,
} from "remotion";

type Beat = { start: number; end: number };

const MESSAGES = [
  {
    sender: "bot",
    text: "Session 1: payment routes — done",
    type: "status",
  },
  {
    sender: "bot",
    text: "Session 2: auth patches — done",
    type: "status",
  },
  {
    sender: "bot",
    text: "Session 3: integration tests — running",
    type: "status",
  },
  {
    sender: "bot",
    text: "Session 4: rate limiter — blocked",
    type: "status",
  },
  {
    sender: "bot",
    text: "Rate limiter needs your Redis config. Port 6379 isn't reachable from staging.",
    type: "message",
  },
  {
    sender: "user",
    text: "staging-redis.internal:6380",
    type: "message",
  },
  {
    sender: "bot",
    text: "Got it. Session 4 resumed.",
    type: "message",
  },
  {
    sender: "bot",
    text: "All sessions merged. PR ready. I'll text you when the next batch is done.",
    type: "message",
  },
];

// Telegram color palette
const TG_BG = "#17212B";
const TG_HEADER = "#242F3D";
const TG_INPUT_BG = "#242F3D";
const TG_BUBBLE_BOT = "#182533";
const TG_BUBBLE_USER = "#2B5278";
const TG_TEXT_PRIMARY = "#F5F5F5";
const TG_TEXT_SECONDARY = "#708499";
const TG_ACCENT = "#64B5F6";
const TG_GREEN = "#4ECA64";

// Status colors
const STATUS_DONE = "#4ECA64";
const STATUS_ACTIVE = "#64B5F6";
const STATUS_BLOCKED = "#E86C60";

function BotAvatar({ size = 36 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg, #37AEE2 0%, #2B9AD6 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none">
        <path
          d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z"
          fill="white"
        />
      </svg>
    </div>
  );
}

function UserAvatar({ size = 36 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontSize: size * 0.45,
        color: "#fff",
        fontWeight: 600,
        fontFamily: "sans-serif",
      }}
    >
      Y
    </div>
  );
}

export const TelegramChat = ({
  beats,
  fps,
}: {
  beats: Beat[];
  fps: number;
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame;
  const totalFrames = 9 * fps;

  const messageInterval = totalFrames / (MESSAGES.length + 2);

  // Header animation
  const headerOpacity = interpolate(localFrame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

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
        backgroundColor: TG_BG,
      }}
    >
      {/* Phone frame */}
      <div
        style={{
          width: 460,
          height: 780,
          backgroundColor: TG_BG,
          borderRadius: 40,
          overflow: "hidden",
          boxShadow:
            "0 25px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)",
          position: "relative",
          opacity: fadeOut,
        }}
      >
        {/* Status bar */}
        <div
          style={{
            height: 44,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            padding: "0 28px 6px",
            backgroundColor: TG_HEADER,
            opacity: headerOpacity,
          }}
        >
          <span
            style={{
              fontFamily: "sans-serif",
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
            }}
          >
            9:41
          </span>
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <svg width="16" height="12" viewBox="0 0 16 12" fill="#fff">
              <rect x="0" y="6" width="3" height="6" rx="0.5" />
              <rect x="4.5" y="4" width="3" height="8" rx="0.5" />
              <rect x="9" y="2" width="3" height="10" rx="0.5" />
              <rect x="13.5" y="0" width="3" height="12" rx="0.5" opacity="0.3" />
            </svg>
            <svg width="16" height="12" viewBox="0 0 16 12" fill="#fff">
              <path
                d="M8 2.4C5.6 2.4 3.4 3.4 1.8 5l1.4 1.4C4.4 5.2 6.1 4.4 8 4.4s3.6.8 4.8 2l1.4-1.4C12.6 3.4 10.4 2.4 8 2.4zM8 6.4c-1.4 0-2.6.6-3.4 1.4L6 9.2c.5-.5 1.2-.8 2-.8s1.5.3 2 .8l1.4-1.4C10.6 7 9.4 6.4 8 6.4zM8 10.4c-.6 0-1 .4-1 1s.4 1 1 1 1-.4 1-1-.4-1-1-1z"
                fill="#fff"
              />
            </svg>
            <div
              style={{
                width: 24,
                height: 11,
                border: "1.5px solid rgba(255,255,255,0.5)",
                borderRadius: 3,
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 1.5,
                  top: 1.5,
                  bottom: 1.5,
                  width: 16,
                  backgroundColor: "#fff",
                  borderRadius: 1.5,
                }}
              />
            </div>
          </div>
        </div>

        {/* Chat header */}
        <div
          style={{
            height: 56,
            backgroundColor: TG_HEADER,
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            gap: 10,
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            opacity: headerOpacity,
          }}
        >
          {/* Back arrow */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            style={{ flexShrink: 0 }}
          >
            <path
              d="M15 18l-6-6 6-6"
              stroke={TG_ACCENT}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          <BotAvatar size={38} />

          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: "sans-serif",
                fontSize: 15,
                fontWeight: 600,
                color: "#fff",
                letterSpacing: -0.1,
              }}
            >
              Jules Dispatch
            </div>
            <div
              style={{
                fontFamily: "sans-serif",
                fontSize: 12,
                color: TG_GREEN,
                fontWeight: 400,
              }}
            >
              online
            </div>
          </div>

          {/* Menu dots */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill={TG_TEXT_SECONDARY}
            style={{ flexShrink: 0 }}
          >
            <circle cx="12" cy="6" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="18" r="2" />
          </svg>
        </div>

        {/* Chat messages area */}
        <div
          style={{
            height: 612,
            padding: "12px 14px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            background: `linear-gradient(180deg, ${TG_BG} 0%, #0E1621 100%)`,
          }}
        >
          {MESSAGES.map((msg, i) => {
            const msgFrame = (i + 2) * messageInterval;
            const msgOpacity = interpolate(
              localFrame,
              [msgFrame, msgFrame + 6],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }
            );
            const translateY = interpolate(
              localFrame,
              [msgFrame, msgFrame + 6],
              [16, 0],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }
            );

            if (localFrame < msgFrame) return null;

            const isUser = msg.sender === "user";
            const isStatus = msg.type === "status";

            if (isStatus) {
              // Status message - centered pill style
              return (
                <div
                  key={i}
                  style={{
                    opacity: msgOpacity,
                    transform: `translateY(${translateY}px)`,
                    display: "flex",
                    justifyContent: "center",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      backgroundColor: "rgba(0, 0, 0, 0.3)",
                      borderRadius: 16,
                      padding: "6px 14px",
                      fontFamily: "monospace",
                      fontSize: 12,
                      color: msg.text.includes("done")
                        ? STATUS_DONE
                        : msg.text.includes("blocked")
                          ? STATUS_BLOCKED
                          : STATUS_ACTIVE,
                      letterSpacing: 0.3,
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              );
            }

            // Regular message bubble
            return (
              <div
                key={i}
                style={{
                  opacity: msgOpacity,
                  transform: `translateY(${translateY}px)`,
                  display: "flex",
                  justifyContent: isUser ? "flex-end" : "flex-start",
                  marginBottom: 6,
                  alignItems: "flex-end",
                  gap: 8,
                }}
              >
                {!isUser && <BotAvatar size={30} />}
                <div style={{ maxWidth: "78%" }}>
                  <div
                    style={{
                      padding: "9px 14px",
                      borderRadius: isUser
                        ? "14px 14px 4px 14px"
                        : "14px 14px 14px 4px",
                      backgroundColor: isUser
                        ? TG_BUBBLE_USER
                        : TG_BUBBLE_BOT,
                      color: TG_TEXT_PRIMARY,
                      fontFamily: "sans-serif",
                      fontSize: 14.5,
                      lineHeight: 1.4,
                      position: "relative",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                    }}
                  >
                    {msg.text}
                    {/* Timestamp */}
                    <span
                      style={{
                        float: "right",
                        marginLeft: 12,
                        marginTop: 4,
                        fontSize: 11,
                        color: isUser
                          ? "rgba(255,255,255,0.45)"
                          : TG_TEXT_SECONDARY,
                        fontFamily: "sans-serif",
                      }}
                    >
                      {isUser ? "9:42" : "9:41"}
                      {isUser && (
                        <span style={{ marginLeft: 4, color: TG_ACCENT }}>
                          ✓✓
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                {isUser && <UserAvatar size={30} />}
              </div>
            );
          })}
        </div>

        {/* Input bar */}
        <div
          style={{
            height: 68,
            backgroundColor: TG_HEADER,
            display: "flex",
            alignItems: "center",
            padding: "0 10px",
            gap: 8,
            opacity: headerOpacity,
          }}
        >
          {/* Emoji button */}
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            style={{ flexShrink: 0 }}
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke={TG_TEXT_SECONDARY}
              strokeWidth="1.5"
            />
            <circle cx="9" cy="10" r="1.2" fill={TG_TEXT_SECONDARY} />
            <circle cx="15" cy="10" r="1.2" fill={TG_TEXT_SECONDARY} />
            <path
              d="M8.5 14.5C9.2 15.8 10.5 16.5 12 16.5s2.8-.7 3.5-2"
              stroke={TG_TEXT_SECONDARY}
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>

          {/* Text input field */}
          <div
            style={{
              flex: 1,
              height: 40,
              backgroundColor: "rgba(255,255,255,0.06)",
              borderRadius: 20,
              display: "flex",
              alignItems: "center",
              padding: "0 16px",
            }}
          >
            <span
              style={{
                fontFamily: "sans-serif",
                fontSize: 15,
                color: TG_TEXT_SECONDARY,
              }}
            >
              Message
            </span>
          </div>

          {/* Send button */}
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              backgroundColor: TG_ACCENT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12h14M12 5l7 7-7 7"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
