# Based — Decision Log

Significant product, technical, and business decisions. Rationale preserved so future context is never lost.

---

## 2026-05-19 — Comprehensive panel upgrade before stable release

**Decision**: Upgrade all 7 panels (Chat, Editor, Preview, Video, Studio, Image, Notes) to professional-grade feature parity before promoting beta to stable.
**Rationale**: First impression of the stable product must justify the "all-in-one" positioning. Half-finished panels undermine trust.
**Rejected alternatives**: Ship stable with existing panels, iterate post-launch. Rejected because Notes/Video/Image were too incomplete to represent the brand.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Beta → Stable: milestone-gated, not date-gated

**Decision**: Promote `dev` → `main` only when QA release gate passes (2 clean weeks on beta), not on a fixed calendar date.
**Rationale**: A broken stable release is worse than a delayed one. User trust is harder to rebuild than a launch date is to reschedule.
**Rejected alternatives**: 3-month fixed date. Rejected — arbitrary timing doesn't reflect product readiness.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Agent system introduced

**Decision**: Define 8 senior agent roles (Architect, Product, Designer, Growth, QA, DevOps, Security, Chief of Staff) to specialise Claude's behaviour per domain.
**Rationale**: As the product matures, different problems need different expert lenses. A single generalist mode is insufficient for architecture decisions vs copy vs security audits.
**Rejected alternatives**: Single-mode generalist. Rejected — produces mediocre output across all domains.
**Owner**: Hus Alfyandi

---

## 2026-05-xx — Notes panel added (Phase 12)

**Decision**: Add Personal Notes as a first-class panel with rich text (Tiptap), drawing canvas, and Supabase cross-device sync.
**Rationale**: Users expressed need for a persistent workspace beyond generated projects. Notes with drawing fills a gap no competitor addresses in the same product.
**Rejected alternatives**: Third-party embed (Notion, etc.). Rejected — breaks the "all in one" experience.
**Owner**: Hus Alfyandi

---

## 2026-05-xx — Video AI commands via Claude Haiku

**Decision**: Replace regex pattern matching in Video Editor AI bar with real Claude Haiku inference via `/api/video-command`.
**Rationale**: Regex "AI" is a lie. If we call it AI, it must be AI. Haiku is fast and cheap enough for this use case.
**Rejected alternatives**: Keep regex, label it "smart commands". Rejected — brand integrity.
**Owner**: Hus Alfyandi

---

## 2026-05-xx — PDF export via pdf-lib, not browser print dialog

**Decision**: Use pdf-lib + html2canvas for PDF export instead of `window.print()`.
**Rationale**: Browser print dialog is not a download. Users expect a file. pdf-lib gives a real PDF with no browser chrome.
**Rejected alternatives**: `window.print()`. Rejected — poor UX, not a real export.
**Owner**: Hus Alfyandi
