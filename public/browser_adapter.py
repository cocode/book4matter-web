"""Browser-only file discovery and async execution for the pinned CLI engine."""
import ast
import base64
import html
import inspect
import json
import re
from pathlib import Path

import yaml
import bf.__main__ as engine
from book4matter_backend import dispatch


def literal_print_text(text):
    """Keep TXT prose opaque to Markdown and the book's Lua token filters."""
    fence = "`" * max(3, 1 + max((len(m[0]) for m in re.finditer(r"`+", text)), default=0))
    paragraphs = re.split(r"\n\s*\n", text.replace("\r\n", "\n"))
    return "\n\n".join(
        f'{fence}{{=typst}}\n#text({engine.typst_str(paragraph)})#parbreak()\n{fence}'
        for paragraph in paragraphs if paragraph.strip())


def literal_reflow_text(text):
    # Raw HTML also works in EPUB. It protects literal tracked/index tokens,
    # which entity-escaped Markdown would expose again before the Lua filters.
    fence = "`" * max(3, 1 + max((len(m[0]) for m in re.finditer(r"`+", text)), default=0))
    return "\n\n".join(
        f'{fence}{{=html}}\n<p style="white-space: pre-wrap">{html.escape(p)}</p>\n{fence}'
        for p in re.split(r"\n\s*\n", text.replace("\r\n", "\n")) if p.strip())


async def browser_run(cmd, **kwargs):
    await dispatch(json.dumps({
        "argv": [str(arg) for arg in cmd],
        "env": {key: value for key, value in kwargs.get("env", {}).items()
                if key.startswith("BF_")},
    }))


class AwaitCommands(ast.NodeTransformer):
    def __init__(self, names):
        self.names = names
        self.count = 0

    def visit_Call(self, node):
        self.generic_visit(node)
        if isinstance(node.func, ast.Name) and node.func.id in self.names:
            self.count += 1
            if node.func.id == "run":
                node.func.id = "browser_run"
            return ast.copy_location(ast.Await(value=node), node)
        return node


def make_async(name, calls, count):
    tree = ast.parse(inspect.getsource(getattr(engine, name)))
    original = tree.body[0]
    adapter = AwaitCommands(calls)
    adapter.visit(original)
    assert adapter.count == count, f"{name} execution boundary changed; review adapter"
    tree.body[0] = ast.AsyncFunctionDef(
        name=original.name, args=original.args, body=original.body,
        decorator_list=[], returns=original.returns, type_comment=None,
        type_params=getattr(original, "type_params", []),
    )
    ast.fix_missing_locations(tree)
    exec(compile(tree, f"<browser {name} adapter>", "exec"), engine.__dict__)


engine.browser_run = browser_run
make_async("build_print", {"run"}, 2)
make_async("run_chapter_pandoc", {"run"}, 1)
make_async("build_html", {"run_chapter_pandoc"}, 1)
make_async("build_epub", {"run_chapter_pandoc", "run"}, 2)


def discover_project(root):
    """Read optional configs anywhere, retaining the uploaded directory tree."""
    files = sorted(p for p in root.rglob("*") if p.is_file())
    cfg = {}
    config_dirs = [root]
    for name in ("book_style.yaml", "book_metadata.yaml"):
        matches = [p for p in files if p.name == name]
        if len(matches) > 1:
            raise ValueError(f"More than one {name} was added. Remove the extra copy.")
        if matches:
            path = matches[0]
            values = yaml.safe_load(path.read_text()) or {}
            if not isinstance(values, dict):
                raise ValueError(f"{name} must contain YAML settings (key: value).")
            cfg.update(values)
            config_dirs.insert(0, path.parent)

    def resolve(reference):
        reference = str(reference)
        for directory in config_dirs:
            candidate = (directory / reference).resolve()
            if candidate.is_relative_to(root) and candidate in files:
                return candidate
        # Loose file picks do not expose their original directory. Accept an
        # unambiguous filename from a YAML path such as media/cover.png.
        matches = [p for p in files if p.name == Path(reference).name]
        if len(matches) == 1:
            return matches[0]
        raise ValueError(f"Cannot find a unique uploaded file for {reference!r}.")

    for key in ("cover", "html-body-end"):
        if cfg.get(key):
            cfg[key] = str(resolve(cfg[key]).relative_to(root))
    chapter_dir = root / "chapters"
    def is_chapter(path):
        return path.suffix.lower() in (".md", ".txt") and (
            not chapter_dir.is_dir() or path.is_relative_to(chapter_dir))

    # The upload is authoritative, including when settings still contain a CLI
    # chapters list referring to a different local directory structure.
    chapters = [p for p in files if is_chapter(p)]
    chapters.sort(key=lambda p: (engine._natural_key(p), str(p)))
    if not chapters:
        raise ValueError("Add at least one .md or .txt chapter (inside chapters/ if that folder is present).")
    return cfg, chapters, files


async def build_project(bookdir, format="print"):
    root = Path(bookdir).resolve()
    cfg, chapters, files = discover_project(root)
    slug = engine.slugify(cfg["title"]) if cfg.get("title") else root.name
    extension = {"print": "-interior.pdf", "screen": ".pdf", "html": ".html", "epub": ".epub"}.get(format)
    if extension is None:
        raise ValueError(f"Unknown output format: {format}")
    target = root / "out" / (slug + extension)
    engine.load_config = lambda _: dict(cfg)
    engine.resolve_chapters = lambda *_: chapters
    engine.plain_text_markdown = literal_print_text if format in ("print", "screen") else literal_reflow_text
    # Used by the browser's image filter, including when PDF chapters have been
    # rewritten into temporary files by the original publishing engine.
    engine.os.environ["BF_WEB_FILES"] = json.dumps([str(p) for p in files])
    engine.os.environ["BF_WEB_ROOT"] = str(root)
    engine.os.environ["BF_WEB_CHAPTER_DIRS"] = json.dumps(list(dict.fromkeys(str(p.parent) for p in chapters)))
    if format in ("print", "screen"):
        await engine.build_print(root, keep=True, links="print" if format == "print" else "live",
                                 include_cover=format == "screen")
    elif format == "epub":
        # epubcheck is a native Java tool; the WASM writer and engine's ZIP /
        # navigation validation run here without a subprocess.
        await engine.build_epub(root, check=False)
    elif format == "html":
        await engine.build_html(root)
        # The CLI links an optional neighboring stylesheet. Browser downloads
        # must be self-contained, so inline it when supplied, otherwise omit it.
        styles = [p for p in files if p.name == "book_style.css"]
        if len(styles) > 1:
            raise ValueError("More than one book_style.css was added.")
        link = '  <link rel="stylesheet" href="book_style.css" />\n'
        replacement = ""
        if styles:
            data = base64.b64encode(styles[0].read_bytes()).decode("ascii")
            replacement = f'<link rel="stylesheet" href="data:text/css;base64,{data}" />\n'
        target.write_text(target.read_text().replace(link, replacement))
    return str(target)
