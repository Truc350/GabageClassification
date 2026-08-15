from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class BackendApiError(RuntimeError):
    pass


class BackendApiClient:
    def __init__(self, base_url: str, timeout: float = 5):
        self.base_url, self.timeout = base_url.rstrip("/"), timeout

    def _request(self, method: str, path: str, payload: dict | None = None):
        body = json.dumps(payload).encode() if payload is not None else None
        req = Request(f"{self.base_url}{path}", data=body, method=method, headers={"Content-Type": "application/json", "Accept": "application/json"})
        try:
            with urlopen(req, timeout=self.timeout) as response:
                return json.loads(response.read().decode())
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise BackendApiError(str(exc)) from exc

    def categories(self):
        return self._request("GET", "/api/categories")

    def history(self, user_id: int):
        return self._request("GET", f"/api/history?{urlencode({'user_id': user_id})}")

    def save_history(self, payload: dict):
        return self._request("POST", "/api/history", payload)
