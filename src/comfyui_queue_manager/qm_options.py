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

    def get(self, key, default=None):
        if key in self.__options:
            return self.__options[key]

        value = read_single(
            """
                SELECT value FROM options
                WHERE key = ?
            """,
            (key,),
        )

        if value is None:
            return_value = default
        else:
            return_value = json.loads(value[0]) if value else default

        self.__options[key] = return_value
        return return_value
