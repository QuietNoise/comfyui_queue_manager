# Add custom API routes, using router


# import traceback

from .qm_queue import QM_Queue
from .qm_server import QM_Server
from .qm_db import init_schema


class QueueManager:
    def __init__(self, __version__):
        init_schema()

        self.queue = QM_Queue(self)
        self.server = QM_Server(self, __version__)
        return
