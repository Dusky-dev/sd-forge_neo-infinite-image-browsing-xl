"""Regression checks for Try My Luck checkpoint filtering."""

import os
import sqlite3
import tempfile
import unittest

from scripts.iib.db.datamodel import Image, Tag


class RandomCheckpointTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.executescript(
            """
            CREATE TABLE image (
                id INTEGER PRIMARY KEY,
                path TEXT, exif TEXT, size INTEGER,
                date TEXT, exif_edited INTEGER DEFAULT 0
            );
            CREATE TABLE tag (
                id INTEGER PRIMARY KEY, name TEXT,
                score INTEGER, type TEXT, count INTEGER, color TEXT
            );
            CREATE TABLE image_tag (image_id INTEGER, tag_id INTEGER);
            INSERT INTO tag VALUES (1, 'myModel', 0, 'Model', 0, '');
            INSERT INTO tag VALUES (2, 'myModelXL', 0, 'Model', 0, '');
            INSERT INTO tag VALUES (3, 'myModel', 0, 'Sampler', 0, '');
            INSERT INTO tag VALUES (4, 'unusedModel', 0, 'Model', 0, '');
            """
        )

        for image_id in (1, 2, 3, 4):
            path = os.path.join(self.temp_dir.name, f"{image_id}.png")
            with open(path, "wb") as file:
                file.write(b"test")
            self.conn.execute(
                "INSERT INTO image (id, path, size, date) VALUES (?, ?, ?, ?)",
                (image_id, path, 4, "2026-01-01"),
            )

        self.conn.executemany(
            "INSERT INTO image_tag VALUES (?, ?)",
            [(1, 1), (2, 1), (3, 2), (4, 3)],
        )
        self.conn.commit()

    def test_unfiltered_random_images_preserved(self):
        images = Image.get_random_images(self.conn, 128)
        self.assertEqual({img.id for img in images}, {1, 2, 3, 4})

    def test_checkpoint_is_exact_and_uses_model_type(self):
        images = Image.get_random_images(self.conn, 128, checkpoint="myModel")
        self.assertEqual({img.id for img in images}, {1, 2})
        self.assertEqual(
            [img.id for img in Image.get_random_images(self.conn, 128, checkpoint="myModelXL")],
            [3],
        )
        self.assertEqual(
            Image.get_random_images(self.conn, 128, checkpoint="notARealModel"), []
        )

    def test_checkpoint_options_count_only_associated_indexed_media(self):
        self.assertEqual(
            Tag.get_model_checkpoints(self.conn),
            [{"name": "myModel", "count": 2}, {"name": "myModelXL", "count": 1}],
        )

    def test_size_limit_and_empty_choice(self):
        self.assertEqual(len(Image.get_random_images(self.conn, 1, checkpoint="myModel")), 1)
        self.assertEqual(Image.get_random_images(self.conn, 0, checkpoint="myModel"), [])
        self.assertEqual(
            len(Image.get_random_images(self.conn, 128, checkpoint="")), 4
        )


if __name__ == "__main__":
    unittest.main()
