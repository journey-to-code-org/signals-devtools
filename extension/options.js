// Extra sites: a host permission (asked for once) plus a registered MAIN-world content script.
const PREFIX = 'site:';
const list = document.getElementById('sites');
const message = document.getElementById('message');

/** "https://staging.example.com/app" → "https://staging.example.com/*" */
function patternFor(input) {
  const text = input.trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https sites can be added.');
  return `${url.protocol}//${url.hostname}/*`;
}

async function render() {
  const scripts = await chrome.scripting.getRegisteredContentScripts();
  const sites = scripts.filter((script) => script.id.startsWith(PREFIX));
  list.replaceChildren(
    ...(sites.length
      ? sites.map((script) => {
          const li = document.createElement('li');
          const code = document.createElement('code');
          code.textContent = script.matches.join(', ');
          const remove = document.createElement('button');
          remove.textContent = 'Remove';
          remove.addEventListener('click', async () => {
            await chrome.scripting.unregisterContentScripts({ ids: [script.id] });
            await chrome.permissions.remove({ origins: script.matches }).catch(() => {});
            message.textContent = `Removed ${script.matches[0]}.`;
            render();
          });
          li.append(code, remove);
          return li;
        })
      : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'No other sites yet.' })]),
  );
}

document.getElementById('add').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('site');
  let pattern;
  try {
    pattern = patternFor(input.value);
  } catch (error) {
    message.textContent = error.message.startsWith('Only') ? error.message : 'That isn\'t a site address.';
    return;
  }
  // Must be called straight from the click, before any other await.
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    message.textContent = 'Permission wasn\'t granted, so the site wasn\'t added.';
    return;
  }
  const id = PREFIX + pattern;
  await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
  await chrome.scripting.registerContentScripts([
    { id, matches: [pattern], js: ['hook.js'], runAt: 'document_start', world: 'MAIN', allFrames: true, persistAcrossSessions: true },
  ]);
  input.value = '';
  message.textContent = `Added ${pattern}. Reload its pages to inspect them.`;
  render();
});

render();
