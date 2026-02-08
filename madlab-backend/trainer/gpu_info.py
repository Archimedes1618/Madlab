#!/usr/bin/env python3
"""Get GPU info using PyTorch (matches CUDA device ordering used by training)."""
import json
import sys

def get_gpus():
    try:
        import torch
        gpus = []
        if torch.cuda.is_available():
            for i in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(i)
                # Get free memory (total - reserved)
                torch.cuda.set_device(i)
                free_mem = props.total_memory - torch.cuda.memory_reserved(i)
                gpus.append({
                    "index": i,
                    "name": props.name,
                    "memTotal": props.total_memory // (1024 * 1024),
                    "memFree": free_mem // (1024 * 1024),
                    "device": f"cuda:{i}"
                })
        return gpus
    except ImportError:
        return []
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        return []

if __name__ == "__main__":
    print(json.dumps(get_gpus()))
