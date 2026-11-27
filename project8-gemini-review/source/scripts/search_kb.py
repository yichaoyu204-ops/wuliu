"""Find exact, normalized keywords in project knowledge notes."""

import argparse
from pathlib import Path
import unicodedata


KNOWLEDGE = Path(__file__).resolve().parents[1] / "knowledge"


def normalize(text):
    return unicodedata.normalize("NFKC", text).casefold()


def search(terms, directory=KNOWLEDGE):
    """Yield (relative path, line number, original line) for every match."""
    words = normalize(" ".join(terms)).split()
    if not words:
        raise ValueError("请提供至少一个非空关键词。")
    for path in sorted(directory.rglob("*.md")):
        if not path.resolve().is_relative_to(directory.resolve()):
            continue
        lines = path.read_text(encoding="utf-8-sig").splitlines()
        for number, line in enumerate(lines, 1):
            normalized_line = normalize(line)
            if all(word in normalized_line for word in words):
                yield path.relative_to(directory).as_posix(), number, line.strip()


def main():
    parser = argparse.ArgumentParser(description="在项目知识库中按行检索，中英文均可。")
    parser.add_argument("terms", nargs="+", help="关键词；多个词必须在同一行出现")
    options = parser.parse_args()
    if not any(term.strip() for term in options.terms):
        parser.error("请提供至少一个非空关键词。")
    found = False
    for path, number, line in search(options.terms):
        print(f"knowledge/{path}:{number}  {line}")
        found = True
    if not found:
        print("没有匹配的知识条目。可尝试更短的关键词。")
    return 0 if found else 1


if __name__ == "__main__":
    raise SystemExit(main())
