/** Real-browser review of the existing development gallery and its reusable interaction layers. */
export async function runGalleryReview({ send, evaluate, origin, errors, screenshot }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function waitFor(expression) {
    const deadline = Date.now() + 20000;
    while (!(await evaluate(expression))) {
      if (Date.now() > deadline || errors.length)
        throw new Error(`Gallery condition failed: ${expression}\n${errors.join('\n')}`);
      await sleep(100);
    }
  }
  await send('Page.navigate', { url: `${origin}/_dev/ui` });
  await waitFor(`document.querySelector('h1')?.textContent === 'UI gallery'`);
  const checks = {};
  for (const width of [1280, 390]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(400);
    checks[`noPageOverflow${width}`] = await evaluate(
      `document.documentElement.scrollWidth <= window.innerWidth`,
    );
    await screenshot(`gallery-${width}`);
  }
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const id of [
    'gallery-buttons',
    'gallery-inputs-and-selects',
    'gallery-cards-and-surfaces',
    'gallery-feedback-states',
  ]) {
    await evaluate(
      `document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'start'})`,
    );
    await sleep(150);
    await screenshot(id);
  }
  // Keep the reviewed gallery's actual accessible trigger as the fixture contract.
  const label = await evaluate(
    `[...document.querySelectorAll('button')].filter(button=>button.getAttribute('aria-haspopup')==='dialog').map(button=>button.textContent)`,
  );
  if (!label.length) throw new Error('Gallery has no dialog trigger');
  await evaluate(
    `[...document.querySelectorAll('button')].find(button=>button.getAttribute('aria-haspopup')==='dialog').focus()`,
  );
  await evaluate(`document.activeElement.click()`);
  await waitFor(`!!document.querySelector('[role=dialog]')`);
  checks.namedDialog = await evaluate(
    `(() => {const dialog=document.querySelector('[role=dialog]');return !!document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent;})()`,
  );
  checks.focusInsideDialog = await evaluate(
    `document.querySelector('[role=dialog]').contains(document.activeElement)`,
  );
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await waitFor(`!document.querySelector('[role=dialog]')`);
  checks.escapeDismissal = true;
  await waitFor(`document.activeElement?.getAttribute('aria-haspopup') === 'dialog'`);
  checks.focusReturned = await evaluate(
    `document.activeElement?.getAttribute('aria-haspopup') === 'dialog'`,
  );
  checks.gallerySections = await evaluate(
    `document.querySelectorAll('section[aria-labelledby]').length >= 5`,
  );
  if (errors.length || Object.values(checks).some((value) => !value))
    throw new Error(`Gallery review failed: ${JSON.stringify(checks)} ${errors.join('\n')}`);
  return { environment: {}, scenarios: [], cpu: [], gallery: checks };
}
