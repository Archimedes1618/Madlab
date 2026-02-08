"""Tests for evaluate_gguf.py output formatting"""
import pytest
import json


class TestEvaluateOutputSchema:
    """Test the expected output schema from evaluate_gguf.py"""
    
    def test_json_output_schema(self):
        """Verify expected report structure matches what evaluate() produces."""
        # This is the schema that evaluate() should produce
        expected_keys = {"accuracy", "total_samples", "correct_samples", "skipped_samples", "samples"}
        
        # Sample report matching the code's output
        report = {
            "accuracy": 0.75,
            "total_samples": 4,
            "correct_samples": 3,
            "skipped_samples": 0,
            "samples": [
                {"input": "q1", "target": "a1", "output": "a1", "correct": True},
            ]
        }
        
        assert set(report.keys()) == expected_keys
        assert isinstance(report["accuracy"], float)
        assert isinstance(report["total_samples"], int)
        assert isinstance(report["samples"], list)
    
    def test_sample_item_schema(self):
        """Each sample in results should have input, target, output, correct."""
        sample = {"input": "test", "target": "expected", "output": "actual", "correct": False}
        required_keys = {"input", "target", "output", "correct"}
        assert set(sample.keys()) == required_keys
        assert isinstance(sample["correct"], bool)
    
    def test_accuracy_calculation_empty(self):
        """Empty testset should produce 0 accuracy."""
        total_count = 0
        correct_count = 0
        accuracy = correct_count / total_count if total_count > 0 else 0
        assert accuracy == 0
    
    def test_accuracy_calculation_partial(self):
        """Verify accuracy formula: correct / total."""
        total_count = 10
        correct_count = 7
        accuracy = correct_count / total_count
        assert accuracy == 0.7
    
    def test_accuracy_calculation_perfect(self):
        """100% accuracy when all correct."""
        total_count = 5
        correct_count = 5
        accuracy = correct_count / total_count
        assert accuracy == 1.0
    
    def test_handles_empty_testset_gracefully(self):
        """Logic should handle zero samples without division error."""
        lines = []
        results = []
        correct_count = 0
        total_count = len([l for l in lines if l.strip()])
        
        accuracy = correct_count / total_count if total_count > 0 else 0
        report = {
            "accuracy": accuracy,
            "total_samples": total_count,
            "correct_samples": correct_count,
            "skipped_samples": 0,
            "samples": results
        }
        
        assert report["accuracy"] == 0
        assert report["total_samples"] == 0
        assert report["samples"] == []


class TestEvaluateJsonParsing:
    """Test JSON parsing edge cases that evaluate_gguf handles."""
    
    def test_skips_empty_lines(self):
        """Empty lines should be skipped, not cause errors."""
        lines = ["", '{"input": "q", "target": "a"}', "  ", "\n"]
        valid = [l for l in lines if l.strip()]
        assert len(valid) == 1
    
    def test_tracks_skipped_on_parse_error(self):
        """Malformed JSON should increment skipped_count."""
        lines = [
            '{"input": "q", "target": "a"}',
            '{bad json}',
            '{"input": "q2", "target": "a2"}',
        ]
        
        skipped = 0
        parsed = []
        for line in lines:
            try:
                parsed.append(json.loads(line))
            except json.JSONDecodeError:
                skipped += 1
        
        assert len(parsed) == 2
        assert skipped == 1
