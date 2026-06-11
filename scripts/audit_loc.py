#!/usr/bin/env python3
"""Read-only line-of-code audit for the QPMS_CRM repository."""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass, field
from pathlib import Path


EXCLUDED_DIRS = {
    ".git",
    ".dart_tool",
    ".gradle",
    ".idea",
    ".vscode",
    "build",
    "coverage",
    "dist",
    "node_modules",
}

EXCLUDED_FILE_SUFFIXES = {
    ".aab",
    ".apk",
    ".app",
    ".dll",
    ".dylib",
    ".exe",
    ".ico",
    ".jar",
    ".jpeg",
    ".jpg",
    ".lock",
    ".log",
    ".otf",
    ".pdf",
    ".png",
    ".so",
    ".webp",
    ".zip",
}

EXCLUDED_FILE_NAMES = {
    "package-lock.json",
    "pubspec.lock",
    "gradle-wrapper.jar",
}

GENERATED_NAME_PARTS = {
    ".g.",
    ".freezed.",
    "generated_plugin_registrant",
    "generated_plugins.cmake",
}

WEB_EXTS = {".js", ".jsx", ".ts", ".tsx", ".css", ".html"}
BACKEND_EXTS = {".js", ".ts"}
MOBILE_EXTS = {".dart", ".kt", ".kts", ".gradle", ".xml", ".yaml", ".yml"}
DATABASE_EXTS = {".sql"}
CONFIG_EXTS = {".json"}
TEST_NAME_PARTS = {"test", "spec"}


@dataclass
class Count:
    files: int = 0
    lines: int = 0
    blank: int = 0
    comments: int = 0
    code: int = 0

    def add(self, other: "Count") -> None:
        self.files += other.files
        self.lines += other.lines
        self.blank += other.blank
        self.comments += other.comments
        self.code += other.code


@dataclass
class Audit:
    root: Path
    scanned_files: int = 0
    excluded_files: int = 0
    categories: dict[str, Count] = field(default_factory=dict)
    folders: dict[str, Count] = field(default_factory=dict)
    largest: list[tuple[int, str, str]] = field(default_factory=list)
    excluded_dirs_seen: set[str] = field(default_factory=set)
    excluded_reasons: dict[str, int] = field(default_factory=dict)


def is_generated(path: Path) -> bool:
    lowered = path.name.lower()
    return any(part in lowered for part in GENERATED_NAME_PARTS)


def is_test_file(rel: Path) -> bool:
    parts = {part.lower() for part in rel.parts}
    stem = rel.stem.lower()
    return (
        "test" in parts
        or "tests" in parts
        or any(stem.endswith(f"_{part}") for part in TEST_NAME_PARTS)
        or any(stem.endswith(f".{part}") for part in TEST_NAME_PARTS)
    )


def is_handwritten_config(rel: Path) -> bool:
    if rel.suffix.lower() == ".json":
        return rel.name in {"package.json", "tsconfig.json", "jsconfig.json"}
    return rel.name in {
        "pubspec.yaml",
        "analysis_options.yaml",
        "vite.config.js",
        "eslint.config.js",
        "vercel.json",
        "AndroidManifest.xml",
        "build.gradle",
        "build.gradle.kts",
        "settings.gradle",
        "settings.gradle.kts",
        "gradle.properties",
    }


def category_for(rel: Path) -> str | None:
    suffix = rel.suffix.lower()
    parts = rel.parts
    lower_parts = [p.lower() for p in parts]

    if is_test_file(rel):
        if suffix in WEB_EXTS | BACKEND_EXTS | MOBILE_EXTS | DATABASE_EXTS:
            return "Tests"

    if suffix in DATABASE_EXTS:
        return "Database"

    if parts and parts[0] == "Mobile_FO_V2" and (
        suffix in MOBILE_EXTS or rel.name == "pubspec.yaml"
    ):
        return "Mobile Flutter"
    if parts and parts[0] == "Mobile" and (
        suffix in MOBILE_EXTS or rel.name == "pubspec.yaml"
    ):
        return "Mobile Flutter"

    if parts and parts[0] == "backend" and (
        suffix in BACKEND_EXTS or is_handwritten_config(rel)
    ):
        return "Backend"

    if suffix in WEB_EXTS:
        if "src" in lower_parts or rel.name in {
            "index.html",
            "vite.config.js",
            "eslint.config.js",
        }:
            return "Web Frontend"

    if rel.name == "package.json" and (not parts or parts[0] != "backend"):
        return "Web Frontend"

    return None


