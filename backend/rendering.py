"""Server-side content rendering helpers."""
from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from itertools import zip_longest
from pathlib import Path
from typing import Dict, Literal, Optional

from markdown import markdown
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import get_lexer_by_name, guess_lexer, guess_lexer_for_filename
from pygments.util import ClassNotFound

_MARKDOWN_EXTENSIONS = {".md", ".markdown"}
_FORMATTER = HtmlFormatter(nowrap=True, classprefix="tok-")
_CODE_BLOCK_RE = re.compile(r"<pre><code(?: class=\"language-([^\"]+)\")?>(.*?)</code></pre>", re.DOTALL)


@dataclass
class RenderResult:
    """Normalized rendering output."""

    mode: Literal["markdown", "code", "plain"]
    html: str
    metadata: Dict[str, str] = field(default_factory=dict)


def render_text_content(path: Path, content: str, enable_highlighting: bool = True) -> RenderResult:
    """Render text content based on file type."""

    suffix = path.suffix.lower()
    if suffix in _MARKDOWN_EXTENSIONS:
        return _render_markdown(content, enable_highlighting=enable_highlighting)

    if not enable_highlighting:
        return _render_plain(content)

    return _render_code(path, content)


def _render_code(path: Optional[Path], content: str) -> RenderResult:
    lexer = _select_lexer(path, content)
    if lexer is None or _is_plain_text_lexer(lexer):
        return _render_plain(content)

    highlighted = highlight(content, lexer, _FORMATTER)
    html_lines = _merge_lines(highlighted, content)
    return RenderResult(
        mode="code",
        html=_compose_code_lines(html_lines),
        metadata={"language": lexer.name.lower()},
    )


def _render_markdown(content: str, enable_highlighting: bool = True) -> RenderResult:
    body = markdown(content, extensions=["tables", "fenced_code"])
    if enable_highlighting:
        body = _CODE_BLOCK_RE.sub(_replace_markdown_code_block, body)
    else:
        body = _CODE_BLOCK_RE.sub(_replace_markdown_code_block_plain, body)
    return RenderResult(
        mode="markdown",
        html=f'<div class="md-content">{body}</div>',
        metadata={"language": "markdown"},
    )


def _replace_markdown_code_block(match: re.Match[str]) -> str:
    language_hint = match.group(1)
    raw_code = html.unescape(match.group(2))
    lexer = None

    if language_hint:
        try:
            lexer = get_lexer_by_name(language_hint)
        except ClassNotFound:
            lexer = None

    if lexer is None:
        lexer = _select_lexer(None, raw_code)

    if lexer is None:
        html_lines = [html.escape(line) for line in _split_lines(raw_code)]
        return (
            '<div class="code-container plain-code" data-language="TEXT">'
            f"{_compose_code_lines(html_lines)}</div>"
        )

    highlighted = highlight(raw_code, lexer, _FORMATTER)
    html_lines = _merge_lines(highlighted, raw_code)
    return (
        f'<div class="code-container code-block" data-language="{lexer.name.upper()}">'
        f"{_compose_code_lines(html_lines)}</div>"
    )


def _replace_markdown_code_block_plain(match: re.Match[str]) -> str:
    """Replace markdown code block with plain text (no syntax highlighting)."""
    raw_code = html.unescape(match.group(2))
    html_lines = [html.escape(line) for line in _split_lines(raw_code)]
    return (
        '<div class="code-container plain-code" data-language="TEXT">'
        f"{_compose_code_lines(html_lines)}</div>"
    )


def _render_plain(content: str) -> RenderResult:
    escaped = [html.escape(line) for line in _split_lines(content)]
    return RenderResult(
        mode="plain",
        html=_compose_code_lines(escaped),
        metadata={"language": "text"},
    )


def _select_lexer(path: Optional[Path], content: str):
    if path is not None:
        try:
            return guess_lexer_for_filename(path.name, content)
        except ClassNotFound:
            pass
    try:
        return guess_lexer(content)
    except ClassNotFound:
        return None


def _is_plain_text_lexer(lexer) -> bool:
    name = getattr(lexer, "name", "").lower()
    if name in {"text", "text only", "plain text"}:
        return True
    aliases = {alias.lower() for alias in getattr(lexer, "aliases", [])}
    return "text" in aliases or "plaintext" in aliases


def _merge_lines(highlighted: str, original: str) -> list[str]:
    highlight_lines = _split_lines(highlighted)
    raw_lines = _split_lines(original)
    merged: list[str] = []
    for highlighted_line, raw_line in zip_longest(highlight_lines, raw_lines, fillvalue=""):
        merged.append(highlighted_line if highlighted_line else html.escape(raw_line))
    return merged


def _compose_code_lines(values: list[str]) -> str:
    """Compose code lines using CSS counters for line numbers instead of DOM elements."""
    fragments: list[str] = []
    for value in values:
        safe = value if value else "&nbsp;"
        fragments.append(f'<div class="code-line"><span class="line-code">{safe}</span></div>')
    return "".join(fragments)


def _split_lines(text: str) -> list[str]:
    lines = text.splitlines()
    if text.endswith(("\n", "\r")) or not lines:
        lines.append("")
    return lines
