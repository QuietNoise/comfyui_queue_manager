from .qm_server import QM_Server


class QueueManager:
    def __init__(self, __version__):
        self.server = QM_Server(__version__)
        return
