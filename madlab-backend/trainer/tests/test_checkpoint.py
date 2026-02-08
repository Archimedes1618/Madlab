"""Tests for checkpoint management - save/load/cleanup."""
import pytest
import sys
import os
import json
import torch
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))
from train import save_checkpoint, load_checkpoint


class TestSaveCheckpoint:
    """Tests for checkpoint saving."""

    def test_creates_checkpoint_directory(self, tmp_path):
        """Creates checkpoint dir if it doesn't exist."""
        ckpt_dir = tmp_path / "checkpoints"
        assert not ckpt_dir.exists()

        model = MagicMock()
        model.state_dict.return_value = {"weight": torch.tensor([1.0])}
        optimizer = MagicMock()
        optimizer.state_dict.return_value = {"lr": 0.001}
        scheduler = MagicMock()
        scheduler.state_dict.return_value = {"step": 0}

        save_checkpoint(model, optimizer, scheduler, epoch=0, best_loss=1.0, checkpoint_dir=str(ckpt_dir))

        assert ckpt_dir.exists()

    def test_saves_checkpoint_file(self, tmp_path):
        """Saves checkpoint with correct filename."""
        ckpt_dir = tmp_path / "checkpoints"

        model = MagicMock()
        model.state_dict.return_value = {"weight": torch.tensor([1.0])}
        optimizer = MagicMock()
        optimizer.state_dict.return_value = {"lr": 0.001}
        scheduler = MagicMock()
        scheduler.state_dict.return_value = {"step": 0}

        save_checkpoint(model, optimizer, scheduler, epoch=5, best_loss=0.5, checkpoint_dir=str(ckpt_dir))

        expected_path = ckpt_dir / "checkpoint_epoch_5.pt"
        assert expected_path.exists()

    def test_checkpoint_contains_required_keys(self, tmp_path):
        """Checkpoint file contains epoch, model_state, optimizer_state, scheduler_state, best_loss."""
        ckpt_dir = tmp_path / "checkpoints"

        model = MagicMock()
        model.state_dict.return_value = {"weight": torch.tensor([1.0])}
        optimizer = MagicMock()
        optimizer.state_dict.return_value = {"lr": 0.001}
        scheduler = MagicMock()
        scheduler.state_dict.return_value = {"step": 100}

        save_checkpoint(model, optimizer, scheduler, epoch=3, best_loss=0.25, checkpoint_dir=str(ckpt_dir))

        ckpt = torch.load(ckpt_dir / "checkpoint_epoch_3.pt", weights_only=False)
        assert ckpt["epoch"] == 3
        assert ckpt["best_loss"] == 0.25
        assert "model_state" in ckpt
        assert "optimizer_state" in ckpt
        assert "scheduler_state" in ckpt

    def test_keeps_only_last_n_checkpoints(self, tmp_path):
        """Old checkpoints are cleaned up, keeping only last N."""
        ckpt_dir = tmp_path / "checkpoints"

        model = MagicMock()
        model.state_dict.return_value = {"weight": torch.tensor([1.0])}
        optimizer = MagicMock()
        optimizer.state_dict.return_value = {"lr": 0.001}
        scheduler = MagicMock()
        scheduler.state_dict.return_value = {"step": 0}

        # Save 5 checkpoints with keep_last=2
        for epoch in range(5):
            save_checkpoint(model, optimizer, scheduler, epoch=epoch, best_loss=1.0,
                          checkpoint_dir=str(ckpt_dir), keep_last=2)

        # Only last 2 should remain
        checkpoints = list(ckpt_dir.glob("checkpoint_epoch_*.pt"))
        assert len(checkpoints) == 2
        # Should be epochs 3 and 4
        names = sorted([c.name for c in checkpoints])
        assert "checkpoint_epoch_3.pt" in names
        assert "checkpoint_epoch_4.pt" in names

    def test_default_keep_last_is_3(self, tmp_path):
        """Default keep_last=3."""
        ckpt_dir = tmp_path / "checkpoints"

        model = MagicMock()
        model.state_dict.return_value = {}
        optimizer = MagicMock()
        optimizer.state_dict.return_value = {}
        scheduler = MagicMock()
        scheduler.state_dict.return_value = {}

        for epoch in range(10):
            save_checkpoint(model, optimizer, scheduler, epoch=epoch, best_loss=1.0, checkpoint_dir=str(ckpt_dir))

        checkpoints = list(ckpt_dir.glob("checkpoint_epoch_*.pt"))
        assert len(checkpoints) == 3


