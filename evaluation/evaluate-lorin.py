import json
import os
import pandas as pd
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevance, context_precision, context_recall
from datasets import Dataset
from openai import OpenAI
import dotenv

dotenv.load_dotenv()

# We'll use OpenAI for the evaluation judge, via Vercel Gateway
# If it rate limits, we might need to rotate here too.
client = OpenAI(
    api_key=os.getenv("VERCEL_AI_KEY"),
    base_url="https://ai-gateway.vercel.sh/v1"
)

def run_eval():
    print("--- STARTING RAGAS EVALUATION ---")
    
    with open("data/ragas_input.json", "r") as f:
        data = json.load(f)
    
    # Ragas expects context to be a list of strings
    prepared_data = {
        "question": [d["question"] for d in data],
        "answer": [d["answer"] for d in data],
        "contexts": [[c] for d in data for c in d["contexts"][:3]], # Flatten slightly
        "ground_truth": [d["ground_truth"] for d in data]
    }
    
    # Fix contexts mapping (each question needs its list of contexts)
    prepared_data["contexts"] = [d["contexts"] for d in data]

    dataset = Dataset.from_dict(prepared_data)
    
    # Run evaluation
    result = evaluate(
        dataset,
        metrics=[
            faithfulness,
            answer_relevance,
            context_precision,
            context_recall,
        ],
    )
    
    print("\n--- EVALUATION RESULTS ---")
    print(result)
    
    df = result.to_pandas()
    df.to_csv("data/evaluation_results.csv", index=False)
    print("\n✅ Results saved to data/evaluation_results.csv")

if __name__ == "__main__":
    run_eval()
