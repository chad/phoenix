from fastapi import FastAPI
from fastapi.responses import JSONResponse
from src.db import run_migrations

# Shared aggregate artifacts (register migrations on import)
import src.generated._migrations  # noqa: F401

# Generated route modules
from src.generated.board_ui.board_ui import router as board_ui_router
from src.generated.issue.issue import router as issue_router
from src.generated.sprint.sprint import router as sprint_router
from src.generated.sprint_rollup.sprint_rollup import router as sprint_rollup_router

app = FastAPI(title="trail-py")

@app.get("/health")
def health():
    return {"status": "ok"}

# Mount routes
app.include_router(board_ui_router, prefix="")
app.include_router(issue_router, prefix="/issue")
app.include_router(sprint_router, prefix="/sprint")
app.include_router(sprint_rollup_router, prefix="/sprint-rollup")

# Create tables from the registered migrations.
run_migrations()
