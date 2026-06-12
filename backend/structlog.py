from __future__ import annotations

import logging
from typing import Any


class _Logger:
    def __init__(self, name: str = "aura") -> None:
        self._logger = logging.getLogger(name)

    def debug(self, event: str, **kwargs: Any) -> None:
        self._logger.debug("%s %s", event, kwargs)

    def info(self, event: str, **kwargs: Any) -> None:
        self._logger.info("%s %s", event, kwargs)

    def warning(self, event: str, **kwargs: Any) -> None:
        self._logger.warning("%s %s", event, kwargs)

    def error(self, event: str, **kwargs: Any) -> None:
        self._logger.error("%s %s", event, kwargs)


def get_logger(name: str = "aura") -> _Logger:
    return _Logger(name)

