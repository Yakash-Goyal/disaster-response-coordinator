# Quickstart

```bash
cd backend
pip install -r requirements.txt
python run.py
```

Open http://localhost:8000 — sign in as **commander / commander123**.

That is all. No database server, no API key, no routing service needed. The app
boots with a flood scenario seeded, agents running, and vehicles moving.

Other accounts: `responder1` / `responder123` (field view), `admin` / `admin123`.

Tests: `pip install pytest && python -m pytest tests/ -q`

To change the frontend: `cd frontend && npm install && npm run dev`
