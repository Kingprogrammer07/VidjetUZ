"""Generate both browser dictionaries from the editable sdk/uz.json file."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
words = json.loads((root / "sdk/uz.json").read_text(encoding="utf-8"))
source = "window.VIDJETUZ_WORDS = " + json.dumps(words, ensure_ascii=False, separators=(",", ":")) + ";\n"
for target in (root / "sdk/uz.js", root / "ui/control-center/uz.js"):
    target.write_text(source, encoding="utf-8")
print(f"{len(words)} ta ibora sinxronlandi")
