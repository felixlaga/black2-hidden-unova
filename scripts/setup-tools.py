#!/usr/bin/env python3
"""Restore the pinned editor without replacing existing checkouts or dependencies."""

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def run(*args, cwd=ROOT, capture=False):
    result = subprocess.run(args, cwd=cwd, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def local_path(relative):
    path = ROOT / relative
    if Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ValueError(f"Expected a project-local path: {relative}")
    if any(part.is_symlink() for part in [path, *path.parents] if part != ROOT and ROOT in part.parents):
        raise ValueError(f"Refusing a symlinked path: {relative}")
    return path


def validate_checkout(editor, source, commit):
    if not (editor / ".git").exists():
        raise ValueError(f"Existing directory is not an editor Git checkout: {editor}")
    top = Path(run("git", "rev-parse", "--show-toplevel", cwd=editor, capture=True))
    if top.resolve() != editor.resolve():
        raise ValueError("Refusing a directory inside another Git checkout")
    origin = run("git", "remote", "get-url", "origin", cwd=editor, capture=True)
    if origin.removesuffix(".git").rstrip("/") != source.removesuffix(".git").rstrip("/"):
        raise ValueError("Existing editor origin does not match toolchain-lock.json")
    if run("git", "rev-parse", "HEAD", cwd=editor, capture=True) != commit:
        raise ValueError("Existing editor commit does not match toolchain-lock.json")
    if run("git", "--no-optional-locks", "status", "--porcelain", "--untracked-files=all", cwd=editor, capture=True):
        raise ValueError("Existing editor has local changes; leaving it untouched")
    if not (editor / "package-lock.json").is_file():
        raise ValueError("Pinned editor has no package-lock.json")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="Validate existing checkout and dependency executables without writing files")
    args = parser.parse_args()
    for command in ("git", "node", "npm"):
        if shutil.which(command) is None:
            raise ValueError(f"Required command is missing: {command}")
    lock = json.loads((ROOT / "toolchain-lock.json").read_text())["editor"]
    source, commit = lock["source"], lock["commit"]
    if not source.startswith("https://") or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Editor lock must contain an HTTPS source and full commit SHA")
    if lock["directory"] != "vendor/pokeweb-serverless":
        raise ValueError("Unexpected editor directory in toolchain-lock.json")
    editor = local_path(lock["directory"])
    cache = local_path(".cache/npm")
    local_path(f"{lock['directory']}/node_modules")
    if not editor.exists():
        if args.check:
            raise ValueError("Editor is missing; run npm run setup:tools first")
        editor.mkdir(parents=True)
        # A failed fetch is left in place for inspection; nothing is removed.
        run("git", "init", str(editor))
        run("git", "remote", "add", "origin", source, cwd=editor)
        run("git", "fetch", "--depth", "1", "origin", commit, cwd=editor)
        run("git", "checkout", "--detach", commit, cwd=editor)
    validate_checkout(editor, source, commit)
    if args.check:
        for executable in ("vite", "vite-node"):
            if not (editor / "node_modules" / ".bin" / executable).is_file():
                raise ValueError(f"Editor dependency executable is missing: {executable}")
        print(f"Pinned editor and dependency executables verified: {commit}")
        return
    if (editor / "node_modules").exists():
        raise ValueError("Existing node_modules is preserved. Use npm run setup:tools -- --check "
                         "to validate it, or bootstrap in a fresh clone.")
    cache.mkdir(parents=True, exist_ok=True)
    run("npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund",
        "--cache", str(cache), cwd=editor)
    print(f"Editor ready at {commit}. Run npm run dev.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"setup-tools: {error}", file=sys.stderr)
        sys.exit(1)
