"""
backend/training/train_qlora.py

Lightweight 4-bit QLoRA Fine-tuning Script for EduNexus AI Lab Instructor.
Optimized specifically for the NVIDIA GeForce RTX 2050 Laptop GPU (4GB VRAM).

Constraints honored:
- 4-bit NormalFloat (NF4) quantization via bitsandbytes
- Micro batch size = 1, gradient accumulation = 4
- LoRA rank r = 8, alpha = 16 (parameter efficient: <0.5% trainable parameters)
- Maximum sequence length = 1024 (avoids VRAM spill on 4GB hardware)
- Gradient checkpointing and 8-bit paged AdamW optimizer
"""

import os
import sys
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_PATH = BASE_DIR / "data" / "edunexus_train.jsonl"
EVAL_PATH = BASE_DIR / "data" / "edunexus_eval.jsonl"
OUTPUT_DIR = BASE_DIR / "models" / "edunexus_qwen3_lora"

# Hyperparameters tuned for 4GB RTX 2050
MODEL_ID = os.getenv("BASE_MODEL_ID", "Qwen/Qwen2.5-3B-Instruct")
MAX_SEQ_LENGTH = 1024
LORA_R = 8
LORA_ALPHA = 16
LORA_DROPOUT = 0.05
LEARNING_RATE = 2e-4
BATCH_SIZE = 1
GRAD_ACCUM = 4
NUM_EPOCHS = 3


def check_gpu():
    """Verify GPU memory before training."""
    try:
        import torch
        if not torch.cuda.is_available():
            print("WARNING: CUDA is not available. QLoRA requires an NVIDIA GPU with CUDA.")
            return False
        gpu_name = torch.cuda.get_device_name(0)
        total_vram_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
        print(f"Detected GPU: {gpu_name} ({total_vram_gb:.2f} GB VRAM)")
        if total_vram_gb < 3.8:
            print("WARNING: GPU has < 4GB VRAM. Training may require CPU offloading.")
        return True
    except ImportError:
        print("PyTorch not installed in this environment.")
        return False


def run_training_prep():
    print("=" * 60)
    print("EDUNEXUS QWEN3 QLORA TRAINING PIPELINE")
    print(f"Target Hardware: NVIDIA GeForce RTX 2050 (4GB VRAM)")
    print(f"Base Model:      {MODEL_ID}")
    print(f"Dataset Train:   {DATA_PATH}")
    print(f"Dataset Eval:    {EVAL_PATH}")
    print(f"Output Adapter:  {OUTPUT_DIR}")
    print("=" * 60)

    if not DATA_PATH.exists():
        print(f"Error: Dataset not found at {DATA_PATH}. Run generate_dataset.py first.")
        return

    # Check GPU and CUDA availability
    if not check_gpu():
        print("\n" + "!" * 60)
        print("CUDA GPU ACCELERATION REQUIRED FOR 4-BIT QLORA TRAINING")
        print("!" * 60)
        print("Your system is running Python 3.14 with CPU-only PyTorch.")
        print("PyTorch + CUDA wheels (needed by bitsandbytes for 4-bit) require Python <= 3.12.")
        print("\nTo train on your RTX 2050 Laptop GPU:")
        print("  1. Install Python 3.11 or 3.12 from python.org")
        print("  2. Create a training venv: py -3.11 -m venv .venv_train")
        print("  3. Activate & install PyTorch CUDA:")
        print("     .\\.venv_train\\Scripts\\activate")
        print("     pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121")
        print("     pip install transformers peft bitsandbytes datasets trl accelerate")
        print("  4. Run: python backend/training/train_qlora.py")
        print("\nAlternatively, you can run training on Google Colab (Free T4 GPU, ~4 mins):")
        print("  See backend/training/README_TRAINING.md for instructions.")
        print("!" * 60 + "\n")
        return

    # Check dependencies
    missing = []
    for pkg in ["torch", "transformers", "peft", "bitsandbytes", "datasets", "trl"]:
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)

    if missing:
        print(f"\nMissing required fine-tuning packages: {', '.join(missing)}")
        print("To install all dependencies on the training workstation, run:")
        print("  pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121")
        print("  pip install transformers peft bitsandbytes datasets trl accelerate")
        print("\nSee backend/training/README_TRAINING.md for the complete execution guide.")
        return

    import torch
    from datasets import load_dataset
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TrainingArguments
    from trl import SFTTrainer

    print("\n1. Configuring 4-bit Quantization (NF4)...")
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )

    print(f"2. Loading Base Model: {MODEL_ID}...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
    )

    print("3. Setting up LoRA Adapter Config...")
    model = prepare_model_for_kbit_training(model)
    lora_config = LoraConfig(
        r=LORA_R,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    print("4. Loading Dataset...")
    dataset = load_dataset("json", data_files={"train": str(DATA_PATH), "eval": str(EVAL_PATH)})

    training_args = TrainingArguments(
        output_dir=str(OUTPUT_DIR),
        per_device_train_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRAD_ACCUM,
        learning_rate=LEARNING_RATE,
        num_train_epochs=NUM_EPOCHS,
        fp16=True,
        logging_steps=5,
        save_strategy="epoch",
        evaluation_strategy="epoch",
        optim="paged_adamw_8bit",
        max_grad_norm=0.3,
        warmup_ratio=0.03,
        lr_scheduler_type="cosine",
    )

    trainer = SFTTrainer(
        model=model,
        train_dataset=dataset["train"],
        eval_dataset=dataset["eval"],
        peft_config=lora_config,
        dataset_text_field="messages",
        max_seq_length=MAX_SEQ_LENGTH,
        tokenizer=tokenizer,
        args=training_args,
    )

    print("\n5. Starting Training...")
    trainer.train()

    print(f"\n6. Saving LoRA adapter to {OUTPUT_DIR}...")
    trainer.model.save_pretrained(str(OUTPUT_DIR))
    tokenizer.save_pretrained(str(OUTPUT_DIR))
    print("Training finished successfully!")


if __name__ == "__main__":
    run_training_prep()
