import sys, json, os, argparse
from llama_cpp import Llama

def evaluate():
    parser = argparse.ArgumentParser()
    parser.add_argument("gguf_path")
    parser.add_argument("testset_path")
    parser.add_argument("out_path")
    parser.add_argument("--limit", type=float, default=1.0, help="Fraction of dataset to use (0.0-1.0)")
    args = parser.parse_args()

    gguf_path = args.gguf_path
    testset_path = args.testset_path
    out_path = args.out_path
    limit = args.limit

    print(json.dumps({"message": f"Loading GGUF model from {gguf_path}"}))
    
    try:
        # Load model with context size sufficient for the test
        llm = Llama(model_path=gguf_path, n_ctx=512, verbose=False)
    except Exception as e:
        print(json.dumps({"error": f"Failed to load model: {str(e)}"}))
        sys.exit(1)

    results = []
    
    if not os.path.exists(testset_path):
        print(json.dumps({"error": f"Test set not found at {testset_path}"}))
        sys.exit(1)

    with open(testset_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # Apply limit
    if limit < 1.0 and limit > 0:
        count = int(len(lines) * limit)
        count = max(1, count) # At least 1
        lines = lines[:count]
        print(json.dumps({"message": f"Limiting evaluation to {count} samples ({limit*100}%)"}))

    print(json.dumps({"message": f"Evaluating on {len(lines)} samples"}))

    correct_count = 0
    total_count = 0
    skipped_count = 0

    for i, line in enumerate(lines):
        if not line.strip(): continue

        # Safely parse JSON
        try:
            sample = json.loads(line)
        except json.JSONDecodeError as e:
            print(json.dumps({"warning": f"Skipping invalid JSON at line {i+1}: {str(e)}"}))
            skipped_count += 1
            continue

        prompt = sample.get("input", "")
        target = sample.get("target", "")
        
        # Simple prompt format compatible with the training
        # Training used: "Input: {input}\nOutput:"
        full_prompt = f"Input: {prompt}\nOutput:"
        
        try:
            output = llm(full_prompt, max_tokens=64, stop=["Input:", "\n"], echo=False)
            prediction = output["choices"][0]["text"].strip()
            
            is_correct = (prediction == target)
            if is_correct: correct_count += 1
            total_count += 1
            
            results.append({
                "input": prompt,
                "target": target,
                "output": prediction,
                "correct": is_correct
            })
            
            # Progress log every 10 samples
            if (i + 1) % 10 == 0:
                 print(json.dumps({"message": f"Processed {i+1}/{len(lines)} samples"}))

        except Exception as e:
            print(json.dumps({"error": f"Error on sample {i}: {str(e)}"}))

    accuracy = correct_count / total_count if total_count > 0 else 0
    report = {
        "accuracy": accuracy,
        "total_samples": total_count,
        "correct_samples": correct_count,
        "skipped_samples": skipped_count,
        "samples": results
    }

    if skipped_count > 0:
        print(json.dumps({"warning": f"Skipped {skipped_count} samples due to parse errors"}))

    # Ensure output dir exists
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    with open(out_path, "w", encoding='utf-8') as f:
        json.dump(report, f, indent=2)

    print(json.dumps({"message": "Evaluation complete", "report_path": out_path, "accuracy": accuracy}))

if __name__ == "__main__":
    evaluate()
