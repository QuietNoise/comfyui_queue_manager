from pathlib import Path
import sqlite3, threading

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "qm-queue.db"
_local = threading.local()


def get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn"):
        _local.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA synchronous=NORMAL")
        _local.conn.row_factory = sqlite3.Row
    return _local.conn


def init_schema():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prompt_id  VARCHAR(255) NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            number     INTEGER,
            name       TEXT,
            workflow_id   VARCHAR(255),
            prompt    TEXT,
            status     INTEGER DEFAULT 0 -- 0: pending, 1: running, 2: finished, 3: archive, TODO: -1: error, -2: bin
        );

        CREATE TABLE IF NOT EXISTS options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            value TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_queue_status_number
            ON queue(status, number);

        -- Create a trigger to update the updated_at column
        CREATE TRIGGER IF NOT EXISTS queue_set_updated_at
        AFTER UPDATE ON queue
        FOR EACH ROW
        WHEN NEW.updated_at = OLD.updated_at         -- only if caller didn't change it
        BEGIN
          UPDATE queue
          SET    updated_at = CURRENT_TIMESTAMP
          WHERE  rowid = NEW.rowid;
        END;
    """)


# Helper functions to read and write to the database
def write_query(query, params=(), commit=True):
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute(query, params)
    if commit:
        conn.commit()
    return cursor.rowcount


def write_many(query, params):
    if params is None:
        params = []
    conn = get_conn()
    cursor = conn.cursor()
    cursor.executemany(query, params)
    conn.commit()
    return cursor.rowcount


def read_query(query, params=()):
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute(query, params)
    return cursor.fetchall()


def read_single(query, params=()):
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute(query, params)
    return cursor.fetchone()
