import Groq from "groq-sdk";
import fs from 'fs/promises';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

type FileDiff = {
  filename: string;
  isNewFile: boolean;
  addedLines: string[];
  removedLines: string[];
}

function parseDiff(rawDiff: string): FileDiff[] {
  // your job: split the raw diff into per-file chunks
  // for each file, extract:
  //   - filename (from the +++ b/path line)
  //   - whether it's a new file (look for "new file mode")
  //   - all lines starting with + (excluding the +++ header line itself)
  //   - all lines starting with - (excluding the --- header line itself)
  const files = rawDiff.split(/(?=^diff --git )/m);
  const result: FileDiff[] = [];
  for(let file of files){
    if (!file.trim()) continue;
    const lines = file.split('\n');
    let filename = "";
    let isNewFile=false;
    let addedLines:string[]=[];
    let removedLines:string[]=[];
    for(let line of lines){
        if(line.startsWith('+++')){
            let parts = line.replace('+++ b/','').trim();
            filename = parts;
            continue;
        }
        if(line.startsWith('---')){
            continue;
        }
        if(line.startsWith('new file mode')){
            isNewFile = true;
            continue;
        }
        if(line.startsWith('+')){
            addedLines.push(line.slice(1));
            continue;
        }
        if(line.startsWith('-')){
            removedLines.push(line.slice(1));
            continue;
        }
    }
    if(filename)result.push({filename,isNewFile,addedLines,removedLines});
  }
  return result;
}

// const diff = await fs.readFile('tests/test.diff','utf-8');
const diff = await fs.readFile('tests/test2.diff','utf-8');

const output = parseDiff(diff);

// console.log(output);

async function styleReviewer(file: FileDiff): Promise<{
  filename: string;
  issues: string[];
}> {
  // plain LLM call, no tools needed — it already has the diff content
  // prompt: review the added lines for style/clarity issues
  // (naming, comments, dead code, overly long lines, etc.)
  // return structured issues, not prose

  const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `
            You are a codestyle reviewer. review the added lines for style/clarity issues
            (naming, comments, dead code, overly long lines, etc.)
            Only flag issues that are ACTUALLY present in the code below. Do not invent 
            issues. If there are no significant issues, return an empty issues array.
            
            Return structured issues, strictly in this JSON format, no markdown, no backticks:
        {
          "filename": "${file.filename}",
          "issues": [
            { "type": "<category>", "message": "<specific issue>", "line": <line number in addedLines> }
          ]
        }

        Filename: ${file.filename}
        Added lines:${file.addedLines.join('\n')}
        ` },
      ],
    });
    
    let msg = await response.choices[0]?.message?.content;
    const review = JSON.parse(msg ?? "{}");

    return review;
}

async function securityReviewer(file: FileDiff): Promise<{
  filename: string;
  issues: { type: string; message: string; line: number }[];
}> {
  // plain LLM call, no tools needed — it already has the diff content
  // prompt: review the added lines for style/clarity issues
  // (naming, comments, dead code, overly long lines, etc.)
  // return structured issues, not prose

  const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `
            You are a strict security reviewer. Flag an issue ONLY if there is a concrete, 
            exploitable security risk actually present in the code — not general best-practice 
            suggestions, not theoretical concerns, not "ensure this is handled properly" caveats.

            Valid issues look like: "Line 14 concatenates raw user input directly into a SQL 
            query string" or "Line 22 hardcodes the literal string 'sk-abc123...' as an API key."

            Invalid issues (do NOT flag these): using environment variables for secrets (this 
            is correct practice), missing input validation on non-security-critical internal 
            functions, generic "could be improved" suggestions.

            If you cannot point to a specific line with a specific exploitable mechanism, 
            return an empty issues array. Silence is the correct output for safe code.

            Return structured issues, strictly in this JSON format, no markdown, no backticks:
        {
          "filename": "${file.filename}",
          "issues": [
            { "type": "<category>", "message": "<specific issue>", "line": <line number in addedLines> }
          ]
        }

        Filename: ${file.filename}
        Added lines:${file.addedLines.join('\n')}
        ` },
      ],
    });
    
    let msg = await response.choices[0]?.message?.content;
    const review = JSON.parse(msg ?? "{}");

    return review;
}

