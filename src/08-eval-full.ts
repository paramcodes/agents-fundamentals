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

type EvalResultRel = {
    score: number;
    reasoning: string;
    issues: string[];
}

type EvalResultCxt = {
    score: number;
    reasoning: string;
    missing_info: string[];
}

async function evaluateFaithfullness({question,context,answer}:EvalInput): Promise<EvalResult> {

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `
            You are a judge scoring how grounded an answer is in the given context.

            Special rule: if the answer honestly states that the context doesn't contain 
            the needed information (a refusal/deflection), and that statement is TRUE 
            given the context, score faithfulness as 1.0 — an honest "I don't know" is 
            maximally faithful, not unfaithful.

            Otherwise, score based on whether every claim in the answer is supported by context.

            Return raw JSON only no markdown,no backticks,nothing else,:
            {
            "score": <0 to 1>,
            "reasoning": "<why>",
            "unsupported_claims": ["<claims not found in context>"]
            }
                
            Question:${question}
            Context:${context}
            Answer:${answer}
        ` },
      ],
    });
    
    let msg = await response.choices[0]?.message?.content;
    // console.log(msg);
    return JSON.parse(msg);

}

async function evaluateAnswerRelevance({question,context,answer}:EvalInput):Promise<EvalResultRel>{
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `
            Given this question and answer, score how directly the answer addresses the question.
            A high score means the answer directly and completely addresses what was asked.
            A low score means the answer is vague, off-topic, or deflects.

            Return raw JSON only:
            {
            "score": <0 to 1>,
            "reasoning": "<why>",
            "issues": ["<specific ways the answer misses the question>"]
            }

            Question:${question}
            Context:${context}
            Answer:${answer}
        ` },
      ],
    });
    
    let msg = await response.choices[0]?.message?.content;
    // console.log(msg);
    return JSON.parse(msg);

}

async function evaluateContextRelevance({question,context,answer}:EvalInput):Promise<EvalResultCxt>{
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `
            Given this question and retrieved context, score how useful the context is for answering the question.
            A high score means the context contains information needed to answer the question.
            A low score means the context is irrelevant or doesn't help answer the question.

            Return raw JSON only:
            {
            "score": <0 to 1>,
            "reasoning": "<why>",
            "missing_info": ["<what info would be needed that isn't in context>"]
            }

            Question:${question}
            Context:${context}
            Answer:${answer}
        ` },
      ],
    });
    
    let msg = await response.choices[0]?.message?.content;
    // console.log(msg);
    return JSON.parse(msg);

}

const cases = [
    // case A: perfect — grounded, relevant, good context
    {
    question: "What causes monsoon in India?",
    context: "The Indian monsoon is caused by differential heating between land and sea. In summer, the land heats faster than the ocean, creating low pressure over the subcontinent that draws in moisture-laden winds from the Indian Ocean.",
    answer: "Monsoon in India is caused by differential heating between land and ocean. The land heats faster in summer, creating low pressure that pulls moist winds from the Indian Ocean."
    },

    // case B: bad retrieval — context is useless for the question
    {
    question: "What causes monsoon in India?",
    context: "India has a population of 1.4 billion people. It is the seventh largest country by area and has 28 states.",
    answer: "I cannot find specific information about monsoon causes in the provided context."
    },

    // case C: hallucination — good context but agent ignored it
    {
    question: "What causes monsoon in India?",
    context: "The Indian monsoon is caused by differential heating between land and sea.",
    answer: "Monsoon in India is caused by the rotation of the Earth and gravitational pull of the moon on ocean tides."
    }
];

type FullEvalResult = {
  faithfulness: EvalResult;
  answerRelevance: { score: number; reasoning: string; issues: string[] };
  contextRelevance: { score: number; reasoning: string; missing_info: string[] };
  overall: number;  // average of all three scores
}

async function evaluateAll(input: EvalInput): Promise<FullEvalResult> {
  const [faithfulness, answerRelevance, contextRelevance] = await Promise.all([
    evaluateFaithfullness(input),
    evaluateAnswerRelevance(input),
    evaluateContextRelevance(input)
  ]);

  const overall = (faithfulness.score + answerRelevance.score + contextRelevance.score) / 3;

  return { faithfulness, answerRelevance, contextRelevance, overall };
}

let verdict = [];
for(let c in cases){
    verdict.push(await evaluateAll(cases[c]));
}

const THRESOLD = 0.8;

const summary = `
    Eval Report — Faithfulness
    ──────────────────────────
    ${verdict.map((v,ind)=>`
            case${ind+1}: ${v.faithfulness.score >= THRESOLD ? '✓ PASS' : '✗ FAIL'} score: ${v.faithfulness.score}  ${v.faithfulness.unsupported_claims.length > 0 ? `unsupported: [${v.faithfulness.unsupported_claims.map(c=>`"${c}"`)}]` : ''}
        `)}

    Eval Report — Answer Relevance
    ──────────────────────────────
    ${verdict.map((v,ind)=>`
        case${ind+1}: ${v.answerRelevance.score >= THRESOLD ? '✓ PASS' : '✗ FAIL'} score: ${v.answerRelevance.score}  ${v.answerRelevance.issues.length > 0 ? `issues: [${v.answerRelevance.issues.map(c=>`"${c}"`)}]` : ''}
    `)}

    Eval Report — Context Relevance
    ───────────────────────────────
    ${verdict.map((v,ind)=>`
        case${ind+1}: ${v.contextRelevance.score >= THRESOLD ? '✓ PASS' : '✗ FAIL'} score: ${v.contextRelevance.score}  ${v.contextRelevance.missing_info.length > 0 ? `missinginfo: [${v.contextRelevance.missing_info.map(c=>`"${c}"`)}]` : ''}
    `)}

    Eval Report — Overall
    ─────────────────────
    ${verdict.map((v,ind)=>`
        case${ind+1}: Overall Score: ${v.overall}    
    `)}
`;

console.log(summary);
