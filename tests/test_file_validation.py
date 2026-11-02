"""Regression coverage for path validation on IIB file-serving endpoints."""

import os
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from scripts.iib.file_validation import require_regular_file


class FileValidationTests(unittest.TestCase):
    def test_existing_file_is_accepted(self):
        with tempfile.TemporaryDirectory() as root:
            image = Path(root, "image.jxl")
            image.write_bytes(b"test")
            self.assertIsNone(require_regular_file(str(image)))

    def test_directory_is_rejected_before_fileresponse(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(HTTPException) as caught:
                require_regular_file(root)
            self.assertEqual(caught.exception.status_code, 400)

    def test_nested_directory_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            dated_folder = Path(root, "2026-11-03")
            dated_folder.mkdir()
            with self.assertRaises(HTTPException) as caught:
                require_regular_file(str(dated_folder))
            self.assertEqual(caught.exception.status_code, 400)

    def test_directory_with_image_extension_is_still_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            fake_image = Path(root, "folder.jxl")
            fake_image.mkdir()
            with self.assertRaises(HTTPException) as caught:
                require_regular_file(str(fake_image))
            self.assertEqual(caught.exception.status_code, 400)

    def test_missing_path_returns_404(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(HTTPException) as caught:
                require_regular_file(os.path.join(root, "missing.png"))
            self.assertEqual(caught.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
