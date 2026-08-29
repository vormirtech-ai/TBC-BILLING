# Project Skills

Skills installed for this repository. Claude Code picks these up automatically
from `.claude/skills/<name>/SKILL.md`.

## ui-ux-pro-max

UI/UX design intelligence with a searchable local dataset (styles, palettes,
font pairings, UX guidelines, icons, chart types, and 22 tech stacks).

- Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (v2.13.0, MIT)
- Requires Python 3.x (standard library only — no network calls, no dependencies).
- Search tool:

  ```bash
  python3 ".claude/skills/ui-ux-pro-max/scripts/search.py" "<query>" --domain ux
  python3 ".claude/skills/ui-ux-pro-max/scripts/search.py" "<query>" --design-system
  ```

  Run it from the repository root, or use the absolute path.

Local change from upstream: the `${CLAUDE_PLUGIN_ROOT}/...` script paths in
`SKILL.md` were rewritten to repo-relative paths, because this is installed as a
project skill rather than as a marketplace plugin.

The upstream repository also bundles six companion skills (`brand`, `design`,
`design-system`, `slides`, `ui-styling`, `banner-design`). They are not installed
here — only `ui-ux-pro-max` itself.

## 3d-animation-creator

Builds a scroll-driven video website from a video file: FFmpeg frame extraction,
canvas rendering, scroll-linked playback, annotation cards, specs count-ups.

- Source: https://github.com/sergeyramas/3d-animation-creator-skill
- Requires FFmpeg at build time.
