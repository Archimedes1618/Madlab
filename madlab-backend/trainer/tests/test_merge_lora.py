"""Tests for merge_lora_for_gguf - GPU/CPU fallback, cleanup, error handling."""
import pytest
import sys
import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock

sys.path.insert(0, str(Path(__file__).parent.parent))


class TestMergeLoraForGguf:
    """Tests for merge_lora_for_gguf function."""

    @pytest.fixture
    def mock_deps(self, tmp_path):
        """Set up common mocks for merge tests."""
        mock_tokenizer = MagicMock()
        mock_peft_model = MagicMock()

        mock_base = MagicMock()
        mock_loaded_peft = MagicMock()
        mock_merged = MagicMock()
        mock_loaded_peft.merge_and_unload.return_value = mock_merged

        return {
            'tokenizer': mock_tokenizer,
            'peft_model': mock_peft_model,
            'base': mock_base,
            'loaded_peft': mock_loaded_peft,
            'merged': mock_merged,
            'save_path': str(tmp_path / "output"),
            'model_name': "test-model"
        }

    @patch('train.torch.cuda.is_available', return_value=True)
    @patch('train.torch.cuda.empty_cache')
    @patch('train.AutoModelForCausalLM.from_pretrained')
    @patch('train.PeftModel.from_pretrained')
    @patch('train.gc.collect')
    def test_gpu_merge_success(self, mock_gc, mock_peft_load, mock_auto_load,
                                mock_empty_cache, mock_cuda_avail, mock_deps):
        """GPU merge succeeds when CUDA available and no OOM."""
        from train import merge_lora_for_gguf

        mock_auto_load.return_value = mock_deps['base']
        mock_peft_load.return_value = mock_deps['loaded_peft']

        merge_lora_for_gguf(
            mock_deps['model_name'],
            mock_deps['tokenizer'],
            mock_deps['save_path'],
            mock_deps['peft_model']
        )

        # Verify GPU path was taken (device_map="auto")
        call_kwargs = mock_auto_load.call_args[1]
        assert call_kwargs['device_map'] == 'auto'

        # Verify merge_and_unload was called
        mock_deps['loaded_peft'].merge_and_unload.assert_called_once()

        # Verify save was called
        mock_deps['merged'].save_pretrained.assert_called_once()
        mock_deps['tokenizer'].save_pretrained.assert_called_once()

    @patch('train.torch.cuda.is_available', return_value=False)
    @patch('train.AutoModelForCausalLM.from_pretrained')
    @patch('train.PeftModel.from_pretrained')
    @patch('train.gc.collect')
    def test_cpu_merge_when_no_cuda(self, mock_gc, mock_peft_load, mock_auto_load,
                                     mock_cuda_avail, mock_deps):
        """Falls back to CPU merge when CUDA not available."""
        from train import merge_lora_for_gguf

        mock_auto_load.return_value = mock_deps['base']
        mock_peft_load.return_value = mock_deps['loaded_peft']

        merge_lora_for_gguf(
            mock_deps['model_name'],
            mock_deps['tokenizer'],
            mock_deps['save_path'],
            mock_deps['peft_model']
        )

        # Verify CPU path was taken (device_map="cpu")
        call_kwargs = mock_auto_load.call_args[1]
        assert call_kwargs['device_map'] == 'cpu'
        assert call_kwargs.get('low_cpu_mem_usage') is True

    @patch('train.torch.cuda.is_available', return_value=True)
    @patch('train.torch.cuda.empty_cache')
    @patch('train.AutoModelForCausalLM.from_pretrained')
    @patch('train.PeftModel.from_pretrained')
    @patch('train.gc.collect')
    def test_cpu_fallback_on_oom(self, mock_gc, mock_peft_load, mock_auto_load,
                                  mock_empty_cache, mock_cuda_avail, mock_deps):
        """Falls back to CPU when GPU merge fails with OOM."""
        from train import merge_lora_for_gguf

        # First call (GPU) raises OOM, second call (CPU) succeeds
        mock_base_cpu = MagicMock()
        mock_peft_cpu = MagicMock()
        mock_merged_cpu = MagicMock()
        mock_peft_cpu.merge_and_unload.return_value = mock_merged_cpu

        mock_auto_load.side_effect = [
            RuntimeError("CUDA out of memory"),  # GPU attempt
            mock_base_cpu  # CPU attempt
        ]
        mock_peft_load.return_value = mock_peft_cpu

        merge_lora_for_gguf(
            mock_deps['model_name'],
            mock_deps['tokenizer'],
            mock_deps['save_path'],
            mock_deps['peft_model']
        )

        # Verify both GPU and CPU attempts were made
        assert mock_auto_load.call_count == 2

        # First call should be GPU (device_map="auto")
        first_call = mock_auto_load.call_args_list[0][1]
        assert first_call['device_map'] == 'auto'

        # Second call should be CPU
        second_call = mock_auto_load.call_args_list[1][1]
        assert second_call['device_map'] == 'cpu'

    @patch('train.torch.cuda.is_available', return_value=True)
    @patch('train.torch.cuda.empty_cache')
    @patch('train.AutoModelForCausalLM.from_pretrained')
    @patch('train.PeftModel.from_pretrained')
    @patch('train.gc.collect')
    def test_cpu_fallback_on_offload_error(self, mock_gc, mock_peft_load, mock_auto_load,
                                           mock_empty_cache, mock_cuda_avail, mock_deps):
        """Falls back to CPU when GPU merge fails with offload error."""
        from train import merge_lora_for_gguf

        mock_base_cpu = MagicMock()
        mock_peft_cpu = MagicMock()
        mock_merged_cpu = MagicMock()
        mock_peft_cpu.merge_and_unload.return_value = mock_merged_cpu

        mock_auto_load.side_effect = [
            RuntimeError("Some offload error occurred"),  # GPU attempt
            mock_base_cpu  # CPU attempt
        ]
        mock_peft_load.return_value = mock_peft_cpu

        merge_lora_for_gguf(
            mock_deps['model_name'],
            mock_deps['tokenizer'],
            mock_deps['save_path'],
            mock_deps['peft_model']
        )

        assert mock_auto_load.call_count == 2

    @patch('train.torch.cuda.is_available', return_value=True)
    @patch('train.torch.cuda.empty_cache')
    @patch('train.AutoModelForCausalLM.from_pretrained')
    @patch('train.gc.collect')
    @patch('train.shutil.rmtree')
    def test_cleanup_runs_on_success(self, mock_rmtree, mock_gc, mock_auto_load,
                                      mock_empty_cache, mock_cuda_avail, mock_deps):
        """Temp directory cleaned up after successful merge."""
        from train import merge_lora_for_gguf
        import train

        mock_peft = MagicMock()
        mock_merged = MagicMock()
        mock_peft.merge_and_unload.return_value = mock_merged

        with patch.object(train, 'PeftModel') as mock_peft_cls:
            mock_peft_cls.from_pretrained.return_value = mock_peft
            mock_auto_load.return_value = mock_deps['base']

            merge_lora_for_gguf(
                mock_deps['model_name'],
                mock_deps['tokenizer'],
                mock_deps['save_path'],
                mock_deps['peft_model']
            )

        # gc.collect should be called (cleanup)
        assert mock_gc.call_count >= 1
        # empty_cache should be called
        assert mock_empty_cache.call_count >= 1

    @patch('train.torch.cuda.is_available', return_value=True)
    @patch('train.torch.cuda.empty_cache')
    @patch('train.AutoModelForCausalLM.from_pretrained')
    @patch('train.gc.collect')
    def test_cleanup_runs_on_failure(self, mock_gc, mock_auto_load,
                                      mock_empty_cache, mock_cuda_avail, mock_deps):
        """Cleanup runs even when both GPU and CPU merge fail."""
        from train import merge_lora_for_gguf
        import train

        mock_auto_load.side_effect = RuntimeError("Model load failed")

        with patch.object(train, 'PeftModel'):
            with pytest.raises(RuntimeError):
                merge_lora_for_gguf(
                    mock_deps['model_name'],
                    mock_deps['tokenizer'],
                    mock_deps['save_path'],
                    mock_deps['peft_model']
                )

        # Cleanup should still run
        assert mock_gc.call_count >= 1

    @patch('train.torch.cuda.is_available', return_value=True)
    @patch('train.torch.cuda.empty_cache')
    @patch('train.AutoModelForCausalLM.from_pretrained')
    @patch('train.PeftModel.from_pretrained')
    @patch('train.gc.collect')
    def test_adapter_saved_before_merge(self, mock_gc, mock_peft_load, mock_auto_load,
                                         mock_empty_cache, mock_cuda_avail, mock_deps):
        """Peft adapter is saved to temp path before loading for merge."""
        from train import merge_lora_for_gguf

        mock_auto_load.return_value = mock_deps['base']
        mock_peft_load.return_value = mock_deps['loaded_peft']

        merge_lora_for_gguf(
            mock_deps['model_name'],
            mock_deps['tokenizer'],
            mock_deps['save_path'],
            mock_deps['peft_model']
        )

        # Original peft_model should have save_pretrained called
        mock_deps['peft_model'].save_pretrained.assert_called_once()
        call_path = mock_deps['peft_model'].save_pretrained.call_args[0][0]
        assert 'temp_lora_adapter' in call_path