class TestLoadCheckpoint:
    """Tests for checkpoint loading."""

    def test_returns_none_when_no_checkpoints(self, tmp_path):
        """Returns None if checkpoint directory is empty."""
        ckpt_dir = tmp_path / "checkpoints"
        ckpt_dir.mkdir()

        result = load_checkpoint(str(ckpt_dir))
        assert result is None

    def test_returns_none_when_dir_missing(self, tmp_path):
        """Returns None if checkpoint directory doesn't exist."""
        result = load_checkpoint(str(tmp_path / "nonexistent"))
        assert result is None

    def test_loads_latest_checkpoint(self, tmp_path):
        """Loads the most recent checkpoint by mtime."""
        ckpt_dir = tmp_path / "checkpoints"
        ckpt_dir.mkdir()

        # Create multiple checkpoints
        for epoch in [1, 3, 2]:  # Out of order
            ckpt_path = ckpt_dir / f"checkpoint_epoch_{epoch}.pt"
            torch.save({
                "epoch": epoch,
                "model_state": {},
                "optimizer_state": {},
                "best_loss": float(epoch)
            }, ckpt_path)
            # Touch to ensure different mtimes (on fast systems)
            import time
            time.sleep(0.01)

        result = load_checkpoint(str(ckpt_dir))

        # Should load the last one created (epoch 2)
        assert result is not None
        assert result["epoch"] == 2

    def test_returns_checkpoint_dict(self, tmp_path):
        """Returned dict contains expected keys."""
        ckpt_dir = tmp_path / "checkpoints"
        ckpt_dir.mkdir()

        torch.save({
            "epoch": 5,
            "model_state": {"w": torch.tensor([1.0])},
            "optimizer_state": {"lr": 0.01},
            "best_loss": 0.1
        }, ckpt_dir / "checkpoint_epoch_5.pt")

        result = load_checkpoint(str(ckpt_dir))

        assert result["epoch"] == 5
        assert result["best_loss"] == 0.1
        assert "model_state" in result
        assert "optimizer_state" in result


class TestCheckpointRoundTrip:
    """Integration tests for save/load cycle."""

    def test_save_load_roundtrip(self, tmp_path):
        """Saved checkpoint can be loaded back."""
        ckpt_dir = tmp_path / "checkpoints"

        # Create real-ish state dicts
        model_state = {"layer.weight": torch.randn(10, 10)}
        opt_state = {"param_groups": [{"lr": 0.001}]}
        sched_state = {"last_epoch": 7}

        model = MagicMock()
        model.state_dict.return_value = model_state
        optimizer = MagicMock()
        optimizer.state_dict.return_value = opt_state
        scheduler = MagicMock()
        scheduler.state_dict.return_value = sched_state

        save_checkpoint(model, optimizer, scheduler, epoch=7, best_loss=0.123, checkpoint_dir=str(ckpt_dir))

        loaded = load_checkpoint(str(ckpt_dir))

        assert loaded["epoch"] == 7
        assert loaded["best_loss"] == 0.123
        assert torch.allclose(loaded["model_state"]["layer.weight"], model_state["layer.weight"])

    def test_resume_training_scenario(self, tmp_path):
        """Simulates resuming training from checkpoint."""
        ckpt_dir = tmp_path / "checkpoints"

        # "Train" for 3 epochs, saving checkpoints
        model = MagicMock()
        optimizer = MagicMock()
        scheduler = MagicMock()

        for epoch in range(3):
            model.state_dict.return_value = {"epoch": epoch}
            optimizer.state_dict.return_value = {"step": epoch * 100}
            scheduler.state_dict.return_value = {"last_epoch": epoch}
            save_checkpoint(model, optimizer, scheduler, epoch=epoch, best_loss=1.0 - epoch * 0.1,
                          checkpoint_dir=str(ckpt_dir))

        # "Crash" and resume
        loaded = load_checkpoint(str(ckpt_dir))

        assert loaded is not None
        # Should resume from epoch 2 (last saved)
        assert loaded["epoch"] == 2
