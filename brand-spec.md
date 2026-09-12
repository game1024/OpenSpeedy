# OpenSpeedy — Brand Spec

Source of truth for the landing page. Every asset below is a real file in this
repo; nothing on the page is a redrawn silhouette or a hotlinked third party.

## 1. Assets

### Logo
| File | Size | Use |
|---|---|---|
| `assets/brand/logo-mark.png` | 495×495, transparent | Nav, section marks, favicon source |
| `assets/brand/logo-wordmark.png` | 1044×168, transparent | Lockup next to the mark |
| `assets/brand/logo-full.png` | 1044×681, transparent | **In library, not placed.** Stacked lockup — kept as the master asset for README / social / press. The page uses mark + wordmark side by side instead (nav, hero, footer). |

Origin: `E:\Github\release-app\openspeedy\库微标.png` (1280×1280 RGBA, already
had a correct alpha channel — no chroma keying was needed). Trimmed to content
and split at the empty band at original y 759–776.

**The wordmark is legible on dark** — verified composited on `#0E1526`. The
flame gradient (deep maroon shadow → gold → hot highlight) carries enough
luminance. No white plate required.

### Imagery
| File | Size | Use |
|---|---|---|
| `assets/hero/highway.webp` | 2400×775 | Full-bleed band below the hero |
| `assets/hero/flame-space.webp` | 1232×706 | Hook-API section background |
| `assets/hero/fire-cars.webp` | 920×430 | **In library, not placed.** Held back deliberately: the page already runs two artwork-environment sections (highway band, hook API) and a third would tip from "branded" into "wallpapered". The download section reads better clean. |
| `assets/hero/promo-small.webp` | 462×174 | OG image / small promo |

### UI screenshots — 1216×816 WebP
12 files, a complete 2×2×3 matrix:

```
assets/shots/{dark|light}-{home|settings|about}-{zh|en}.webp
```

The matrix lines up exactly with the two controls in the screenshot viewer
(app theme × page language), so every combination the user can select has a
real capture behind it.

> ⚠️ **Captures show v3.3.6.** They predate the v3.3.10 process-list changes
> (name-grouped default, system-process toggle). Not corrected digitally.

## 2. Color

Sampled from the artwork (`magick -colors 8 -unique-colors`), not invented.
Source values: `#0D111B` `#151D2D` `#27314A` from the space scene;
`#691E0A` `#9D260D` `#C73415` `#E95F11` `#F6A430` `#F7AD3B` `#FCDE94` from the
flame mark.

```
--ink-950  #070A12   page deepest
--ink-900  #0D111B   page background        ← sampled
--ink-850  #121826   raised surface
--ink-800  #151D2D   card / panel           ← sampled
--ink-700  #27314A   hairline, hover        ← sampled
--ink-600  #39434D   muted chrome

--flame-800 #691E0A  ← sampled
--flame-700 #9D260D  ← sampled
--flame-600 #C73415  ← sampled
--flame-500 #E95F11  ← sampled   PRIMARY
--flame-400 #F6A430  ← sampled
--flame-300 #F7AD3B  ← sampled
--flame-100 #FCDE94  ← sampled   hot highlight

--text-hi  #F2F5FA
--text-mid #A8B2C4
--text-lo  #6C7788
```

**Cool tones are confined to the artwork.** The space image contains cyan
nebula and the screenshots contain indigo UI chrome; neither leaks into the
page chrome. The page carries exactly one hue family — fire.

## 3. Typography

| Role | Family | Notes |
|---|---|---|
| Display | Archivo 800/900 + italic | Wide weight range; the italic echoes the logo's slant |
| Body | Barlow 400/500/600 | Slightly condensed grotesque, pairs with Archivo |
| Mono | JetBrains Mono 400/500/700 | API names, tags, counters, code |
| CJK | `PingFang SC, Microsoft YaHei, Noto Sans SC` | System stack — no 5 MB webfont for Chinese |

Latin families via Google Fonts. CJK deliberately falls through to the system
stack: a Chinese reader expects their own platform face, and the webfont cost
is not worth it.

## 4. Form

- **Spacing** 8pt base — 4 8 12 16 24 32 48 64 96 128
- **Radius** `4px` chips/technical · `8px` buttons & inputs · `16px` media frames
  (no pill soup; large radii only where the object is genuinely media)
- **Elevation** fire glow instead of grey shadow —
  `0 0 0 1px rgb(233 95 17 / .28), 0 20px 60px -20px rgb(233 95 17 / .45)`
  over deep ambient `0 30px 80px -30px rgb(0 0 0 / .9)`
- **Hairlines** `1px solid rgb(255 255 255 / .07)`

## 5. Motion

| Effect | Spec |
|---|---|
| Scroll reveal | 600ms `cubic-bezier(.22,1,.36,1)`, `translateY(24px)→0`, 60ms stagger |
| Hero parallax | glow + screenshot translate on scroll, ≤ 24px |
| Embers | canvas, ~40 particles, drifting up; pauses off-screen |
| Counters | 1200ms ease-out on the live stats |
| Viewer swap | 300ms crossfade + 8px lift |
| Nav | backdrop-blur + hairline appears past 40px |

`prefers-reduced-motion: reduce` disables embers, parallax, counters and
reveals — everything lands in its final state immediately.

## 6. Anti-patterns — explicitly rejected

These were all present in the previous page and are banned here:

- cyan→purple neon on `#0D1117`
- emoji as icons (⚡🎨🖥️🔒🌍🆓⌨️📊) → replaced with a hand-built 1.5px-stroke line set
- purple→pink→blue gradients
- Inter / Roboto / system-ui as the display face
- fabricated statistics → live GitHub API only, and the row hides on failure
- rounded card + colored left-border
