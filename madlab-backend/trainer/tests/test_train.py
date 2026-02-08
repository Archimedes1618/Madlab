"""Tests for train.py - PairDataset, collate, evaluate."""
import pytest
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import torch

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from train import PairDataset, collate, evaluate

FIXTURES = Path(__file__).parent / "fixtures"


class MockTokenizer:
    """Minimal tokenizer mock for testing."""
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


class TestPairDataset:
    def test_loads_valid_jsonl(self):
        tok = MockTokenizer()
        ds = PairDataset(FIXTURES / "valid.jsonl", tok, max_len=64)
        assert len(ds) == 3
        assert ds.samples[0]["input"] == "What is 2+2?"
        assert ds.samples[0]["target"] == "4"
    
    def test_handles_malformed_json(self, capsys):
        tok = MockTokenizer()
        ds = PairDataset(FIXTURES / "malformed.jsonl", tok, max_len=64)
        # Should load 2 valid lines, skip the bad one
        assert len(ds) == 2
        # Check warning was printed
        captured = capsys.readouterr()
        assert "warning" in captured.out.lower() or "invalid" in captured.out.lower()
    
    def test_tokenization_produces_input_ids_and_labels(self):
        tok = MockTokenizer()
        ds = PairDataset(FIXTURES / "valid.jsonl", tok, max_len=64)
        item = ds[0]
        assert "input_ids" in item
        assert "labels" in item
        assert isinstance(item["input_ids"], torch.Tensor)
        assert isinstance(item["labels"], torch.Tensor)
        assert item["input_ids"].shape == item["labels"].shape
    
    def test_labels_masked_for_prompt(self):
        tok = MockTokenizer()
        ds = PairDataset(FIXTURES / "valid.jsonl", tok, max_len=64)
        item = ds[0]
        labels = item["labels"]
        # Some portion should be -100 (masked prompt)
        # The target portion should NOT be -100
        assert (labels == -100).any(), "Expected some masked tokens"
        assert (labels != -100).any(), "Expected some non-masked tokens (target)"


class TestCollate:
    def test_pads_to_same_length(self):
        batch = [
            {"input_ids": torch.tensor([1, 2, 3]), "labels": torch.tensor([1, 2, 3])},
            {"input_ids": torch.tensor([4, 5]), "labels": torch.tensor([4, 5])},
        ]
        result = collate(batch, pad_id=0)
        assert result["input_ids"].shape == (2, 3)
        assert result["labels"].shape == (2, 3)
    
    def test_padding_uses_correct_pad_id(self):
        batch = [
            {"input_ids": torch.tensor([1, 2]), "labels": torch.tensor([-100, 5])},
            {"input_ids": torch.tensor([3]), "labels": torch.tensor([6])},
        ]
        result = collate(batch, pad_id=99)
        # Second item should be padded
        assert result["input_ids"][1, 1].item() == 99
    
    def test_labels_padding_uses_minus_100(self):
        batch = [
            {"input_ids": torch.tensor([1, 2]), "labels": torch.tensor([1, 2])},
            {"input_ids": torch.tensor([3]), "labels": torch.tensor([3])},
        ]
        result = collate(batch, pad_id=0)
        # Labels padding should be -100, not the pad_id
        assert result["labels"][1, 1].item() == -100
    
    def test_returns_proper_batch_dict(self):
        batch = [
            {"input_ids": torch.tensor([1, 2]), "labels": torch.tensor([1, 2])},
        ]
        result = collate(batch, pad_id=0)
        assert "input_ids" in result
        assert "labels" in result
        assert isinstance(result["input_ids"], torch.Tensor)
        assert isinstance(result["labels"], torch.Tensor)


