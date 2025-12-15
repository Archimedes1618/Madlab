import sys
import subprocess
import time
import threading
import itertools

ASCII_ART = r"""
                             %%%%%%%%%%%%%%%%                              
                             %%========-==+%%                              
                             @%#==========#%@                              
                           @%%%%%%%%%%%%%%%%%%%                            
                           %%%%%%        @%%%%@                            
                              %%%   %%%@ %%@                               
                              %%%   %%%  %%%                               
                              %%% %%%    %%@                               
                              %%%%%#%@   %%%                               
                              %%%  % @%@ %%@                               
                             %%%    %%+%% %%%                              
                            %%%      %%%   %%%                             
                           %%%   %%%        %%%                            
                          %%%          @%@%@ %%%                           
                         %%%%%%%%%%%%%%#####%%%%%                          
                        %%+++++++++++++++++++++#%%%                        
                      @%%++++++++++++++%%%++++++*%%@                       
                     @%%+++++*%%#++++++#%++++++++*%%%                      
                    @%#+++++++*#+++++++++++*++++++*#%%                     
                    %%+++++++++++++++++++++*+++++++*%%                     
                    %%*+++++++++++++++++++++++++++*#%%                     
                     %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%                      
                                                                           
                                                                           
            @%@   @%%    @%@   @%%%@    @%       @%%   @%%@%@              
           @%%%   %%%   %%%%@  %%%%%%%  %%      @%%%%  @%%%%%%%            
           @%%%% %%%%  @%%@%%  %%%  %%% %%      %%@%%  @%%@ %%%            
           @%%%%@%@%%  %%%%%%  %%%  %%@ %%     @%% %%@ @%%%%%%             
           @%%@%%%@%% @%%%%%%% %%%  %%@ %%     %%%%%%% @%%@ %%%            
           @%% @% %%% %%%@@@%% %%%%%%%  %%%%%% %%@@@%%%@%%%%%%%            
            %%     %% %%    @% @%%%@    @%%%%@ %%   @%  %%%%%             
"""

def run_step(cmd, label):
    stop_event = threading.Event()
    spin_thread = threading.Thread(target=spinner, args=(label, stop_event))
    spin_thread.start()

    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
    finally:
        stop_event.set()
        spin_thread.join()

    if result.returncode == 0:
        print(f"{label:<30} | [✓] SUCCESS")
    else:
        last_err = result.stderr.splitlines()[-1] if result.stderr else "unknown error"
        print(f"{label:<30} | [✗] FAIL — {last_err}")
    return result.returncode


def spinner(label, stop_event):
    for c in itertools.cycle(['|', '/', '-', '\\']):
        if stop_event.is_set():
            break
        sys.stdout.write(f"\r{label:<30} | {c}")
        sys.stdout.flush()
        time.sleep(0.1)
    sys.stdout.write("\r" + " " * 50 + "\r")  # clear line

def main():
    # Render the static dashboard first (ASCII art + table + inline prompt)
    print(ASCII_ART)
    print("="*80)
    print("MADLAB CUDA INSTALLER".center(80))
    print("="*80)
    print(f"{'Index':<10}{'CUDA Version':<20}{'URL':<50}")
    print("-"*80)
    print(f"{'1':<10}{'cu118':<20}{'https://download.pytorch.org/whl/cu118':<50}")
    print(f"{'2':<10}{'cu121':<20}{'https://download.pytorch.org/whl/cu121':<50}")
    print(f"{'3':<10}{'cu124':<20}{'https://download.pytorch.org/whl/cu124':<50}")
    print(f"{'4':<10}{'cu126':<20}{'https://download.pytorch.org/whl/cu126':<50}")
    print("-"*80)
    choice = input("Select CUDA version [1-4]: ").strip()

    cuda_map = {
        "1": "https://download.pytorch.org/whl/cu118",
        "2": "https://download.pytorch.org/whl/cu121",
        "3": "https://download.pytorch.org/whl/cu124",
        "4": "https://download.pytorch.org/whl/cu126",
    }

    if choice not in cuda_map:
        print("Invalid selection. Exiting.")
        sys.exit(1)

    cuda_url = cuda_map[choice]
    print("="*80)
    print(f"Selected CUDA version: cu{cuda_url[-3:]}".center(80))
    print("="*80)

    # Step 1: Install PyTorch stack from the CUDA index
    torch_status = run_step([
        sys.executable, "-m", "pip", "install",
        "torch", "torchvision", "torchaudio",
        "--index-url", cuda_url
    ], "PyTorch (CUDA)")

    time.sleep(1)

    # Step 2: Install remaining requirements from PyPI
    other_status = run_step([
        sys.executable, "-m", "pip", "install", "-r", "requirements.txt"
    ], "Other requirements")

    

if __name__ == "__main__":

    main()
