import sys, json, os, argparse
from llama_cpp import Llama
from nltk.translate.bleu_score import sentence_bleu, SmoothingFunction
from rouge_score import rouge_scorer

def compute_metrics(pred, target):
    if not pred or not target:
        return {"correct": pred == target, "bleu": 0.0, "rouge_l": 0.0}
    ref_tokens, pred_tokens = target.split(), pred.split()
    bleu = sentence_bleu([ref_tokens], pred_tokens, smoothing_function=SmoothingFunction().method1)
    scorer = rouge_scorer.RougeScorer(['rougeL'], use_stemmer=True)
    rouge_l = scorer.score(target, pred)['rougeL'].fmeasure
    return {"correct": pred == target, "bleu": bleu, "rouge_l": rouge_l}

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
        # Training uses: "Input: {input}\nOutput: " (with trailing space)
        full_prompt = f"Input: {prompt}\nOutput: "
        
        try:
            output = llm(full_prompt, max_tokens=64, stop=["Input:", "\n"], echo=False)
            prediction = output["choices"][0]["text"].strip()
            
            metrics = compute_metrics(prediction, target)
            if metrics["correct"]: correct_count += 1
            total_count += 1
            
            results.append({
                "input": prompt,
                "target": target,
                "output": prediction,
                **metrics
            })
            if hasattr(llm, 'reset'):
                llm.reset()
            # Progress log every 10 samples
            if (i + 1) % 10 == 0:
                 print(json.dumps({"message": f"Processed {i+1}/{len(lines)} samples"}))

        except Exception as e:
            print(json.dumps({"error": f"Error on sample {i}: {str(e)}"}))

    accuracy = correct_count / total_count if total_count > 0 else 0
    avg_bleu = sum(r["bleu"] for r in results) / len(results) if results else 0
    avg_rouge = sum(r["rouge_l"] for r in results) / len(results) if results else 0
    report = {
        "accuracy": accuracy,
        "bleu": avg_bleu,
        "rouge_l": avg_rouge,
        "total_samples": total_count,
        "correct_samples": correct_count,
        "skipped_samples": skipped_count,
        "samples": results
    }

    if skipped_count > 0:
        print(json.dumps({"warning": f"Skipped {skipped_count} samples due to parse errors"}))

    # Ensure output dir exists (if path has a directory component)
    out_dir = os.path.dirname(out_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    with open(out_path, "w", encoding='utf-8') as f:
        json.dump(report, f, indent=2)

    print(json.dumps({"message": "Evaluation complete", "report_path": out_path, "accuracy": accuracy, "bleu": avg_bleu, "rouge_l": avg_rouge}))

if __name__ == "__main__":
    evaluate()
