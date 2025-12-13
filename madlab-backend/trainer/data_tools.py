import argparse
import json
import os
import pandas as pd
from datasets import load_dataset
import sys

def safe_open_w(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return open(path, 'w', encoding='utf-8')

def normalize_columns(row):
    # Suppress HF warnings
    import datasets
    datasets.logging.set_verbosity_error()

    # Mapping common names to input/target
    # Priority: instruction/input/output -> input/target
    # Priority: prompt/response -> input/target
    # Priority: act/prompt -> input/target (Awesome ChatGPT Prompts)
    
    inp = ""
    out = ""
    
    # Try to find input
    if 'input' in row and row['input']:
        inp = row['input']
        if 'instruction' in row and row['instruction']:
            inp = row['instruction'] + "\n" + inp
    elif 'instruction' in row:
        inp = row['instruction']
    elif 'act' in row: # Awesome ChatGPT Prompts pattern
        inp = f"Act as {row['act']}"
    elif 'prompt' in row: # Fallback if no 'response' key, might be input
        inp = row['prompt']
    
    # Try to find output
    if 'target' in row:
        out = row['target']
    elif 'output' in row:
        out = row['output']
    elif 'response' in row:
        out = row['response']
    elif 'prompt' in row and 'act' in row: # Awesome ChatGPT prompts match
        out = row['prompt']
        
    return {'input': str(inp).strip(), 'target': str(out).strip()}

def cmd_inspect(args):
    try:
        ds = load_dataset(args.repo, split=args.split, streaming=True)
        # Get first item
        item = next(iter(ds))
        print(json.dumps({"schema": list(item.keys()), "sample": item}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

def cmd_import(args):
    print(json.dumps({"message": f"Loading dataset {args.repo}..."}))
    
    transform_func = None
    if args.transform_script:
        try:
            # Safe-ish exec: define function in local scope
            # Script must define a function named 'transform_row'
            local_scope = {}
            exec(args.transform_script, {}, local_scope)
            transform_func = local_scope.get('transform_row')
            if not transform_func:
                raise ValueError("Script must define 'transform_row(row)'")
        except Exception as e:
            print(json.dumps({"error": f"Invalid transform script: {e}"}))
            sys.exit(1)
            
    try:
        ds = load_dataset(args.repo, split=args.split)

        outfile = os.path.join(args.out_dir, f"{args.repo.replace('/', '_')}.jsonl")

        count = 0
        skipped = 0
        with safe_open_w(outfile) as f:
            for item in ds:
                if transform_func:
                    try:
                        norm = transform_func(item)
                    except Exception as e:
                        skipped += 1
                        continue
                else:
                    norm = normalize_columns(item)

                if norm and norm.get('input') and norm.get('target'):
                    f.write(json.dumps(norm) + '\n')
                    count += 1
                else:
                    skipped += 1

        result = {"message": "Import successful", "filename": os.path.basename(outfile), "count": count}
        if skipped > 0:
            result["skipped"] = skipped
            print(json.dumps({"warning": f"Skipped {skipped} rows (missing input/target or transform error)"}))
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

def cmd_clean(args):
    print(json.dumps({"message": f"Cleaning {args.file}..."}))
    try:
        df = pd.read_json(args.file, lines=True)
        initial_count = len(df)
        
        # Deduplicate
        df.drop_duplicates(subset=['input', 'target'], inplace=True)
        
        # Remove empty
        df = df[df['input'].str.strip().astype(bool) & df['target'].str.strip().astype(bool)]
        
        final_count = len(df)
        
        df.to_json(args.file, orient='records', lines=True)
        
        print(json.dumps({"message": "Cleaning complete", "removed": initial_count - final_count, "count": final_count}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest='command')
    
    p_inspect = subparsers.add_parser('inspect')
    p_inspect.add_argument('--repo', required=True)
    p_inspect.add_argument('--split', default='train')
    
    p_import = subparsers.add_parser('import')
    p_import.add_argument('--repo', required=True)
    p_import.add_argument('--split', default='train')
    p_import.add_argument('--out_dir', required=True)
    p_import.add_argument('--transform_script', help="Python code defining transform_row(row)")
    
    p_clean = subparsers.add_parser('clean')
    p_clean.add_argument('--file', required=True)
    
    args = parser.parse_args()
    
    if args.command == 'inspect':
        cmd_inspect(args)
    elif args.command == 'import':
        cmd_import(args)
    elif args.command == 'clean':
        cmd_clean(args)
    else:
        parser.print_help()

if __name__ == '__main__':
    main()
