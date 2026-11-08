from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
app=(ROOT/"app.js").read_text(encoding="utf-8")
html=(ROOT/"index.html").read_text(encoding="utf-8")
assert "#homeSyncBtn, #syncUniversityNowBtn" in app
assert "force: true, silent: false" in app
assert "button.disabled = false" in app
assert "app.js?v=12.0.5" in html
assert "style.css?v=12.0.5" in html
assert "config.js?v=12.0.5" in html
print("Refresh button release-contract test passed.")
