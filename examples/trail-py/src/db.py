import os
import sqlite3

DB_PATH = os.environ.get("DB_PATH", "data/app.db")
os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)

db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.row_factory = sqlite3.Row
db.execute("PRAGMA journal_mode = WAL")
db.execute("PRAGMA foreign_keys = ON")

_migrations: list[tuple[str, str]] = []


def register_migration(name: str, sql: str) -> None:
    _migrations.append((name, sql))


def run_migrations() -> None:
    for _name, sql in _migrations:
        db.executescript(sql)
    db.commit()
