"""Shared guards for file-serving API endpoints.

A directory may have a small stat size, but Starlette FileResponse cannot
serve it as a file. Validate the source before returning a cached image or
creating a FileResponse.
"""

import os

from fastapi import HTTPException


def require_regular_file(path: str) -> None:
    """Raise a clean 4xx response for missing paths and non-files."""
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")
    if not os.path.isfile(path):
        raise HTTPException(status_code=400, detail=f"{path} is not a file")
