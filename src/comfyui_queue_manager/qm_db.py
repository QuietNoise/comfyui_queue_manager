from pathlib import Path
import sqlite3, threading

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "qm-queue.db"
_local = threading.local()


def get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn"):
        _local.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA synchronous=NORMAL")
        _local.conn.execute("PRAGMA foreign_keys=ON")
        _local.conn.row_factory = sqlite3.Row
    return _local.conn


# Produces a readable SQL string for debugging/logging.
def _debug_sql(query: str, params) -> str:
    conn = get_conn()

    if params is None:
        params = ()
    if not isinstance(params, (tuple, list)):
        params = (params,)
    try:
        return query % tuple(conn.execute("SELECT quote(?)", (p,)).fetchone()[0] for p in params)
    except Exception:
        return f"{query}  -- params={params!r}"


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
            archive_order INTEGER,
            status     INTEGER DEFAULT 0 -- 0: pending, 1: running, 2: finished, 3: archive, TODO: -1: error, -2: bin
        );

        CREATE TABLE IF NOT EXISTS options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Meta table
        CREATE TABLE IF NOT EXISTS meta (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT  NULL,  -- Foreign key to queue
            key VARCHAR(255) NOT NULL,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (item_id)
                REFERENCES queue(id)
                ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_queue_status_number
            ON queue(status, number);

        CREATE INDEX IF NOT EXISTS idx_meta_queue_id ON meta(item_id);


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

        CREATE TRIGGER IF NOT EXISTS options_set_updated_at
        AFTER UPDATE ON options
        FOR EACH ROW
        WHEN NEW.updated_at = OLD.updated_at         -- only if caller didn't change it
        BEGIN
          UPDATE options
          SET    updated_at = CURRENT_TIMESTAMP
          WHERE  rowid = NEW.rowid;
        END;

        CREATE TRIGGER IF NOT EXISTS meta_set_updated_at
        AFTER UPDATE ON meta
        FOR EACH ROW
        WHEN NEW.updated_at = OLD.updated_at         -- only if caller didn't change it
        BEGIN
          UPDATE meta
          SET    updated_at = CURRENT_TIMESTAMP
          WHERE  rowid = NEW.rowid;
        END;
    """)

    # Upgrade existing installations without changing their archive chronology.
    if "archive_order" not in {row[1] for row in conn.execute("PRAGMA table_info(queue)")}:
        conn.execute("ALTER TABLE queue ADD COLUMN archive_order INTEGER")
        conn.commit()
    conn.executescript("""
        CREATE INDEX IF NOT EXISTS idx_queue_archive_order
            ON queue(archive_order IS NULL, archive_order, updated_at, number, id)
            WHERE status = 3;

        -- A job returning to Archive joins its end instead of reusing an old slot.
        CREATE TRIGGER IF NOT EXISTS queue_reset_archive_order
        AFTER UPDATE OF status ON queue
        FOR EACH ROW
        WHEN NEW.status != OLD.status AND NEW.archive_order IS NOT NULL
        BEGIN
            UPDATE queue SET archive_order = NULL WHERE id = NEW.id;
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
