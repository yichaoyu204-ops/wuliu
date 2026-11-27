import re
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from search_kb import KNOWLEDGE, search


class KnowledgeTests(unittest.TestCase):
    def test_rate_is_located_in_original_scope(self):
        records = list(search(["Ｆ０３", "示例仓"]))
        self.assertTrue(any("37 元/公吨" in line and "第 1 页" in line for _, _, line in records))
        for path, number, line in records:
            text = (KNOWLEDGE / path).read_text(encoding="utf-8").splitlines()
            self.assertEqual(line, text[number - 1].strip())

    def test_all_terms_must_be_on_one_line(self):
        notes = KNOWLEDGE / "logistics"
        self.assertTrue(list(search(["F03 示例仓"], notes)))
        self.assertTrue(list(search(["F05 上门提货"], notes)))
        self.assertEqual(list(search(["F03 F05"], notes)), [])
        with self.assertRaises(ValueError):
            list(search([" "], notes))

    def test_cli_outside_repository(self):
        script = str(ROOT / "scripts" / "search_kb.py")
        for word, code in [("F06", 0), ("ZZ_TEST_ABSENT", 1), (" ", 2)]:
            with self.subTest(word=word):
                result = subprocess.run(
                    [sys.executable, "-X", "utf8", script, word],
                    cwd=ROOT.parent,
                    capture_output=True,
                )
                self.assertEqual(result.returncode, code)
                if code == 0:
                    self.assertIn("元/票/天", result.stdout.decode("utf-8"))

    def test_project_entry_links_resolve(self):
        for path in [ROOT / "AGENTS.md", KNOWLEDGE / "INDEX.md"]:
            for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
                with self.subTest(target=target):
                    self.assertTrue((path.parent / target).is_file())

    def test_skill_names_and_descriptions(self):
        skills = list((ROOT / ".agents" / "skills").glob("*/SKILL.md"))
        self.assertEqual({path.parent.name for path in skills}, {
            "adversarial-reviewer", "dirty-doc-extractor", "mvp-scaffolder", "aesthetic-ui-polisher"
        })
        for path in skills:
            with self.subTest(skill=path.parent.name):
                content = path.read_text(encoding="utf-8")
                frontmatter = content.split("---\n", 2)[1]
                self.assertIn(f"name: {path.parent.name}\n", frontmatter)
                self.assertRegex(frontmatter, r"description: .{20,}")


if __name__ == "__main__":
    unittest.main()