def folder_key(rel: Path) -> str:
    if len(rel.parts) <= 1:
        return "."
    if rel.parts[0] in {"Mobile", "Mobile_FO_V2"} and len(rel.parts) >= 2:
        return "/".join(rel.parts[:2])
    if rel.parts[0] in {"src", "backend", "database", "supabase"} and len(rel.parts) >= 2:
        return "/".join(rel.parts[:2])
    return rel.parts[0]


def excluded_reason(path: Path) -> str | None:
    suffix = path.suffix.lower()
    if path.name in EXCLUDED_FILE_NAMES:
        return "lock/generated dependency file"
    if suffix in EXCLUDED_FILE_SUFFIXES:
        return f"excluded suffix {suffix}"
    if is_generated(path):
        return "generated file"
    return None


def count_lines(path: Path) -> Count:
    suffix = path.suffix.lower()
    single_comment = {
        ".dart": "//",
        ".js": "//",
        ".jsx": "//",
        ".ts": "//",
        ".tsx": "//",
        ".kt": "//",
        ".kts": "//",
        ".java": "//",
        ".css": None,
        ".sql": "--",
        ".yaml": "#",
        ".yml": "#",
        ".json": None,
        ".html": None,
        ".xml": None,
    }.get(suffix)
    block_start, block_end = ("/*", "*/")
    html_like = suffix in {".html", ".xml"}
    in_block = False
    count = Count(files=1)

    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return count

    for raw_line in text.splitlines():
        count.lines += 1
        stripped = raw_line.strip()
        if not stripped:
            count.blank += 1
            continue

        is_comment = False
        if in_block:
            is_comment = True
            if block_end in stripped:
                in_block = False
        elif html_like and stripped.startswith("<!--"):
            is_comment = True
            if "-->" not in stripped:
                in_block = True
                block_end = "-->"
        elif stripped.startswith("/*"):
            is_comment = True
            if "*/" not in stripped:
                in_block = True
                block_end = "*/"
        elif single_comment and stripped.startswith(single_comment):
            is_comment = True

        if is_comment:
            count.comments += 1
        else:
            count.code += 1
    return count


def audit(root: Path) -> Audit:
    result = Audit(root=root)
    for current_root, dirnames, filenames in os.walk(root):
        current = Path(current_root)
        kept_dirs = []
        for dirname in dirnames:
            if dirname in EXCLUDED_DIRS:
                result.excluded_dirs_seen.add(str((current / dirname).relative_to(root)))
            else:
                kept_dirs.append(dirname)
        dirnames[:] = kept_dirs

        for filename in filenames:
            path = current / filename
            rel = path.relative_to(root)
            reason = excluded_reason(path)
            if reason:
                result.excluded_files += 1
                result.excluded_reasons[reason] = result.excluded_reasons.get(reason, 0) + 1
                continue

            category = category_for(rel)
            if category is None:
                result.excluded_files += 1
                result.excluded_reasons["outside counted scope"] = (
                    result.excluded_reasons.get("outside counted scope", 0) + 1
                )
                continue

            count = count_lines(path)
            result.scanned_files += 1
            result.categories.setdefault(category, Count()).add(count)
            result.folders.setdefault(folder_key(rel), Count()).add(count)
            result.largest.append((count.lines, str(rel).replace("\\", "/"), category))

    result.largest.sort(reverse=True)
    return result


def as_dict(result: Audit) -> dict[str, object]:
    def count_dict(count: Count) -> dict[str, int]:
        return {
            "files": count.files,
            "lines": count.lines,
            "blank": count.blank,
            "comments": count.comments,
            "code": count.code,
        }

    total = Count()
    for count in result.categories.values():
        total.add(count)

    return {
        "root": str(result.root),
        "total_repository_files_scanned": result.scanned_files,
        "total_files_excluded": result.excluded_files,
        "totals": count_dict(total),
        "categories": {
            key: count_dict(value)
            for key, value in sorted(result.categories.items())
        },
        "folders": {
            key: count_dict(value)
            for key, value in sorted(
                result.folders.items(), key=lambda item: item[1].lines, reverse=True
            )
        },
        "top_20_largest_files": [
            {"lines": lines, "path": path, "category": category}
            for lines, path, category in result.largest[:20]
        ],
        "excluded_dirs_seen": sorted(result.excluded_dirs_seen),
        "excluded_reasons": dict(sorted(result.excluded_reasons.items())),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".", help="Repository root")
    parser.add_argument("--json", action="store_true", help="Print JSON output")
    args = parser.parse_args()

    result = audit(Path(args.root).resolve())
    data = as_dict(result)
    if args.json:
        print(json.dumps(data, indent=2))
        return

    print(json.dumps(data, indent=2))


if __name__ == "__main__":
    main()
