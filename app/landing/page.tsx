'use client';

import { useTrail, useSpring, animated } from '@react-spring/web';
import { useEffect, useRef, useState } from 'react';
import { Nunito } from 'next/font/google';
import { motion, useScroll, useTransform } from 'framer-motion';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import Marquee from '@/components/landing/Marquee';
import ScrollReveal from '@/components/landing/ScrollReveal';
import styles from './landing.module.css';

const BasedOrb = dynamic(() => import('@/components/landing/BasedOrb'), { ssr: false });

const nunito = Nunito({
  weight: ['300', '400', '600'],
  subsets: ['latin'],
  variable: '--font-ui',
});

const LINES = ['I AM YOUR', 'PERSONAL', 'ASSISTANT AI'];

const CARDS = [
  {
    label: '01',
    title: 'Knows you',
    body: 'Based remembers every project, every decision, every preference — across every session. No briefing. No repeating yourself.',
  },
  {
    label: '02',
    title: 'Builds for you',
    body: 'Describe what you want. Based writes the code and shows you the result live. Ship faster than you can context-switch.',
  },
  {
    label: '03',
    title: 'Stays with you',
    body: "Most AI answers and moves on. Based stays in the room — invested in what you're building, not just the last message.",
  },
];

export default function LandingPage() {
  const [ready, setReady] = useState(false);
  const stickyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 80);
    return () => clearTimeout(t);
  }, []);

  // ── Scroll-driven opacity for sticky quote ──────────────────
  const { scrollYProgress } = useScroll({
    target: stickyRef,
    offset: ['start start', 'end end'],
  });
  const quoteOpacity = useTransform(scrollYProgress, [0, 0.25, 0.75, 1], [0, 1, 1, 0]);
  const quoteY = useTransform(scrollYProgress, [0, 0.25, 0.75, 1], [32, 0, 0, -32]);

  // ── Entrance springs (react-spring) ────────────────────────
  const navSpring = useSpring({
    from: { opacity: 0, y: -14 },
    to: { opacity: ready ? 1 : 0, y: ready ? 0 : -14 },
    config: { tension: 210, friction: 26 },
    delay: 80,
  });

  const trail = useTrail(LINES.length, {
    from: { opacity: 0, y: 80 },
    to: { opacity: ready ? 1 : 0, y: ready ? 0 : 80 },
    config: { tension: 160, friction: 32 },
    delay: 300,
  });

  const decoSpring = useSpring({
    from: { opacity: 0 },
    to: { opacity: ready ? 1 : 0 },
    config: { tension: 120, friction: 30 },
    delay: 860,
  });

  const orbSpring = useSpring({
    from: { opacity: 0, scale: 0.88 },
    to: { opacity: ready ? 1 : 0, scale: ready ? 1 : 0.88 },
    config: { tension: 100, friction: 30 },
    delay: 600,
  });

  return (
    <main className={`${nunito.variable} ${styles.root}`}>
      {/* ── MOBILE GATE — hidden on desktop ──────────────────── */}
      <div className={styles.mobileGate}>
        <span className={styles.mobileGateMark}>⬡ based</span>
        <p className={styles.mobileGateMsg}>This experience is built for desktop.</p>
        <Link href="/" className={styles.mobileGateBtn}>
          Open Based&nbsp;&#8594;
        </Link>
      </div>

      {/* ── DESKTOP CONTENT — hidden on mobile ───────────────── */}
      <div className={styles.desktopOnly}>
        {/* ── NAV ──────────────────────────────────────────────── */}
        <animated.nav className={styles.nav} style={navSpring}>
          <button className={styles.navBtn}>Menu</button>
          <span className={styles.wordmark}>&#x2B21; based</span>
          <Link href="/" className={styles.navCta}>
            Try Based&nbsp;&#8594;
          </Link>
        </animated.nav>

        {/* ── HERO ─────────────────────────────────────────────── */}
        <section className={styles.hero}>
          {/* Kling loop video — compress to <2MB before deploying (see below) */}
          <video className={styles.videoBg} autoPlay muted loop playsInline aria-hidden="true">
            <source src="/videos/hero.webm" type="video/webm" />
            <source src="/videos/hero.mp4" type="video/mp4" />
          </video>

          <animated.div className={styles.orbWrap} style={orbSpring}>
            <BasedOrb />
          </animated.div>

          <div className={styles.headlineBlock}>
            {/* Editorial gold rule — fades in with deco spring */}
            <animated.div className={styles.heroRule} style={decoSpring} />

            {/* Scroll reveal handled by react-spring entrance; hover is CSS */}
            {trail.map((style, i) => (
              <div key={i} className={styles.lineWrap}>
                <animated.div className={styles.line} style={style}>
                  {LINES[i]}
                  {i === LINES.length - 1 && (
                    <span className={styles.squares}>
                      <span className={styles.square} />
                      <span className={styles.square} />
                    </span>
                  )}
                </animated.div>
              </div>
            ))}

            <animated.p className={styles.tagline} style={decoSpring}>
              The AI that stays.
            </animated.p>
            <animated.p className={styles.since} style={decoSpring}>
              Since&nbsp;&apos;24
            </animated.p>
          </div>

          <animated.div className={styles.lang} style={decoSpring}>
            EN&nbsp;|&nbsp;MY&nbsp;|&nbsp;JP
          </animated.div>
        </section>

        {/* ── MARQUEE ──────────────────────────────────────────── */}
        <Marquee speed={26} />

        {/* ── FEATURE CARDS (scroll reveal + hover) ────────────── */}
        <section className={styles.cards}>
          {CARDS.map((card, i) => (
            <ScrollReveal key={card.label} delay={i * 0.12}>
              <motion.div
                className={styles.card}
                whileHover={{ y: -10, borderColor: 'rgba(201,168,124,0.5)' }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className={styles.cardLabel}>{card.label}</span>
                <h3 className={styles.cardTitle}>{card.title}</h3>
                <p className={styles.cardBody}>{card.body}</p>
              </motion.div>
            </ScrollReveal>
          ))}
        </section>

        {/* ── COMPANION CALLOUT ────────────────────────────────── */}
        <section className={styles.companionSection}>
          <ScrollReveal y={24}>
            <p className={styles.companionEyebrow}>Windows Desktop Companion</p>
            <h2 className={styles.companionHeadline}>ALWAYS THERE</h2>
            <p className={styles.companionSub}>
              Based floats above your desktop — so you never have to find it.
            </p>
            <p className={styles.companionBody}>
              The companion lives on top of every app you have open. Drag it anywhere, ask it
              anything — it sees your screen, knows your context, and picks up exactly where you
              left off. Not a tab. Not a shortcut. A presence.
            </p>
            <a
              href="https://github.com/Idnayfla/all-in-all-based/releases/download/v0.1.0/Based.Setup.0.1.0.exe"
              className={styles.companionDownloadBtn}
              download
            >
              Download for Windows&nbsp;&#8594;
            </a>
            <span className={styles.companionDownloadNote}>
              Free &middot; Windows 10/11 &middot; Sign in to Based first
            </span>
          </ScrollReveal>
        </section>

        {/* ── STICKY QUOTE ─────────────────────────────────────── */}
        <div ref={stickyRef} className={styles.stickyContainer}>
          <div className={styles.stickyInner}>
            <motion.blockquote
              className={styles.stickyQuote}
              style={{ opacity: quoteOpacity, y: quoteY }}
            >
              most AI answers you.
              <br />
              <em>based stays with you.</em>
            </motion.blockquote>
          </div>
        </div>

        {/* ── FINAL CTA (scroll reveal) ─────────────────────────── */}
        <section className={styles.ctaSection}>
          <ScrollReveal y={28}>
            <p className={styles.ctaEyebrow}>For builders who build alone.</p>
            <Link href="/" className={styles.ctaBtn}>
              Open Based&nbsp;&#8594;
            </Link>
          </ScrollReveal>
        </section>
      </div>
      {/* end desktopOnly */}
    </main>
  );
}
