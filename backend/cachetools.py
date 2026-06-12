from __future__ import annotations

import time
from collections import OrderedDict
from typing import Generic, Iterator, MutableMapping, Optional, Tuple, TypeVar


K = TypeVar("K")
V = TypeVar("V")


class TTLCache(MutableMapping[K, V], Generic[K, V]):
    def __init__(self, maxsize: int, ttl: float) -> None:
        self.maxsize = maxsize
        self.ttl = ttl
        self._data: OrderedDict[K, Tuple[float, V]] = OrderedDict()

    def __getitem__(self, key: K) -> V:
        expires_at, value = self._data[key]
        if expires_at < time.time():
            del self._data[key]
            raise KeyError(key)
        self._data.move_to_end(key)
        return value

    def __setitem__(self, key: K, value: V) -> None:
        self._data[key] = (time.time() + self.ttl, value)
        self._data.move_to_end(key)
        while len(self._data) > self.maxsize:
            self._data.popitem(last=False)

    def __delitem__(self, key: K) -> None:
        del self._data[key]

    def __iter__(self) -> Iterator[K]:
        return iter(self._data)

    def __len__(self) -> int:
        return len(self._data)

    def get(self, key: K, default: Optional[V] = None) -> Optional[V]:
        try:
            return self[key]
        except KeyError:
            return default

