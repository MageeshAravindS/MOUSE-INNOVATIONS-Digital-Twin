import os
from dotenv import load_dotenv
from ai.llm_client import generate_answer, _get_active_provider_and_key

load_dotenv(override=True)

provider, key = _get_active_provider_and_key()

print("=" * 60)
print("EduNexus AI Teacher — API Key Test")
print("=" * 60)
print(f"Active Provider : {provider}")
print(f"Key Detected    : {'YES (' + key[:8] + '...)' if key else 'NO'}")
print("=" * 60)

if not key:
    print("❌ No API key found. Please open backend/.env and paste your key.")
    exit(1)

print("\nConnecting to LLM and testing response...")

try:
    reply = generate_answer("Hello! In one short sentence, introduce yourself as the EduNexus lab instructor.")
    print("\n✅ SUCCESS! Response received from AI Teacher:\n")
    print(reply)
    print("\n" + "=" * 60)
    print("AI Chatbot is ready to chat!")
    print("=" * 60)
except Exception as e:
    print("\n❌ Error connecting to AI provider:")
    print(e)
    print("\n" + "=" * 60)
    print("Check backend/.env and verify your API key.")
    print("=" * 60)
