/**
 * Companion overlay layout — transparent body for Electron frameless window.
 *
 * The root layout sets a dark gradient background on <body>. That fills the
 * entire 380×580 Electron window with a solid dark rectangle, making the
 * border-radius on .companion-overlay-root invisible (sharp corners show).
 *
 * This layout injects a <style> that resets html/body to background:transparent
 * for this route only, so the rounded panel shape is the only visible element.
 */
export default function CompanionLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        html, body {
          background: transparent !important;
          overflow: hidden;
        }
      `}</style>
      {children}
    </>
  );
}
