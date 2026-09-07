import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

print("Provider:", os.getenv("LLM_PROVIDER"))
print("Model:", os.getenv("GROQ_MODEL"))
print("Key:", os.getenv("GROQ_API_KEY")[:10] + "...")

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

try:
    response = client.chat.completions.create(
        model=os.getenv("GROQ_MODEL"),
        messages=[
            {
                "role": "user",
                "content": "Say Hello"
            }
        ]
    )

    print("\nSUCCESS!\n")
    print(response.choices[0].message.content)

except Exception as e:
    print("\nERROR TYPE:")
    print(type(e))
    print("\nERROR:")
    print(e)