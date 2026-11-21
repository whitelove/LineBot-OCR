# Upstream test reference (not production)

`line_engine.py` and `thai_norm.py` are unmodified copies of iApp's Apache-2.0
runtime, pinned to revision `39fa41bdd49f067ba41b1d9de79c06ab506d67d4`.

Source: https://huggingface.co/iapp/OpenThai2.0-OCR-Text/tree/39fa41bdd49f067ba41b1d9de79c06ab506d67d4/runtime

See root `NOTICE` and `LICENSE`. They are used only by the optional local
`scripts/compare-reference.py`. No Python package is installed by npm or used
by any production route. Known tested interpreter: Python 3.9 on macOS arm64.
