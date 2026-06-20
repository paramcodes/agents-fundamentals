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

const cases = [
    {
        question: "What is the capital of France?",
        context: "France is a country in Western Europe. Its capital city is Paris, which is also its largest city.",
        answer: "The capital of France is Paris."
    },
    {
        question: "What is the capital of France?",
        context: "France is a country in Western Europe. Its capital city is Paris, which is also its largest city.",
        answer: "The capital of France is Paris, which has a population of 2.1 million and is known for the Eiffel Tower."
    },
    {
        question: "What is the boiling point of water?",
        context: "France is a country in Western Europe. Its capital city is Paris.",
        answer: "Water boils at 100 degrees Celsius at sea level."
    },
    {
        question: "What is the capital of Delhi?",
        context: "Delhi is the capital of India.",
        answer: "Make america great again."
    },
    {
        question: "Why baby is crying?",
        context: "Baby is crying for 8hrs now, he hasn't got anything to drink foor hours now.",
        answer: "Baby likes to play."
    }
];

let verdict = [];
for(let c in cases){
    verdict.push(await evaluateFaithfullness(cases[c]));
}
let total_test_cases = verdict.length;
let passed_test_cases = 0;
let THRESOLD = 0.8;

for(let c in verdict){
    if(verdict[c]?.score >= THRESOLD)passed_test_cases++;
}

const summary = `
    Eval Report — Faithfulness
    ──────────────────────────
    ${verdict.map((v,ind)=>`
            case${ind+1}: ${v.score >= THRESOLD ? '✓ PASS' : '✗ FAIL'} score: ${v.score}  ${v.unsupported_claims.length > 0 ? `unsupported: [${v.unsupported_claims.map(c=>`"${c}"`)}]` : ''}
        `)}

    Results: ${passed_test_cases}/${total_test_cases} passed (${(passed_test_cases/total_test_cases)*100}%)
    Threshold: ${THRESOLD}
`;

console.log(summary);

if (passed_test_cases < total_test_cases) process.exit(1);