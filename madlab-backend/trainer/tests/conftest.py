"""Common pytest fixtures for trainer tests."""
import pytest
import sys
import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch
import torch

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

FIXTURES = Path(__file__).parent / "fixtures"


class MockTokenizer:
    """Minimal tokenizer mock for testing dataset/collate logic."""
    def __init__(self, pad_token_id=0, eos_token="</s>"):
        self.pad_token_id = pad_token_id
        self.pad_token = "<pad>"
        self.eos_token = eos_token
        self._vocab = {}
        self._next_id = 1  # 0 reserved for pad

    def __call__(self, text, return_tensors='pt', truncation=True, max_length=512, add_special_tokens=True):
        tokens = text.split()
        ids = []
        if add_special_tokens:
            ids.append(1)  # BOS
        for t in tokens:
            if t not in self._vocab:
                self._vocab[t] = self._next_id
                self._next_id += 1
            ids.append(self._vocab[t])
        ids = ids[:max_length]
        return {'input_ids': torch.tensor([ids])}

    def save_pretrained(self, path):
        """Mock save."""
        pass


@pytest.fixture
def mock_tokenizer():
    return MockTokenizer()


@pytest.fixture
def valid_jsonl_path():
    return FIXTURES / "valid.jsonl"


@pytest.fixture
def malformed_jsonl_path():
    return FIXTURES / "malformed.jsonl"


@pytest.fixture
def temp_dir(tmp_path):
    """Provides a temporary directory that's cleaned up after test."""
    return tmp_path


@pytest.fixture
def sample_data():
    """Returns sample training data as list of dicts."""
    return [
        {"input": "What is 2+2?", "target": "4"},
        {"input": "Capital of France?", "target": "Paris"},
        {"input": "Reverse hello", "target": "olleh"},
    ]


@pytest.fixture
def temp_jsonl(tmp_path, sample_data):
    """Creates a temp jsonl file with sample data."""
    path = tmp_path / "test.jsonl"
    with open(path, 'w') as f:
        for item in sample_data:
            f.write(json.dumps(item) + '\n')
    return path


@pytest.fixture
def mock_peft_model():
    """Mock PeftModel for merge testing."""
    model = MagicMock()
    model.save_pretrained = MagicMock()
    return model


@pytest.fixture
def mock_base_model():
    """Mock base model for merge testing."""
    model = MagicMock()
    model.save_pretrained = MagicMock()
    return model
