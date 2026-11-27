"""Start a local, single-input prototype in a new directory."""

import argparse
from html import escape
from pathlib import Path
import shutil


ASSETS = Path(__file__).resolve().parents[1] / "assets"


def main():
    parser = argparse.ArgumentParser(description="生成可本地打开并带测试的单页原型。")
    parser.add_argument("destination", type=Path, help="尚不存在的目录")
    parser.add_argument("--title", default="单号复核", help="页面标题")
    args = parser.parse_args()
    try:
        args.destination.mkdir(parents=True, exist_ok=False)
    except FileExistsError:
        parser.error("目标目录已存在。请指定一个新目录以保留已有文件。")

    created = []
    try:
        page = (ASSETS / "index.html").read_text(encoding="utf-8")
        page = page.replace("{{TITLE}}", escape(args.title))
        for name in ("index.html", "app.js", "app.test.cjs"):
            out = args.destination / name
            with out.open("xb") as dest:
                created.append(out)
                if name == "index.html":
                    dest.write(page.encode("utf-8"))
                else:
                    with (ASSETS / name).open("rb") as source:
                        shutil.copyfileobj(source, dest)
    except OSError:
        for out in created:
            out.unlink(missing_ok=True)
        args.destination.rmdir()
        raise
    print(f"已生成 {args.destination / 'index.html'}")
    print(f'测试命令：node --test "{args.destination / "app.test.cjs"}"')


if __name__ == "__main__":
    main()
