import argparse
import sys
import subprocess
import os

def install_pytorch(cuda_version, is_cpu):
    """Installs PyTorch based on CUDA version or CPU preference with version fallback."""
    index_url = "https://download.pytorch.org/whl/"
    
    # Define our target and fallback versions
    TARGET_VERSION = "2.9.1"
    FALLBACK_VERSION = "2.6.0" 

    if is_cpu:
        print("Installing PyTorch (CPU version)...", flush=True)
        torch_spec = f"torch=={TARGET_VERSION}"
        tag = "cpu"
    else:
        # Map version string -> (tag, allowed_torch_version)
        # We cap older CUDA toolkits at 2.6.0 because 2.9.1 wheels don't exist for them.
        version_config = {
            "11.8": ("cu118", FALLBACK_VERSION),
            "12.1": ("cu121", "2.5.1"), # 12.1 stops at 2.5.1
            "12.4": ("cu124", FALLBACK_VERSION),
            "12.6": ("cu126", TARGET_VERSION),
            "12.8": ("cu128", TARGET_VERSION),
            "13.0": ("cu130", TARGET_VERSION)
        }
        
        config = version_config.get(cuda_version)
        
        if config:
            tag, torch_v = config
        else:
            # Dynamic fallback for unknown versions
            tag = f"cu{cuda_version.replace('.', '')}"
            torch_v = TARGET_VERSION
            print(f"Warning: Exact mapping for {cuda_version} not found. Attempting tag {tag} with {torch_v}", flush=True)

        torch_spec = f"torch=={torch_v}"
        print(f"Installing PyTorch ({torch_spec} for CUDA {cuda_version})...", flush=True)

    cmd = [
        sys.executable, "-m", "pip", "install",
        torch_spec, "torchvision", "torchaudio",
        "--index-url", f"{index_url}{tag}"
    ]

    try:
        subprocess.check_call(cmd)
        print("PyTorch installed successfully.", flush=True)
    except subprocess.CalledProcessError as e:
        print(f"Error: Failed to install PyTorch. {e}", flush=True)
        sys.exit(1)

def install_requirements():
    """Installs other dependencies from requirements.txt."""
    print("Installing additional dependencies...", flush=True)
    req_file = os.path.join(os.path.dirname(__file__), "requirements.txt")
    
    if not os.path.exists(req_file):
        print(f"Error: requirements.txt not found at {req_file}", flush=True)
        sys.exit(1)
        
    cmd = [sys.executable, "-m", "pip", "install", "-r", req_file]
    
    try:
        subprocess.check_call(cmd)
        print("Dependencies installed successfully.", flush=True)
    except subprocess.CalledProcessError as e:
        print(f"Error: Failed to install dependencies. {e}", flush=True)
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="Electron-triggered Setup Script")
    parser.add_argument("--cuda", help="CUDA version (e.g., 11.8, 12.1)")
    parser.add_argument("--cpu-only", action="store_true", help="Force CPU installation")
    
    args = parser.parse_args()
    
    # Validation
    if not args.cuda and not args.cpu_only:
        print("Error: Must provide either --cuda or --cpu-only", flush=True)
        sys.exit(1)

    try:
        install_pytorch(args.cuda, args.cpu_only)
        install_requirements()
        print("Setup complete.", flush=True)
        sys.exit(0)
    except Exception as e:
        print(f"Error: Unexpected failure: {e}", flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
