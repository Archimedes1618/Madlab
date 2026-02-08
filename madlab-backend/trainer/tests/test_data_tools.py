"""Tests for data_tools.py - normalize_columns, cmd_clean logic"""
import pytest
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from data_tools import normalize_columns


class TestNormalizeColumns:
    def test_maps_instruction_input_output(self):
        row = {"instruction": "Tell me a joke", "input": "about cats", "output": "Why did the cat..."}
        result = normalize_columns(row)
        assert result["input"] == "Tell me a joke\nabout cats"
        assert result["target"] == "Why did the cat..."
    
    def test_instruction_only(self):
        row = {"instruction": "What is Python?", "output": "A programming language"}
        result = normalize_columns(row)
        assert result["input"] == "What is Python?"
        assert result["target"] == "A programming language"
    
    def test_maps_prompt_response(self):
        row = {"prompt": "Translate to French", "response": "Bonjour"}
        result = normalize_columns(row)
        assert result["input"] == "Translate to French"
        assert result["target"] == "Bonjour"
    
    def test_maps_act_prompt_pattern(self):
        # Awesome ChatGPT Prompts pattern: act describes role, prompt is the response
        row = {"act": "Linux Terminal", "prompt": "I want you to act as..."}
        result = normalize_columns(row)
        assert result["input"] == "Act as Linux Terminal"
        assert result["target"] == "I want you to act as..."
    
    def test_preserves_already_correct_columns(self):
        row = {"input": "Hello", "target": "World"}
        result = normalize_columns(row)
        assert result["input"] == "Hello"
        assert result["target"] == "World"
    
    def test_handles_missing_columns(self):
        row = {"random_field": "value"}
        result = normalize_columns(row)
        # Should return empty strings, not crash
        assert result["input"] == ""
        assert result["target"] == ""
    
    def test_handles_none_values(self):
        row = {"instruction": None, "output": "response"}
        result = normalize_columns(row)
        assert result["target"] == "response"
    
    def test_strips_whitespace(self):
        row = {"instruction": "  padded  ", "output": "  spaces  "}
        result = normalize_columns(row)
        assert result["input"] == "padded"
        assert result["target"] == "spaces"


class TestCmdCleanLogic:
    """Tests for the cleaning logic without actual file I/O using cmd_clean.
    
    We test the core logic by simulating what cmd_clean does with pandas.
    """
    
    def test_deduplicates_based_on_input_target(self):
        import pandas as pd
        data = [
            {"input": "A", "target": "1"},
            {"input": "A", "target": "1"},  # duplicate
            {"input": "B", "target": "2"},
        ]
        df = pd.DataFrame(data)
        df.drop_duplicates(subset=["input", "target"], inplace=True)
        assert len(df) == 2
    
    def test_removes_empty_rows(self):
        import pandas as pd
        data = [
            {"input": "Valid", "target": "Data"},
            {"input": "", "target": "Missing input"},
            {"input": "Missing target", "target": ""},
            {"input": "  ", "target": "Whitespace only"},
        ]
        df = pd.DataFrame(data)
        df = df[df["input"].str.strip().astype(bool) & df["target"].str.strip().astype(bool)]
        assert len(df) == 1
        assert df.iloc[0]["input"] == "Valid"
    
    def test_returns_correct_count(self):
        import pandas as pd
        data = [
            {"input": "A", "target": "1"},
            {"input": "A", "target": "1"},
            {"input": "B", "target": "2"},
            {"input": "", "target": "3"},
        ]
        df = pd.DataFrame(data)
        initial = len(df)
        df.drop_duplicates(subset=["input", "target"], inplace=True)
        df = df[df["input"].str.strip().astype(bool) & df["target"].str.strip().astype(bool)]
        removed = initial - len(df)
        assert removed == 2  # 1 duplicate + 1 empty
        assert len(df) == 2
    
    def test_cmd_clean_integration(self, tmp_path):
        """Full integration test using actual cmd_clean with temp file."""
        import pandas as pd
        from data_tools import cmd_clean
        from argparse import Namespace
        
        # Create test file - use string values for both columns
        test_file = tmp_path / "test.jsonl"
        data = [
            {"input": "Question A", "target": "Answer one"},
            {"input": "Question A", "target": "Answer one"},  # dup
            {"input": "Question B", "target": "Answer two"},
        ]
        with open(test_file, "w") as f:
            for row in data:
                f.write(json.dumps(row) + "\n")
        
        args = Namespace(file=str(test_file))
        cmd_clean(args)
        
        # Verify result
        df = pd.read_json(test_file, lines=True)
        assert len(df) == 2
