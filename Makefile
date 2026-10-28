PY := $(CURDIR)/.venv/bin/python
PIP := $(CURDIR)/.venv/bin/pip

.PHONY: install api web test test-backend test-frontend build migrate clean

install:
	python3 -m venv .venv
	$(PIP) install --upgrade pip
	$(PIP) install -r backend/requirements.txt
	cd frontend && npm ci

api:
	cd backend && APP_ENV=development $(PY) -m uvicorn app.main:app --reload --port 8000

web:
	cd frontend && npm run dev

test: test-backend test-frontend

test-backend:
	cd backend && $(PY) -m pytest -q

test-frontend:
	cd frontend && npm test

build:
	cd frontend && npm run build

migrate:
	cd backend && $(PY) -m alembic upgrade head

clean:
	rm -rf backend/__pycache__ backend/**/__pycache__ backend/.pytest_cache frontend/dist
