PYTHON ?= python

.PHONY: test security-lint frontend-build

test:
	$(PYTHON) -m pytest --cov=backend/app --cov-report=term-missing

security-lint:
	@echo "Scanning for unsafe execution calls..."
	@$(PYTHON) -c "import ast, pathlib, sys; names={'eval','exec','__import__','compile'}; roots=[pathlib.Path('backend/app'), pathlib.Path('backend/main.py')]; files=[p for root in roots for p in ([root] if root.is_file() else root.rglob('*.py'))]; findings=[(p,n.lineno,n.func.id) for p in files for n in ast.walk(ast.parse(p.read_text(encoding='utf-8-sig'))) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in names]; [print(f'SECURITY VIOLATION: {p}:{line} calls {name}') for p,line,name in findings]; sys.exit(1 if findings else 0)"
	@echo "Security scan passed."

frontend-build:
	cd frontend && npm run build
