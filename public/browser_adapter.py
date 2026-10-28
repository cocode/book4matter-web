"""Adapt the CLI's execution boundary and literal TXT handling for browser PDFs.

Pyodide cannot launch subprocesses. Turn build_print into an async function and
await its two run() calls, leaving its publishing body unchanged. Protect TXT
prose from Lua filters using escaped Typst text with explicit paragraph breaks.
The checked transformation fails if that execution boundary changes upstream.
"""
import ast
import inspect
import json
import re
from pathlib import Path
import bf.__main__ as engine
from book4matter_backend import dispatch


def literal_print_text(text):
    """Keep TXT prose opaque to Lua filters as well as Markdown parsing.

    Entity escaping protects Markdown syntax, but Pandoc decodes entities before
    tracked.lua runs. Raw Typst text preserves literal index/tracked tokens too.
    A fence longer than any in the input prevents text from closing the block.
    """
    fence = "`" * max(3, 1 + max((len(m[0]) for m in re.finditer(r"`+", text)), default=0))
    paragraphs = re.split(r"\n\s*\n", text.replace("\r\n", "\n"))
    return "\n\n".join(
        f'{fence}{{=typst}}\n#text({engine.typst_str(paragraph)})#parbreak()\n{fence}'
        for paragraph in paragraphs if paragraph.strip())


engine.plain_text_markdown = literal_print_text


async def browser_run(cmd, **kwargs):
    await dispatch(json.dumps({
        "argv": [str(arg) for arg in cmd],
        "env": {key: value for key, value in kwargs.get("env", {}).items()
                if key.startswith("BF_")},
    }))


class AwaitCommands(ast.NodeTransformer):
    count = 0

    def visit_Call(self, node):
        self.generic_visit(node)
        if isinstance(node.func, ast.Name) and node.func.id == "run":
            self.count += 1
            node.func.id = "browser_run"
            return ast.copy_location(ast.Await(value=node), node)
        return node


tree = ast.parse(inspect.getsource(engine.build_print))
original = tree.body[0]
adapter = AwaitCommands()
adapter.visit(original)
assert adapter.count == 2, "build_print execution boundary changed; review adapter"
tree.body[0] = ast.AsyncFunctionDef(
    name=original.name, args=original.args, body=original.body,
    decorator_list=[], returns=original.returns, type_comment=None,
    type_params=original.type_params,
)
ast.fix_missing_locations(tree)
engine.browser_run = browser_run
exec(compile(tree, "<browser build_print adapter>", "exec"), engine.__dict__)


async def build_project(bookdir):
    # keep=True exposes the exact generated source files for inspection.
    await engine.build_print(Path(bookdir), keep=True)
