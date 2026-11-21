"""Optional developer check only. Never imported or installed by production."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.reference.line_engine import LineOCR

engine = LineOCR('models', threads=1, runtime={'backend': 'onnxruntime'})
results = []
for name in ('thai', 'english', 'multiline'):
    result = engine.read(f'tests/fixtures/{name}.png')
    expected = Path(f'tests/fixtures/{name}.txt').read_text().strip()
    assert result['text'] == expected, (name, result['text'])
    results.append({'name': name, 'text': result['text'], 'lines': result['lines']})
Path('test-results').mkdir(exist_ok=True)
Path('test-results/reference.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
javascript = json.loads(Path('test-results/ocr.json').read_text())['results']
for result in results:
    js = next(r for r in javascript if r['name'] == result['name'])
    assert js['text'] == result['text'], result['name']
    print(f"PASS {result['name']}: JavaScript == Python reference == expected text")
