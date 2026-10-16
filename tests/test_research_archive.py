import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('archive',Path(__file__).resolve().parents[1]/'tools'/'verify-research-archive.py')
archive=importlib.util.module_from_spec(spec);spec.loader.exec_module(archive)

class ArchiveTests(unittest.TestCase):
    def test_hash_and_size(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);(root/'data.json').write_bytes(b'{}')
            item={'bytes':2,'sha256':hashlib.sha256(b'{}').hexdigest()}
            self.assertEqual(archive.verify_files(root,{'data.json':item}),1)
            (root/'data.json').write_bytes(b'[]')
            with self.assertRaises(ValueError):archive.verify_files(root,{'data.json':item})

    def test_parent_escape_rejected(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);(root/'inside').mkdir();(root/'outside').write_bytes(b'a')
            with self.assertRaises(ValueError):archive.verify_files(root/'inside',{'../outside':{'bytes':1,'sha256':hashlib.sha256(b'a').hexdigest()}})

if __name__=='__main__':unittest.main()
