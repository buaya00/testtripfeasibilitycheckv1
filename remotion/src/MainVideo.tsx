import { AbsoluteFill, Img, staticFile, useCurrentFrame, interpolate, spring, useVideoConfig, Sequence } from "remotion";
import { TransitionSeries, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { wipe } from "@remotion/transitions/wipe";
import { loadFont } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadBodyFont } from "@remotion/google-fonts/Inter";

const { fontFamily: headingFont } = loadFont("normal", { weights: ["700", "800", "900"], subsets: ["latin"] });
const { fontFamily: bodyFont } = loadBodyFont("normal", { weights: ["400", "500", "600"], subsets: ["latin"] });

const NAVY = "#0f2449";
const NAVY_LIGHT = "#1a3a6e";
const GOLD = "#d4a024";
const WHITE = "#ffffff";

function GradientBg() {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame * 0.008) * 5;
  return (
    <AbsoluteFill>
      <div style={{
        width: "100%", height: "100%",
        background: `radial-gradient(ellipse at ${50 + drift}% ${40 + drift}%, ${NAVY_LIGHT} 0%, ${NAVY} 60%, #091428 100%)`,
      }} />
    </AbsoluteFill>
  );
}

function GoldLine({ y, delay }: { y: number; delay: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 60 });
  return (
    <div style={{
      position: "absolute", top: y, left: 0, width: `${progress * 100}%`, height: 2,
      background: `linear-gradient(90deg, transparent, ${GOLD}80, transparent)`,
    }} />
  );
}

