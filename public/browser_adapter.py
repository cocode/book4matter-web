"""Adapt only the CLI's blocking execution boundary; reuse its publishing body.

Pyodide cannot launch subprocesses. Turn build_print into an async function and
await its two run() calls, leaving every other statement and helper unchanged.
The checked transformation fails if that execution boundary changes upstream.
"""
import ast
import inspect
import json
from pathlib import Path
import bf.__main__ as engine
from book4matter_backend import dispatch


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
