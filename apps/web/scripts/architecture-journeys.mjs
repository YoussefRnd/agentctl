import { journeyIds } from './performance-journeys.mjs';

const file = {
  path: 'src/architecture-example.ts',
  state: 'modified',
  additions: 1,
  deletions: 1,
  hasUnstagedChanges: true,
  hasStagedChanges: false,
  diff: '@@ -1,1 +1,1 @@\n-export const value = 1;\n+export const value = 2;',
};
export function createArchitectureFixture() {
  return {
    review: {
      files: [file],
      capture: {
        current: 'revision:current',
        working: 'revision:working',
        baseline: 'revision:baseline',
      },
    },
  };
}

/** Exercises composed production UI against synthetic APIs, with no agent or backend mutation. */
export async function runArchitectureJourneys({ evaluate, origin, send, api, errors }) {
  const waitFor = async (expression) => {
    const deadline = Date.now() + 20000;
    while (!(await evaluate(`Boolean(${expression})`))) {
      if (errors.length || api.failures.length)
        throw new Error([...errors, ...api.failures].join('\n'));
      if (Date.now() > deadline)
        throw new Error(
          `Architecture journey timed out: ${expression}\n${await evaluate('document.body.innerText.slice(-6000)')}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  const click = async (selector) => {
    await waitFor(`document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  await send('Page.navigate', { url: `${origin}/sessions/${journeyIds[0]}` });
  await waitFor(
    "document.querySelector('textarea:not(:disabled)') && document.body.textContent.includes('Journey 0 answer 199')",
  );
  const draft = 'Keep the architecture review draft';
  await evaluate(
    `(() => {const input = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input, ${JSON.stringify(draft)}); input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await click(`a[href='/sessions/${journeyIds[1]}']`);
  await waitFor("document.body.textContent.includes('Journey 1 answer 199')");
  await click(`a[href='/sessions/${journeyIds[0]}']`);
  await waitFor(`document.querySelector('textarea')?.value === ${JSON.stringify(draft)}`);
  await click('button[title="View modified files in review"]');
  await waitFor("document.querySelector('[data-review-file]')");
  await evaluate(
    `document.querySelector('[aria-label="More actions for ${file.path}"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
  );
  await waitFor(
    "[...document.querySelectorAll('[role=menuitem]')].some(item => item.textContent.includes('Add to chat'))",
  );
  await evaluate(
    "[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent.includes('Add to chat')).click()",
  );
  await waitFor(
    "document.body.textContent.includes('architecture-example.ts') && !document.querySelector('[role=menu]')",
  );
  await evaluate("document.querySelector('[data-review-file] button').click()");
  await waitFor(
    "[...document.querySelectorAll('button')].some(button => button.textContent === 'Quote')",
  );
  await evaluate(
    "[...document.querySelectorAll('button')].find(button => button.textContent === 'Quote').click()",
  );
  await waitFor(
    `document.querySelector('textarea')?.value.includes('@${file.path}') && document.querySelector('textarea')?.value.includes(${JSON.stringify(draft)})`,
  );
  const quotedDraft = await evaluate("document.querySelector('textarea').value");
  await click('button[aria-label="Quick launch session options"]');
  await waitFor(
    'document.querySelector(\'[role=dialog] input[placeholder="e.g. fix-login-issue"]\')',
  );
  await evaluate(
    "[...document.querySelectorAll('[role=dialog] button')].find(button => button.textContent === 'Cancel').click()",
  );
  await waitFor(
    "!document.querySelector('[role=dialog]') && document.body.style.pointerEvents !== 'none'",
  );
  if (
    !(await evaluate(
      `document.querySelector('textarea')?.value === ${JSON.stringify(quotedDraft)}`,
    ))
  )
    throw new Error('Launch dialog changed the existing session draft');
  return {
    passed: true,
    draftNavigation: true,
    reviewContext: true,
    hunkQuote: true,
    launchDialog: true,
  };
}
