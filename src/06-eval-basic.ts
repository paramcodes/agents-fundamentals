import Groq from "groq-sdk";


const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });


type EvalInput = {
  question: string;
  context: string;      // simulated retrieved chunk
  answer: string;       // simulated agent answer
}

type EvalResult = {
  score: number;          // 0 to 1
  reasoning: string;      // why this score
  unsupported_claims: string[];  // claims not found in context
}

async function evaluateFaithfullness({question,context,answer}:EvalInput): Promise<EvalResult> {

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `
            You are a judge, you are given Question that the user asks and the Context and the Answer that the models represents.
            you are gonna judge the output and reason how much grounded is the output considering the context. And gonna  return only JSON,no markdown,no backticks,nothing else, in the format given below:
            {
                "score": <number 0 to 1>,
                "reasoning":"<why this score>",
                "unsupported_claims":["<claims not found in context>",...]
            }
                
            Question:${question}
            Context:${context}
            Answer:${answer}
        ` },
      ],
    });
    
    let msg = await response.choices[0]?.message?.content;
    console.log(msg);
    return JSON.parse(msg);

}

// should score HIGH — answer is grounded
const case1 = {
  question: "What is the capital of France?",
  context: "France is a country in Western Europe. Its capital city is Paris, which is also its largest city.",
  answer: "The capital of France is Paris."
}

// should score LOW — answer adds info not in context  
const case2 = {
  question: "What is the capital of France?",
  context: "France is a country in Western Europe. Its capital city is Paris, which is also its largest city.",
  answer: "The capital of France is Paris, which has a population of 2.1 million and is known for the Eiffel Tower."
}

// should score ZERO — complete hallucination
const case3 = {
  question: "What is the boiling point of water?",
  context: "France is a country in Western Europe. Its capital city is Paris.",
  answer: "Water boils at 100 degrees Celsius at sea level."
}

console.log(await evaluateFaithfullness(case1));
console.log(await evaluateFaithfullness(case2));
console.log(await evaluateFaithfullness(case3));