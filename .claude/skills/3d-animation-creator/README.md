# 3D Animation Creator — Claude Code Skill for Apple-Style Scroll Animation

> A **Claude Code skill** that takes any `.mp4` video file, extracts frames via FFmpeg, and builds a production-quality Apple-style scroll animation website — complete with canvas-based scroll-driven video, animated starscape, snap-stop annotation cards, count-up specs, and glassmorphism feature cards.

**Claude Code skill** | Works with: Claude Code · Codex CLI

<!-- ENGLISH -->

## What it does

Give this **AI agent** skill a video file (`.mp4`, `.mov`, `.webm`) and it builds a full Apple-style website where video playback is controlled by scroll position — the same effect Apple uses for iPhone and MacBook teardown pages. The **GSAP**-quality scroll animation is achieved with pure vanilla JS, FFmpeg frame extraction, and canvas-based rendering. You get a complete, deployable website in one session.

**Before:** You have a product demo video and no idea how to build a scroll-driven animation site.  
**After:** A production-ready website with scroll-stop animation, annotation cards, animated starscape, glassmorphism cards, and full mobile responsiveness — served locally and ready to deploy.

## Requirements

- **Agent:** Claude Code (primary) | Codex CLI
- **Tools / MCPs:** Bash (FFmpeg), WebFetch (optional, for content sourcing)
- **System tools:** FFmpeg (`brew install ffmpeg` on macOS)
- **Accounts / API keys:** none
- **OS:** macOS / Linux

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/sergeyramas/3d-animation-creator-skill/main/install.sh | bash
```

Or manually:
```bash
git clone https://github.com/sergeyramas/3d-animation-creator-skill ~/.claude/skills/3d-animation-creator
```

Restart Claude Code / Codex after install.

## Usage

Tell your agent one of these trigger phrases:

- "3D animation website"
- "scroll-stop build"
- "Apple-style scroll animation"
- "video on scroll"
- "build scroll animation site"
- "привяжи видео к скроллу"

## How it works

1. **Interview** — the skill asks for brand name, accent color, background, vibe, and content source (URL or paste)
2. **Frame extraction** — FFmpeg extracts 60–150 JPEG frames from your video, tuned for smooth scroll playback
3. **Site build** — a single HTML file is generated with: animated starscape canvas, full-screen loader, scroll-progress bar, navbar-to-pill transform, sticky canvas scroll animation with snap-stop annotation cards, count-up specs section, glassmorphism feature cards, and CTA
4. **Preview** — served instantly via `python3 -m http.server 8080`

The `references/sections-guide.md` file (bundled with the skill) contains complete implementation code for every section, so the agent always produces consistent, production-quality output.

---

<!-- RUSSIAN -->

## На русском

### Что делает

Скилл для **Claude Code** и **Codex CLI**: берёт видео файл (`.mp4`), извлекает кадры через **FFmpeg**, строит полноценный сайт в стиле **Apple** — где воспроизведение видео управляется скроллом. Эффект точь-в-точь как на страницах разборки iPhone или MacBook от Apple. Реализуется на чистом vanilla JS + canvas, без тяжёлых библиотек.

**До:** Есть видео с продуктом, нет идеи как сделать scroll-анимацию.  
**После:** Готовый сайт с canvas-скроллом, анотационными карточками с snap-stop, animated starscape, glassmorphism-картами и полной мобильной адаптацией.

### Установка

```bash
curl -fsSL https://raw.githubusercontent.com/sergeyramas/3d-animation-creator-skill/main/install.sh | bash
```

Перезапустить Claude Code / Codex после установки.

### Что входит в сайт

- Animated starscape (canvas, ~180 звёзд)
- Loader с лого и прогресс-баром
- Scroll progress bar (фиксированный, вверху)
- Navbar → pill-трансформ при скролле
- Sticky canvas с покадровой анимацией видео
- Annotation cards со snap-stop (scroll замирает на каждой карточке)
- Specs с count-up анимацией
- Glassmorphism feature cards
- CTA секция
- Опционально: testimonials, Three.js card scanner, confetti

### Триггер-фразы

- "3D анимация"
- "Apple-style scroll"
- "привяжи видео к скроллу"
- "scroll-stop сайт"
- "3D animation website"
- "build scroll animation site"

---

## Author

[@sergeyramas](https://github.com/sergeyramas) — I publish proven AI agent processes as reusable skills at [sergeyramas.vercel.app](https://sergeyramas.vercel.app).