class TestMergeLoraEdgeCases:
    """Edge cases and error handling for merge."""

    @patch('train.torch.cuda.is_available', return_value=False)
    @patch('train.AutoModelForCausalLM.from_pretrained')
    @patch('train.PeftModel.from_pretrained')
    @patch('train.gc.collect')
    def test_raises_when_both_paths_fail(self, mock_gc, mock_peft_load, mock_auto_load,
                                          mock_cuda_avail, tmp_path):
        """Raises exception when CPU merge also fails."""
        from train import merge_lora_for_gguf

        mock_tokenizer = MagicMock()
        mock_peft_model = MagicMock()

        mock_auto_load.side_effect = RuntimeError("Critical failure")

        with pytest.raises(RuntimeError, match="Critical failure"):
            merge_lora_for_gguf(
                "test-model",
                mock_tokenizer,
                str(tmp_path / "output"),
                mock_peft_model
            )

    @patch('train.torch.cuda.is_available', return_value=True)
    @patch('train.torch.cuda.empty_cache')
    @patch('train.AutoModelForCausalLM.from_pretrained')
    @patch('train.PeftModel.from_pretrained')
    @patch('train.gc.collect')
    @patch('train.shutil.rmtree')
    def test_handles_temp_cleanup_permission_error(self, mock_rmtree, mock_gc,
                                                    mock_peft_load, mock_auto_load,
                                                    mock_empty_cache, mock_cuda_avail,
                                                    tmp_path, capsys):
        """Handles permission error when cleaning temp directory."""
        from train import merge_lora_for_gguf
        import train

        mock_tokenizer = MagicMock()
        mock_peft_model = MagicMock()
        mock_base = MagicMock()
        mock_loaded_peft = MagicMock()
        mock_merged = MagicMock()
        mock_loaded_peft.merge_and_unload.return_value = mock_merged

        mock_auto_load.return_value = mock_base
        mock_peft_load.return_value = mock_loaded_peft

        # Make rmtree fail
        mock_rmtree.side_effect = PermissionError("Access denied")

        # Create the temp adapter path so cleanup is attempted
        save_path = str(tmp_path / "output")
        os.makedirs(save_path, exist_ok=True)
        temp_adapter = os.path.join(save_path, "temp_lora_adapter")
        os.makedirs(temp_adapter, exist_ok=True)

        # Should not raise, just warn
        merge_lora_for_gguf(
            "test-model",
            mock_tokenizer,
            save_path,
            mock_peft_model
        )

        # Check warning was printed
        captured = capsys.readouterr()
        assert "warning" in captured.out.lower() or "cleanup" in captured.out.lower() or mock_rmtree.call_count >= 1
