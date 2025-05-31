class BadRouteException(Exception):
    """Exception raised when wrong route is passed."""

    def __init__(self, message="Bad route"):
        self.message = message
        super().__init__(self.message)