class TestEvaluate:
    """Tests for evaluate function."""

    @pytest.fixture
    def mock_model(self):
        """Create mock model that returns predictable loss."""
        model = MagicMock()
        model.eval = MagicMock()
        model.train = MagicMock()
        return model

    @pytest.fixture
    def mock_dataloader(self):
        """Create mock dataloader with test batches."""
        batch1 = {
            'input_ids': torch.tensor([[1, 2, 3]]),
            'labels': torch.tensor([[1, 2, 3]]),
        }
        batch2 = {
            'input_ids': torch.tensor([[4, 5, 6]]),
            'labels': torch.tensor([[4, 5, 6]]),
        }
        return [batch1, batch2]

    def test_returns_average_loss(self, mock_model, mock_dataloader):
        """Returns average loss across all batches."""
        # Mock model output with losses 1.0 and 2.0
        out1 = MagicMock()
        out1.loss = torch.tensor(1.0)
        out2 = MagicMock()
        out2.loss = torch.tensor(2.0)
        mock_model.return_value = out1

        call_count = [0]
        def side_effect(*args, **kwargs):
            call_count[0] += 1
            return out1 if call_count[0] == 1 else out2

        mock_model.side_effect = side_effect

        result = evaluate(mock_model, mock_dataloader, 'cpu', use_cuda=False, amp_dtype=torch.float32)

        # Average of 1.0 and 2.0
        assert result["loss"] == 1.5
        assert "perplexity" in result

    def test_sets_model_to_eval_then_train(self, mock_model, mock_dataloader):
        """Puts model in eval mode during evaluation, restores to train."""
        out = MagicMock()
        out.loss = torch.tensor(1.0)
        mock_model.return_value = out

        evaluate(mock_model, mock_dataloader, 'cpu', use_cuda=False, amp_dtype=torch.float32)

        mock_model.eval.assert_called_once()
        mock_model.train.assert_called_once()

    def test_skips_nan_loss(self, mock_model):
        """NaN losses are not counted in average."""
        batch = {'input_ids': torch.tensor([[1]]), 'labels': torch.tensor([[1]])}
        dataloader = [batch, batch, batch]

        out_nan = MagicMock()
        out_nan.loss = torch.tensor(float('nan'))
        out_valid = MagicMock()
        out_valid.loss = torch.tensor(2.0)

        call_count = [0]
        def side_effect(*args, **kwargs):
            call_count[0] += 1
            return out_nan if call_count[0] == 1 else out_valid

        mock_model.side_effect = side_effect

        result = evaluate(mock_model, dataloader, 'cpu', use_cuda=False, amp_dtype=torch.float32)

        # Only 2 valid losses of 2.0 each
        assert result["loss"] == 2.0

    def test_skips_inf_loss(self, mock_model):
        """Inf losses are not counted in average."""
        batch = {'input_ids': torch.tensor([[1]]), 'labels': torch.tensor([[1]])}
        dataloader = [batch, batch]

        out_inf = MagicMock()
        out_inf.loss = torch.tensor(float('inf'))
        out_valid = MagicMock()
        out_valid.loss = torch.tensor(3.0)

        call_count = [0]
        def side_effect(*args, **kwargs):
            call_count[0] += 1
            return out_inf if call_count[0] == 1 else out_valid

        mock_model.side_effect = side_effect

        result = evaluate(mock_model, dataloader, 'cpu', use_cuda=False, amp_dtype=torch.float32)

        assert result["loss"] == 3.0

    def test_returns_inf_when_all_losses_invalid(self, mock_model):
        """Returns inf when all batches have invalid losses."""
        batch = {'input_ids': torch.tensor([[1]]), 'labels': torch.tensor([[1]])}
        dataloader = [batch]

        out = MagicMock()
        out.loss = torch.tensor(float('nan'))
        mock_model.return_value = out

        result = evaluate(mock_model, dataloader, 'cpu', use_cuda=False, amp_dtype=torch.float32)

        assert result["loss"] == float('inf')

    def test_handles_empty_dataloader(self, mock_model):
        """Returns inf for empty dataloader."""
        result = evaluate(mock_model, [], 'cpu', use_cuda=False, amp_dtype=torch.float32)
        assert result["loss"] == float('inf')

    def test_handles_attention_mask(self, mock_model):
        """Passes attention_mask to model when present in batch."""
        batch = {
            'input_ids': torch.tensor([[1, 2]]),
            'labels': torch.tensor([[1, 2]]),
            'attention_mask': torch.tensor([[1, 1]])
        }
        dataloader = [batch]

        out = MagicMock()
        out.loss = torch.tensor(1.0)
        mock_model.return_value = out

        evaluate(mock_model, dataloader, 'cpu', use_cuda=False, amp_dtype=torch.float32)

        # Check that attention_mask was passed
        call_kwargs = mock_model.call_args[1]
        assert 'attention_mask' in call_kwargs


class TestPairDatasetEdgeCases:
    """Additional edge case tests for PairDataset."""

    def test_empty_file(self, tmp_path):
        """Handles empty file gracefully."""
        empty_file = tmp_path / "empty.jsonl"
        empty_file.write_text("")

        tok = MockTokenizer()
        ds = PairDataset(empty_file, tok, max_len=64)

        assert len(ds) == 0

    def test_whitespace_only_lines(self, tmp_path):
        """Skips lines that are whitespace only."""
        file = tmp_path / "whitespace.jsonl"
        file.write_text('{"input": "a", "target": "b"}\n   \n\n{"input": "c", "target": "d"}\n')

        tok = MockTokenizer()
        ds = PairDataset(file, tok, max_len=64)

        assert len(ds) == 2

    def test_truncates_long_sequences(self, tmp_path):
        """Truncates sequences longer than max_len."""
        file = tmp_path / "long.jsonl"
        long_input = " ".join(["word"] * 100)
        file.write_text(json.dumps({"input": long_input, "target": "short"}) + "\n")

        tok = MockTokenizer()
        ds = PairDataset(file, tok, max_len=20)

        item = ds[0]
        assert item["input_ids"].shape[0] <= 20


class TestCollateEdgeCases:
    """Additional edge case tests for collate."""

    def test_single_item_batch(self):
        """Handles single-item batch."""
        batch = [{"input_ids": torch.tensor([1, 2, 3]), "labels": torch.tensor([1, 2, 3])}]
        result = collate(batch, pad_id=0)
        assert result["input_ids"].shape == (1, 3)

    def test_all_same_length(self):
        """No padding when all sequences same length."""
        batch = [
            {"input_ids": torch.tensor([1, 2]), "labels": torch.tensor([1, 2])},
            {"input_ids": torch.tensor([3, 4]), "labels": torch.tensor([3, 4])},
        ]
        result = collate(batch, pad_id=99)

        # No 99s should appear (no padding needed)
        assert (result["input_ids"] == 99).sum().item() == 0
