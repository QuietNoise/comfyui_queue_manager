from datetime import datetime

from .qm_db import write_query, read_single
import json


class QM_Options:
    def __init__(self):
        # cache for options
        self.__options = {}

    def set(self, key, value=None):
        write_query(
            """
            INSERT INTO options(key, value)
            VALUES(?, ?)
            ON CONFLICT(key) DO UPDATE
              SET value = excluded.value;
        """,
            (key, json.dumps(value)),
        )
        self.__options[key] = value

    def get(self, key, default=None, with_timestamp=False):
        if key in self.__options:
            cached = self.__options[key]
            if with_timestamp:
                return cached
            else:
                # cached can be a plain value (set via set()) or a tuple (loaded from DB)
                return cached if not isinstance(cached, tuple) else cached[0]

        value = read_single(
            """
                SELECT value, updated_at FROM options
                WHERE key = ?
            """,
            (key,),
        )

        if value is None:
            return_value = default
            timestamp = datetime.now()
        else:
            return_value = json.loads(value[0]) if value else default
            timestamp = value[1]

        self.__options[key] = (return_value, timestamp)

        if with_timestamp:
            return return_value, timestamp
        else:
            return return_value
