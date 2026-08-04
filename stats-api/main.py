import os

import psycopg2
from fastapi import FastAPI
from fastapi.responses import JSONResponse

REQUIRED_ENV_VARS = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"]
missing = [name for name in REQUIRED_ENV_VARS if not os.environ.get(name)]
if missing:
    raise RuntimeError(f"Variables d'environnement manquantes : {', '.join(missing)}")

DB_HOST = os.environ["DB_HOST"]
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ["DB_NAME"]
DB_USER = os.environ["DB_USER"]
DB_PASSWORD = os.environ["DB_PASSWORD"]

TABLE_NAME = os.environ.get("TABLE_NAME", "tasks")
STATUS_COLUMN = os.environ.get("STATUS_COLUMN", "status")
KNOWN_STATUSES = ["todo", "in_progress", "done"]

app = FastAPI()


def get_connection():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        connect_timeout=3,
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/stats")
def stats():
    counts = {status: 0 for status in KNOWN_STATUSES}

    try:
        conn = get_connection()
    except psycopg2.OperationalError:
        return JSONResponse(
            status_code=503,
            content={"error": "stats-api ne parvient pas a joindre la base de donnees"},
        )

    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT {STATUS_COLUMN}, COUNT(*) FROM {TABLE_NAME} GROUP BY {STATUS_COLUMN}"
                )
                for status, count in cur.fetchall():
                    counts[status] = count
    finally:
        conn.close()

    return counts
