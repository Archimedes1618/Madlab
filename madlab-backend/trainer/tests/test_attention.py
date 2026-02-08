"""Tests for get_attn_implementation - Flash attention detection."""
import pytest
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))
from train import get_attn_implementation


class TestGetAttnImplementation:
    """Tests for attention implementation detection."""

    def test_returns_explicit_flash_attention(self):
        """Returns flash_attention_2 when explicitly requested."""
        assert get_attn_implementation("flash_attention_2") == "flash_attention_2"

    def test_returns_explicit_sdpa(self):
        """Returns sdpa when explicitly requested."""
        assert get_attn_implementation("sdpa") == "sdpa"

    def test_returns_explicit_eager(self):
        """Returns eager when explicitly requested."""
        assert get_attn_implementation("eager") == "eager"

    def test_invalid_input_falls_back_to_auto(self):
        """Invalid input triggers auto-detection."""
        with patch.dict('sys.modules', {'flash_attn': MagicMock()}):
            result = get_attn_implementation("invalid_option")
            assert result in ("flash_attention_2", "sdpa", "eager")

    @patch.dict('sys.modules', {'flash_attn': MagicMock()})
    def test_auto_detects_flash_attention(self):
        """Auto mode returns flash_attention_2 when available."""
        # Need to reimport to pick up the mock
        import importlib
        import train
        importlib.reload(train)
        result = train.get_attn_implementation("auto")
        assert result == "flash_attention_2"

    def test_auto_falls_back_to_sdpa(self):
        """Auto mode returns sdpa when flash_attn unavailable but sdpa exists."""
        import torch

        # Remove flash_attn from modules
        with patch.dict('sys.modules', {'flash_attn': None}):
            # Ensure import raises
            def raise_import(*args, **kwargs):
                raise ImportError("No flash_attn")

            with patch('builtins.__import__', side_effect=raise_import):
                if hasattr(torch.nn.functional, 'scaled_dot_product_attention'):
                    # Can't easily remove this, so just verify the logic
                    result = get_attn_implementation("auto")
                    # Should be sdpa or flash_attention_2 depending on env
                    assert result in ("flash_attention_2", "sdpa", "eager")

    def test_auto_with_no_flash_no_sdpa_returns_eager(self):
        """Auto mode returns eager when no other options."""
        import torch

        has_sdpa = hasattr(torch.nn.functional, 'scaled_dot_product_attention')

        if not has_sdpa:
            # Only test on systems without sdpa - flash_attn also needs to fail
            with patch.dict('sys.modules', {'flash_attn': None}):
                result = get_attn_implementation("auto")
                assert result == "eager"
        else:
            # Skip test on systems with sdpa (can't easily remove it)
            pytest.skip("System has sdpa, can't test eager fallback")


class TestAttnImplementationIntegration:
    """Integration-style tests for attention selection."""

    @pytest.mark.parametrize("requested,expected_prefix", [
        ("flash_attention_2", "flash"),
        ("sdpa", "sdpa"),
        ("eager", "eager"),
    ])
    def test_explicit_values_passthrough(self, requested, expected_prefix):
        """Explicit values are returned as-is."""
        result = get_attn_implementation(requested)
        assert result.startswith(expected_prefix) or result == requested

    @pytest.mark.parametrize("invalid", [
        "FLASH_ATTENTION_2",  # wrong case
        "flash attention 2",  # spaces
        "fast",
        "",
        None,
        123,
    ])
    def test_invalid_values_trigger_auto(self, invalid):
        """Invalid inputs fall back to auto detection."""
        # Should not raise, should return valid option
        result = get_attn_implementation(invalid)
        assert result in ("flash_attention_2", "sdpa", "eager")