async function performanceReviewer(file: FileDiff): Promise<{
  filename: string;
  issues: { type: string; message: string; line: number }[];
}> {

  const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `
            You are a performance reviewer. Review the given addedlines.
            (nested loops over large data, repeated expensive calls inside loops, unnecessary re-computation, blocking operations that should be async, N+1 query patterns, etc.)

            If you cannot point to a specific line with a specific issues, 
            return an empty issues array. Silence is the correct output for valid code.

            Return structured issues, strictly in this JSON format given below, no markdown, no backticks:
            {
                "filename": "${file.filename}",
                "issues": [
                    { "type": "<category>", "message": "<specific issue>", "line": <line number in addedLines> }
                ]
            }

            Filename: ${file.filename}
            Added lines:${file.addedLines.join('\n')}
        ` },
      ],
    });
    
    let msg = await response.choices[0]?.message?.content ?? "{}";
    // console.log(msg);
    msg = msg.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const review = JSON.parse(msg ?? "{}");

    return review;
}

async function testCoverageReviewer(
  file: FileDiff,
  allFiles: FileDiff[]   // the whole PR, so it can check for related test files
): Promise<{
  filename: string;
  issues: { type: string; message: string; line: number }[];
}> {
  // find files that look like tests (filename includes "test" or "spec")
  const testFiles = allFiles.filter(f => 
    f.filename.includes('test') || f.filename.includes('spec')
  );

    const testFilesContent = testFiles.map(f => 
        `File: ${f.filename}\n${f.addedLines.join('\n')}`
    ).join('\n\n---\n\n');

  // build context: does a test file exist that's plausibly related?
  // pass both the target file's new code AND any related test file content to the LLM
  // ask: are the new functions/logic in targetFile covered by the test files?

  const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `
            You are a testCoverage reviewer. Review the given addedlines.
            check does a test file exist that's plausibly related?, are the new functions/logic in targetFile covered by the test files?

            IMPORTANT: You are only shown lines newly ADDED in this PR, not the complete file. 
            Do not flag pre-existing functions as "untested" just because you don't see their 
            test in the new lines — they may already be tested elsewhere in the unchanged code. 
            Only flag genuinely NEW functions/logic introduced in this diff that lack 
            corresponding new tests.

            You only see lines newly ADDED in this diff, not full file contents. Only flag a 
            missing test if you can see a genuinely NEW function or significant new logic 
            block within these added lines that has no corresponding new test block also 
            present in these added lines. Do NOT comment on functions that are merely 
            imported/referenced — you have no visibility into whether they're tested elsewhere.

            If you cannot point to a specific line with a specific issues, 
            return an empty issues array. Silence is the correct output for valid code.

            Return structured issues, strictly in this JSON format given below, no markdown, no backticks:
            {
                "filename": "${file.filename}",
                "issues": [
                    { "type": "<category>", "message": "<specific issue>", "line": <line number in addedLines> }
                ]
            }

            Filename: ${file.filename}
            Added lines:${file.addedLines.join('\n')}
            testfiles: ${testFilesContent}
        ` },
      ],
    });
    
    let msg = await response.choices[0]?.message?.content ?? "{}";
    // console.log(msg);
    msg = msg.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const review = JSON.parse(msg ?? "{}");

    return review;
}

// for(let file of output){
//     const styleReview = await styleReviewer(file);
//     const securityReview = await securityReviewer(file);
//     const performanceReview = await performanceReviewer(file);
//     console.log(performanceReview);
//     console.log(await planReview(file));
// }


const allCriticVerdicts: CriticVerdict[] = [];

for (const file of output) {
  const plan = await planReview(file);
  console.log(`\n${file.filename} → running: ${plan.applicableReviewers.join(", ")}`);

  const reviewPromises: Promise<any>[] = [];

  if (plan.applicableReviewers.includes("style")) {
    reviewPromises.push(styleReviewer(file));
  }
  if (plan.applicableReviewers.includes("security")) {
    reviewPromises.push(securityReviewer(file));
  }
  if (plan.applicableReviewers.includes("performance")) {
    reviewPromises.push(performanceReviewer(file));
  }
  if(plan.applicableReviewers.includes("tests")) {
    reviewPromises.push(testCoverageReviewer(file,output));
  }

  const results = await Promise.all(reviewPromises);
//   console.log(results);
  const flatIssues = results.flatMap(r => r.issues ?? []);
//   console.log(`  → raw findings before critic:`, JSON.stringify(flatIssues, null, 2));
    const criticVerdict = await criticReview(file, flatIssues);
    allCriticVerdicts.push(criticVerdict);
    console.log(criticVerdict);
    // console.log(JSON.stringify(results, null, 2));
  }
  
  const comment = await writeReviewComment(allCriticVerdicts);
  console.log("\n=== FINAL PR COMMENT ===\n");
  console.log(comment);