// Scene 1: Logo reveal
function Scene1() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logoScale = spring({ frame, fps, config: { damping: 15, stiffness: 80 } });
  const logoOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  const tagOpacity = interpolate(frame, [30, 50], [0, 1], { extrapolateRight: "clamp" });
  const tagY = interpolate(frame, [30, 50], [30, 0], { extrapolateRight: "clamp" });
  const shimmer = interpolate(frame, [60, 90], [-200, 400], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <GradientBg />
      <GoldLine y={300} delay={10} />
      <GoldLine y={780} delay={20} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <div style={{ transform: `scale(${logoScale})`, opacity: logoOpacity }}>
          <Img src={staticFile("images/aeg-logo.png")} style={{ height: 600, width: "auto", filter: "brightness(1.4)" }} />
        </div>
        <div style={{
          opacity: tagOpacity, transform: `translateY(${tagY}px)`,
          fontFamily: headingFont, fontSize: 32, fontWeight: 700, color: GOLD,
          letterSpacing: 8, marginTop: 30, textTransform: "uppercase",
          overflow: "hidden", position: "relative",
        }}>
          International Flight Support
          <div style={{
            position: "absolute", top: 0, left: shimmer, width: 100, height: "100%",
            background: `linear-gradient(90deg, transparent, ${WHITE}40, transparent)`,
          }} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

// Scene 2: Global reach with globe
function Scene2() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const globeScale = spring({ frame, fps, config: { damping: 20, stiffness: 100 } });
  const globeRotate = interpolate(frame, [0, 120], [0, 15]);
  const textOpacity = interpolate(frame, [20, 40], [0, 1], { extrapolateRight: "clamp" });
  const textX = interpolate(frame, [20, 45], [-80, 0], { extrapolateRight: "clamp" });

  const services = [
    "Overflight & Landing Permits",
    "Ground Handling & Fuel",
    "Customs & eAPIS Filing",
    "Route Planning & NOTAMs",
  ];

  return (
    <AbsoluteFill>
      <GradientBg />
      {/* Globe */}
      <div style={{
        position: "absolute", right: 80, top: "50%", transform: `translateY(-50%) scale(${globeScale}) rotate(${globeRotate}deg)`,
      }}>
        <Img src={staticFile("images/globe-routes.png")} style={{ width: 600, height: 600, opacity: 0.7 }} />
      </div>
      {/* Text */}
      <div style={{
        position: "absolute", left: 120, top: "50%", transform: "translateY(-50%)",
        opacity: textOpacity,
      }}>
        <div style={{
          fontFamily: headingFont, fontSize: 56, fontWeight: 900, color: WHITE,
          lineHeight: 1.1, transform: `translateX(${textX}px)`,
        }}>
          Global Reach.<br />
          <span style={{ color: GOLD }}>Local Expertise.</span>
        </div>
        <div style={{ marginTop: 40 }}>
          {services.map((s, i) => {
            const sDelay = 35 + i * 12;
            const sOpacity = interpolate(frame, [sDelay, sDelay + 15], [0, 1], { extrapolateRight: "clamp" });
            const sX = interpolate(frame, [sDelay, sDelay + 15], [-40, 0], { extrapolateRight: "clamp" });
            return (
              <div key={i} style={{
                fontFamily: bodyFont, fontSize: 26, color: `${WHITE}cc`, fontWeight: 500,
                marginBottom: 14, display: "flex", alignItems: "center", gap: 14,
                opacity: sOpacity, transform: `translateX(${sX}px)`,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD, flexShrink: 0 }} />
                {s}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

// Scene 3: 24/7 Support
function Scene3() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const numScale = spring({ frame: frame - 5, fps, config: { damping: 12, stiffness: 150 } });
  const slashOpacity = interpolate(frame, [15, 30], [0, 1], { extrapolateRight: "clamp" });
  const subOpacity = interpolate(frame, [35, 55], [0, 1], { extrapolateRight: "clamp" });
  const subY = interpolate(frame, [35, 55], [20, 0], { extrapolateRight: "clamp" });
  const pulse = 1 + Math.sin(frame * 0.1) * 0.02;

  return (
    <AbsoluteFill>
      <GradientBg />
      <Img src={staticFile("images/bg-aviation.jpg")} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.3 }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{
            fontFamily: headingFont, fontSize: 220, fontWeight: 900, color: WHITE,
            transform: `scale(${numScale * pulse})`, display: "inline-block",
          }}>24</span>
          <span style={{
            fontFamily: headingFont, fontSize: 180, fontWeight: 700, color: GOLD,
            opacity: slashOpacity, display: "inline-block",
          }}>/</span>
          <span style={{
            fontFamily: headingFont, fontSize: 220, fontWeight: 900, color: WHITE,
            transform: `scale(${numScale * pulse})`, display: "inline-block",
          }}>7</span>
        </div>
        <div style={{
          fontFamily: headingFont, fontSize: 38, fontWeight: 700, color: `${WHITE}dd`,
          letterSpacing: 6, textTransform: "uppercase", marginTop: 10,
          opacity: subOpacity, transform: `translateY(${subY}px)`,
        }}>
          Worldwide Trip Support
        </div>
        <div style={{
          fontFamily: bodyFont, fontSize: 24, color: `${WHITE}99`, marginTop: 20,
          opacity: subOpacity,
        }}>
          Wherever you fly. Whenever you need us.
        </div>
      </div>
    </AbsoluteFill>
  );
}

// Scene 4: Services highlight
function Scene4() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const items = [
    { icon: "✈", text: "Flight Planning & Filing" },
    { icon: "🌍", text: "Permits & Regulatory Compliance" },
    { icon: "⛽", text: "Fuel & Ground Handling" },
    { icon: "📱", text: "Real-Time Mobile Access" },
  ];

  return (
    <AbsoluteFill>
      <GradientBg />
      <div style={{
        fontFamily: headingFont, fontSize: 48, fontWeight: 800, color: WHITE,
        position: "absolute", top: 120, left: 0, right: 0, textAlign: "center",
      }}>
        <span style={{ opacity: interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" }) }}>
          Comprehensive <span style={{ color: GOLD }}>Solutions</span>
        </span>
      </div>
      <div style={{
        display: "flex", gap: 40, justifyContent: "center", alignItems: "center",
        position: "absolute", top: 280, left: 80, right: 80,
      }}>
        {items.map((item, i) => {
          const d = 15 + i * 15;
          const s = spring({ frame: frame - d, fps, config: { damping: 15, stiffness: 120 } });
          return (
            <div key={i} style={{
              width: 360, padding: "50px 30px", borderRadius: 16,
              background: `linear-gradient(135deg, ${NAVY_LIGHT}80, ${NAVY}80)`,
              border: `1px solid ${GOLD}30`,
              transform: `scale(${s})`, opacity: s,
              display: "flex", flexDirection: "column", alignItems: "center", gap: 20,
            }}>
              <span style={{ fontSize: 56 }}>{item.icon}</span>
              <span style={{
                fontFamily: bodyFont, fontSize: 22, fontWeight: 600, color: WHITE,
                textAlign: "center",
              }}>{item.text}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

// Scene 5: CTA / closing
function Scene5() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logoScale = spring({ frame: frame - 5, fps, config: { damping: 20 } });
  const textOp = interpolate(frame, [15, 35], [0, 1], { extrapolateRight: "clamp" });
  const ctaOp = interpolate(frame, [40, 60], [0, 1], { extrapolateRight: "clamp" });
  const ctaScale = spring({ frame: frame - 40, fps, config: { damping: 12 } });
  const fadeOut = interpolate(frame, [80, 105], [1, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <GradientBg />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <div style={{ transform: `scale(${logoScale})` }}>
          <Img src={staticFile("images/aeg-logo.png")} style={{ height: 140, width: "auto" }} />
        </div>
        <div style={{
          fontFamily: headingFont, fontSize: 52, fontWeight: 800, color: WHITE,
          marginTop: 40, textAlign: "center", opacity: textOp,
        }}>
          Your Flight. <span style={{ color: GOLD }}>Our Mission.</span>
        </div>
        <div style={{
          fontFamily: bodyFont, fontSize: 26, color: `${WHITE}bb`, marginTop: 20, opacity: textOp,
        }}>
          Expertise you can count on — anywhere in the world.
        </div>
        <div style={{
          marginTop: 50, padding: "18px 60px", borderRadius: 50,
          background: `linear-gradient(135deg, ${GOLD}, #b8860b)`,
          fontFamily: headingFont, fontSize: 24, fontWeight: 700, color: NAVY,
          opacity: ctaOp, transform: `scale(${ctaScale})`,
          letterSpacing: 2, textTransform: "uppercase",
        }}>
          aegfuels.com/flightsupport
        </div>
      </div>
    </AbsoluteFill>
  );
}

export const MainVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: NAVY }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={100}>
          <Scene1 />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: 20 })}
        />
        <TransitionSeries.Sequence durationInFrames={120}>
          <Scene2 />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={wipe({ direction: "from-left" })}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: 20 })}
        />
        <TransitionSeries.Sequence durationInFrames={100}>
          <Scene3 />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: 20 })}
        />
        <TransitionSeries.Sequence durationInFrames={110}>
          <Scene4 />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: 20 })}
        />
        <TransitionSeries.Sequence durationInFrames={110}>
          <Scene5 />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
