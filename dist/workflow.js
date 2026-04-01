function toolNode(id, toolName, options) {
    return {
        kind: 'tool',
        id,
        toolName,
        input: options?.input,
        retry: options?.retry,
        timeoutMs: options?.timeoutMs,
    };
}
function sequenceNode(id, steps) {
    return { kind: 'sequence', id, steps };
}
function branchNode(id, predicateId, whenTrue, whenFalse, predicateFn) {
    return { kind: 'branch', id, predicateId, predicateFn, whenTrue, whenFalse };
}
const workflowId = 'workflow.temp-mail-extract-link.v1';
const workflow = {
    kind: 'workflow-contract',
    version: 1,
    id: workflowId,
    displayName: 'Temp Mail Extract Link',
    description: 'Navigate or reuse a temp-mail detail page, wait through redirects/challenges, scan main document and accessible iframes, classify fallback links, and optionally auto-open the first verification match.',
    tags: ['workflow', 'mail', 'temp-mail', 'verification', 'link-extract'],
    timeoutMs: 3 * 60_000,
    defaultMaxConcurrency: 1,
    build(ctx) {
        const prefix = 'workflows.tempMailExtractLink';
        const detailUrl = ctx.getConfig(`${prefix}.detailUrl`, '');
        const waitUntil = ctx.getConfig(`${prefix}.waitUntil`, 'domcontentloaded');
        const initialWaitMs = ctx.getConfig(`${prefix}.initialWaitMs`, 1200);
        const retryWaitMs = ctx.getConfig(`${prefix}.retryWaitMs`, 1000);
        const maxWaitAttempts = ctx.getConfig(`${prefix}.maxWaitAttempts`, 5);
        const readySelector = ctx.getConfig(`${prefix}.readySelector`, '');
        const readyText = ctx.getConfig(`${prefix}.readyText`, '');
        const titleBlocklist = ctx.getConfig(`${prefix}.titleBlocklist`, ['Redirecting']);
        const bodyBlocklist = ctx.getConfig(`${prefix}.bodyBlocklist`, ['Checking your browser', 'Just a moment']);
        const expectedContextHints = ctx.getConfig(`${prefix}.expectedContextHints`, ['邮件', 'mail', '发件人', 'subject']);
        const linkSelector = ctx.getConfig(`${prefix}.linkSelector`, 'a');
        const hrefIncludes = ctx.getConfig(`${prefix}.hrefIncludes`, []);
        const textIncludes = ctx.getConfig(`${prefix}.textIncludes`, []);
        const regexPattern = ctx.getConfig(`${prefix}.regexPattern`, '');
        const regexFlags = ctx.getConfig(`${prefix}.regexFlags`, 'i');
        const maxLinks = ctx.getConfig(`${prefix}.maxLinks`, 20);
        const includeFallbackLinks = ctx.getConfig(`${prefix}.includeFallbackLinks`, true);
        const fallbackMaxLinks = ctx.getConfig(`${prefix}.fallbackMaxLinks`, 20);
        const openFirstMatch = ctx.getConfig(`${prefix}.openFirstMatch`, false);
        const waitAfterOpenMs = ctx.getConfig(`${prefix}.waitAfterOpenMs`, 2000);
        const steps = [];
        steps.push(branchNode('maybe-navigate-detail', 'temp_mail_extract_link_has_detail_url', toolNode('navigate-detail', 'page_navigate', {
            input: {
                url: detailUrl,
                waitUntil,
                enableNetworkMonitoring: true,
            },
        }), toolNode('skip-navigate-detail', 'console_execute', {
            input: {
                expression: '({ skipped: true, step: "navigate-detail", reason: "detailUrl not provided" })',
            },
        }), () => Boolean(detailUrl)));
        steps.push(toolNode('initial-wait', 'page_evaluate', {
            input: {
                code: `new Promise(resolve => setTimeout(() => resolve({ waitedMs: ${initialWaitMs} }), ${initialWaitMs}))`,
            },
            timeoutMs: Math.max(10_000, initialWaitMs + 2_000),
        }));
        steps.push(toolNode('extract-links', 'page_evaluate', {
            input: {
                code: `(async function(){
            const settings = {
              readySelector: ${JSON.stringify(readySelector)},
              readyText: ${JSON.stringify(readyText)},
              titleBlocklist: ${JSON.stringify(titleBlocklist)},
              bodyBlocklist: ${JSON.stringify(bodyBlocklist)},
              expectedContextHints: ${JSON.stringify(expectedContextHints)},
              linkSelector: ${JSON.stringify(linkSelector)},
              hrefIncludes: ${JSON.stringify(hrefIncludes)},
              textIncludes: ${JSON.stringify(textIncludes)},
              regexPattern: ${JSON.stringify(regexPattern)},
              regexFlags: ${JSON.stringify(regexFlags)},
              maxLinks: ${JSON.stringify(maxLinks)},
              includeFallbackLinks: ${JSON.stringify(includeFallbackLinks)},
              fallbackMaxLinks: ${JSON.stringify(fallbackMaxLinks)},
              openFirstMatch: ${JSON.stringify(openFirstMatch)},
              retryWaitMs: ${JSON.stringify(retryWaitMs)},
              maxWaitAttempts: ${JSON.stringify(maxWaitAttempts)}
            };

            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const normalize = (value) => (value || '').trim();
            const regex = settings.regexPattern ? new RegExp(settings.regexPattern, settings.regexFlags) : null;

            const classifyLink = (item) => {
              const combined = (item.href + ' ' + item.text).toLowerCase();
              if (/activate|activation/.test(combined)) return 'activation';
              if (/verify|verification|confirm/.test(combined)) return 'verification';
              if (/mail\/view/.test(combined)) return 'mail_view';
              if (/login|signin|signup|register|auth/.test(combined)) return 'auth';
              if (/privacy|terms|policy|contact|help/.test(combined)) return 'navigation';
              return 'other';
            };

            const getDocuments = () => {
              const docs = [{ label: 'main', doc: document }];
              const frames = Array.from(document.querySelectorAll('iframe'));
              for (let index = 0; index < frames.length; index += 1) {
                const frame = frames[index];
                try {
                  const frameDoc = frame.contentDocument || frame.contentWindow?.document;
                  if (frameDoc) {
                    docs.push({ label: 'iframe:' + index, doc: frameDoc });
                  }
                } catch {
                  // cross-origin iframe; ignore safely
                }
              }
              return docs;
            };

            const collectLinks = () => {
              const docs = getDocuments();
              const allLinks = [];
              for (const item of docs) {
                const anchors = Array.from(item.doc.querySelectorAll(settings.linkSelector));
                for (const anchor of anchors) {
                  const href = normalize(anchor.href || anchor.getAttribute('href') || '');
                  const text = normalize(anchor.innerText || anchor.textContent || '');
                  if (!href && !text) continue;
                  allLinks.push({ href, text, source: item.label, kind: classifyLink({ href, text }) });
                }
              }

              const matches = allLinks.filter((item) => {
                const combined = (item.href + ' ' + item.text).trim();
                const hrefOk = settings.hrefIncludes.length === 0 || settings.hrefIncludes.some((value) => item.href.includes(value));
                const textOk = settings.textIncludes.length === 0 || settings.textIncludes.some((value) => item.text.includes(value));
                const regexOk = !regex || regex.test(combined);
                return hrefOk && textOk && regexOk;
              }).slice(0, settings.maxLinks);

              const fallbackLinks = settings.includeFallbackLinks
                ? allLinks.slice(0, settings.fallbackMaxLinks)
                : [];

              const fallbackSummary = allLinks.reduce((acc, item) => {
                acc[item.kind] = (acc[item.kind] || 0) + 1;
                return acc;
              }, {});

              return { docsCount: docs.length, allLinksCount: allLinks.length, matches, fallbackLinks, fallbackSummary };
            };

            for (let attempt = 1; attempt <= settings.maxWaitAttempts; attempt++) {
              const title = document.title || '';
              const href = window.location.href || '';
              const bodyText = document.body?.innerText || '';
              const titleBlocked = settings.titleBlocklist.some((value) => value && title.includes(value));
              const bodyBlocked = settings.bodyBlocklist.some((value) => value && bodyText.includes(value));
              const selectorReady = !settings.readySelector || !!document.querySelector(settings.readySelector);
              const textReady = !settings.readyText || bodyText.includes(settings.readyText);
              const contextHintMatched = settings.expectedContextHints.length === 0 || settings.expectedContextHints.some((value) => title.includes(value) || bodyText.includes(value) || href.includes(value));
              const linkData = collectLinks();

              if (!titleBlocked && !bodyBlocked && selectorReady && textReady) {
                const firstMatch = linkData.matches.length > 0 ? linkData.matches[0] : null;
                let opened = false;
                if (settings.openFirstMatch && firstMatch && firstMatch.href) {
                  window.location.href = firstMatch.href;
                  opened = true;
                }
                return {
                  success: linkData.matches.length > 0,
                  attempt,
                  title,
                  href,
                  titleBlocked,
                  bodyBlocked,
                  selectorReady,
                  textReady,
                  contextHintMatched,
                  contextWarning: contextHintMatched ? null : 'current page does not look like a mail-detail context',
                  matchedCount: linkData.matches.length,
                  firstMatch,
                  opened,
                  matches: linkData.matches,
                  fallbackLinks: linkData.fallbackLinks,
                  fallbackSummary: linkData.fallbackSummary,
                  allLinksCount: linkData.allLinksCount,
                  docsCount: linkData.docsCount,
                };
              }

              if (attempt < settings.maxWaitAttempts) {
                await sleep(settings.retryWaitMs);
              } else {
                return {
                  success: false,
                  attempt,
                  title,
                  href,
                  titleBlocked,
                  bodyBlocked,
                  selectorReady,
                  textReady,
                  contextHintMatched,
                  contextWarning: contextHintMatched ? null : 'current page does not look like a mail-detail context',
                  matchedCount: linkData.matches.length,
                  firstMatch: linkData.matches.length > 0 ? linkData.matches[0] : null,
                  opened: false,
                  matches: linkData.matches,
                  fallbackLinks: linkData.fallbackLinks,
                  fallbackSummary: linkData.fallbackSummary,
                  allLinksCount: linkData.allLinksCount,
                  docsCount: linkData.docsCount,
                  reason: 'ready_or_match_conditions_not_met',
                };
              }
            }

            return { success: false, reason: 'unreachable' };
          })()`,
            },
            timeoutMs: Math.max(15_000, initialWaitMs + maxWaitAttempts * retryWaitMs + 5_000),
        }));
        steps.push(branchNode('maybe-wait-after-open', 'temp_mail_extract_link_wait_after_open', toolNode('wait-after-open', 'page_evaluate', {
            input: {
                code: `new Promise(resolve => setTimeout(() => resolve({ waitedMs: ${waitAfterOpenMs} }), ${waitAfterOpenMs}))`,
            },
            timeoutMs: Math.max(10_000, waitAfterOpenMs + 2_000),
        }), toolNode('skip-wait-after-open', 'console_execute', {
            input: {
                expression: '({ skipped: true, step: "wait-after-open", reason: "openFirstMatch=false" })',
            },
        }), () => openFirstMatch));
        steps.push(toolNode('emit-summary', 'console_execute', {
            input: {
                expression: `(${JSON.stringify({
                    workflowId,
                    detailUrl,
                    waitUntil,
                    initialWaitMs,
                    retryWaitMs,
                    maxWaitAttempts,
                    readySelector,
                    readyText,
                    titleBlocklist,
                    bodyBlocklist,
                    expectedContextHints,
                    linkSelector,
                    hrefIncludes,
                    textIncludes,
                    regexPattern,
                    regexFlags,
                    maxLinks,
                    includeFallbackLinks,
                    fallbackMaxLinks,
                    openFirstMatch,
                    waitAfterOpenMs,
                    note: 'Inspect extract-links output for matched href/text pairs, contextWarning, fallbackLinks, fallbackSummary, and docsCount.',
                })})`,
            },
        }));
        return sequenceNode('temp-mail-extract-link-root', steps);
    },
    onStart(ctx) {
        ctx.emitMetric('workflow_runs_total', 1, 'counter', {
            workflowId,
            stage: 'start',
        });
    },
    onFinish(ctx) {
        ctx.emitMetric('workflow_runs_total', 1, 'counter', {
            workflowId,
            stage: 'finish',
        });
    },
    onError(ctx, error) {
        ctx.emitMetric('workflow_errors_total', 1, 'counter', {
            workflowId,
            error: error.name,
        });
    },
};
export default workflow;