type ReviewPlan = {
  filename: string;
  applicableReviewers: ("style" | "security" | "performance" | "tests")[];
}

async function planReview(file: FileDiff): Promise<ReviewPlan> {
  // given the filename and a snippet of content, decide which reviewers make sense
  // a .md file → probably just style
  // a .ts file with API calls → security + performance + style
  // a test file → just style + tests (no need for security review on test mocks)
  const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `
            You are a Planner agent. given the filename and a snippet of content, decide which reviewers make sense.
            a .md file → probably just style
            a .ts file with API calls → security + performance + style
            a test file → just style + tests (no need for security review on test mocks),etc.

            Return structured plan, strictly in this JSON format given below, no markdown, no backticks:
            {
                "filename": "${file.filename}",
                "applicableReviewers": [<"style" | "security" | "performance" | "tests">]
            }

            Filename: ${file.filename}
            code snippets: ${file.addedLines}
        ` },
      ],
    });
    
    let msg = await response.choices[0]?.message?.content ?? "{}";
    // console.log(msg);
    msg = msg.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const reviewplan = JSON.parse(msg ?? "{}");

    return reviewplan;
}

type CriticVerdict = {
  filename: string;
  trustworthyIssues: { type: string; message: string; line: number }[];
  rejectedIssues: { type: string; message: string; line: number; reason: string }[];
}

async function criticReview(
  file: FileDiff,
  allIssues: { type: string; message: string; line: number }[]
): Promise<CriticVerdict> {
  // given the actual added lines AND the reviewers' raw findings,
  // verify each finding is actually grounded in the real code
  // reject anything that references code/imports/lines not actually present

    const issuesText = JSON.stringify(allIssues, null, 2);
    const codeText = file.addedLines.join('\n');

  const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `
            You are a critic agent. given the actual added lines AND the reviewers' raw findings, verify each finding is actually grounded in the real code, eject anything that references code/imports/lines not actually present
            A finding can reference real code that exists in the added lines, but still be 
            UNTRUSTWORTHY if its conclusion isn't actually verifiable from what's shown. 
            For example: "function X is imported but not tested" is NOT verifiable just 
            because X appears in an import statement — the reviewer has no way to know if 
            X is tested elsewhere unless a test for X is also visible in the added lines. 
            Reject claims that assume something is missing/wrong based only on absence in 
            a partial view of the code, not absence in the full codebase.
            
            Return structured data, strictly in this JSON format given below, no markdown, no backticks:
            {
                "filename": "${file.filename}",
                "trustworthyIssues": [{ "type": "string", "message": "string", "line": number }],
                "rejectedIssues": [{ "type": "string", "message": "string", "line": number, "reason": "string" }]
            }

            Filename: ${file.filename}
            addedlines: ${codeText}
            reviewersfindings: ${issuesText}
        ` },
      ],
    });
    
    let msg = await response.choices[0]?.message?.content ?? "{}";
    msg = msg.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const review = JSON.parse(msg ?? "{}");

    return review;
}

async function writeReviewComment(
  allFiles: CriticVerdict
): Promise<string> {
  // synthesize into one PR comment, grouped by file, prioritized by severity
  const findingsText = allFiles
    .filter(f => f.trustworthyIssues.length > 0)  // skip files with nothing to say
    .map(f => `File: ${f.filename}\nIssues:\n${JSON.stringify(f.trustworthyIssues, null, 2)}`)
    .join('\n\n---\n\n');

  if (!findingsText) {
    return "✅ No issues found across the reviewed files.";
  }

  const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `
            You are a PR review agent. Given trustworthy findings grouped by file below, 
            write ONE coherent PR review comment. Group by file, prioritize the most 
            important issues first within each file, and use clear markdown formatting.

            This applies to ANY claim of the form "X is missing/unused/untested/uncalled" where 
            X exists in the visible code but its usage might simply be outside what you can see 
            (e.g., used elsewhere in the file, called from another file, tested in a part of 
            the test file not included in addedLines). The specific words used — "not tested," 
            "not used," "dead code," "unused import" — don't matter. What matters is: can you 
            ACTUALLY see, in the lines provided, proof that X is genuinely absent everywhere? 
            If not, reject the claim regardless of how it's phrased.

            Write only the comment text — no JSON, no markdown code fences around the 
            whole response, just the actual review comment a human would post on GitHub.

            Findings:
            ${findingsText}
        ` },
      ],
    });
    
    let msg = await response.choices[0]?.message?.content ?? "No comment generated.";
    // msg = msg.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const comment = msg;

    return comment;
}