import argparse
import json
import os
import re
import pandas as pd
from datasets import load_dataset
import sys

def safe_open_w(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return open(path, 'w', encoding='utf-8')

def load_file(path: str) -> pd.DataFrame:
    """Load data from csv/parquet/json/jsonl by extension."""
    ext = os.path.splitext(path)[1].lower()
    if ext == '.csv':
        return pd.read_csv(path)
    elif ext == '.parquet':
        return pd.read_parquet(path)
    elif ext == '.json':
        return pd.read_json(path)
    elif ext == '.jsonl':
        return pd.read_json(path, lines=True)
    else:
        raise ValueError(f"Unsupported format: {ext}. Use .csv, .parquet, .json, or .jsonl")

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
    
    # Column mapping - predefined safe mappings only
    column_map = None
    if args.input_col or args.output_col:
        column_map = {
            'input': args.input_col,
            'output': args.output_col
        }
            
    try:
        ds = load_dataset(args.repo, split=args.split)

        outfile = os.path.join(args.out_dir, f"{args.repo.replace('/', '_')}.jsonl")

        count = 0
        skipped = 0
        with safe_open_w(outfile) as f:
            for item in ds:
                if column_map:
                    # Use explicit column mapping
                    inp = str(item.get(column_map['input'], '')).strip() if column_map['input'] else ''
                    out = str(item.get(column_map['output'], '')).strip() if column_map['output'] else ''
                    norm = {'input': inp, 'target': out}
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
            print(json.dumps({"warning": f"Skipped {skipped} rows (missing input/target)"}))
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

def cmd_clean(args):
    print(json.dumps({"message": f"Cleaning {args.file}..."}))
    try:
        df = load_file(args.file)
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

def cmd_profile(args):
    try:
        df = load_file(args.file)
        rows = len(df)
        duplicates = rows - len(df.drop_duplicates())
        
        # Count empty fields per column
        empty_counts = {col: int(df[col].isna().sum() + (df[col].astype(str).str.strip() == '').sum()) 
                        for col in df.columns}
        
        # Length stats for string columns
        length_stats = {}
        for col in df.columns:
            lengths = df[col].astype(str).str.len()
            length_stats[col] = {
                "min": int(lengths.min()),
                "max": int(lengths.max()),
                "avg": round(lengths.mean(), 1)
            }
        
        result = {
            "rows": rows,
            "columns": list(df.columns),
            "duplicates": duplicates,
            "empty_fields": empty_counts,
            "length_stats": length_stats
        }
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

DEFAULT_RULES = [
    {"field": "input", "check": "no_empty"},
    {"field": "target", "check": "no_empty"},
    {"field": "input", "check": "min_len", "value": 5},
    {"field": "target", "check": "min_len", "value": 5},
    {"field": "input", "check": "max_len", "value": 8000},
    {"field": "target", "check": "max_len", "value": 8000},
]

def cmd_validate(args):
    try:
        df = load_file(args.file)
        rules = json.load(open(args.rules)) if args.rules else DEFAULT_RULES
        violations = []
        seen = {}  # for no_duplicates check
        
        for idx, row in df.iterrows():
            row_num = idx + 1
            for rule in rules:
                field, check = rule["field"], rule["check"]
                val = str(row.get(field, ""))
                
                if check == "no_empty" and not val.strip():
                    violations.append({"row": row_num, "field": field, "check": check, "msg": "empty value"})
                elif check == "min_len" and len(val) < rule["value"]:
                    violations.append({"row": row_num, "field": field, "check": check, "msg": f"len {len(val)} < {rule['value']}"})
                elif check == "max_len" and len(val) > rule["value"]:
                    violations.append({"row": row_num, "field": field, "check": check, "msg": f"len {len(val)} > {rule['value']}"})
                elif check == "regex" and not re.search(rule["value"], val):
                    violations.append({"row": row_num, "field": field, "check": check, "msg": f"no match for /{rule['value']}/"})
                elif check == "no_duplicates":
                    key = (field, val)
                    if key in seen:
                        violations.append({"row": row_num, "field": field, "check": check, "msg": f"duplicate of row {seen[key]}"})
                    else:
                        seen[key] = row_num

        result = {"valid": len(violations) == 0, "rows": len(df), "violations": len(violations)}
        if violations:
            result["details"] = violations[:100]  # cap output
            if len(violations) > 100:
                result["truncated"] = True
        print(json.dumps(result))
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
    p_import.add_argument('--input_col', help="Column name to use as input")
    p_import.add_argument('--output_col', help="Column name to use as target/output")
    
    p_clean = subparsers.add_parser('clean')
    p_clean.add_argument('--file', required=True)
    
    p_profile = subparsers.add_parser('profile')
    p_profile.add_argument('--file', required=True)
    
    p_validate = subparsers.add_parser('validate')
    p_validate.add_argument('--file', required=True)
    p_validate.add_argument('--rules', help='JSON file with validation rules')
    
    args = parser.parse_args()
    
    if args.command == 'inspect':
        cmd_inspect(args)
    elif args.command == 'import':
        cmd_import(args)
    elif args.command == 'clean':
        cmd_clean(args)
    elif args.command == 'profile':
        cmd_profile(args)
    elif args.command == 'validate':
        cmd_validate(args)
    else:
        parser.print_help()

if __name__ == '__main__':
    main()
