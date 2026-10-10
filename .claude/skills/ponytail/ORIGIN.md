# Where these skills came from

    https://github.com/DietrichGebert/ponytail
    version 5.1.0
    commit  9b58c1ffb790c075ca32e70a89cf1d80588f4abf
    MIT, Dietrich Gebert — LICENSE beside this file

Installed as plain skills rather than as the Claude Code plugin, because the
plugin's two `/plugin` commands are interactive and its lifecycle hooks need
a plugin root this project does not provide. The skills themselves are the
whole of the behaviour; the hooks only switched it on automatically.

Reviewed before installing: no network calls, no eval, no base64, no reads of
anything secret. The one child process in the upstream hooks is
`git ls-files` with a fixed argument list, and those hooks are not installed
here in any case.

To update: re-clone the repository and copy `skills/*/SKILL.md` over these.
To remove: delete `.claude/skills/ponytail*`.
