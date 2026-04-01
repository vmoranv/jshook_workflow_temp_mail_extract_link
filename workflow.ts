import {
  createWorkflow,
  type WorkflowExecutionContext,
  SequenceNodeBuilder,
  ToolNodeBuilder,
} from '@jshookmcp/extension-sdk/workflow';

const workflowId = 'workflow.temp-mail-extract-link.v1';

export default createWorkflow(workflowId, 'Temp Mail Extract Link')
  .description(
    'Navigate or reuse a temp-mail detail page, wait through redirects/challenges, scan main document and accessible iframes, classify fallback links, and optionally auto-open the first verification match.',
  )
  .tags(['workflow', 'mail', 'temp-mail', 'verification', 'link-extract'])
  .timeoutMs(3 * 60_000)
  .defaultMaxConcurrency(1)
  .buildGraph((ctx: WorkflowExecutionContext) => {
    const prefix = 'workflows.tempMailExtractLink';
    const detailUrl = String(ctx.getConfig(`${prefix}.detailUrl`, ''));
    const waitUntil = String(ctx.getConfig(`${prefix}.waitUntil`, 'domcontentloaded'));
    const initialWaitMs = Number(ctx.getConfig(`${prefix}.initialWaitMs`, 1200));
    const retryWaitMs = Number(ctx.getConfig(`${prefix}.retryWaitMs`, 1000));
    const maxWaitAttempts = Number(ctx.getConfig(`${prefix}.maxWaitAttempts`, 5));
    const readySelector = String(ctx.getConfig(`${prefix}.readySelector`, ''));
    const readyText = String(ctx.getConfig(`${prefix}.readyText`, ''));
    const titleBlocklist = ctx.getConfig<string[]>(`${prefix}.titleBlocklist`, [
      'Redirecting',
    ]);
    const bodyBlocklist = ctx.getConfig<string[]>(`${prefix}.bodyBlocklist`, [
      'Checking your browser',
      'Just a moment',
    ]);
    const expectedContextHints = ctx.getConfig<string[]>(
      `${prefix}.expectedContextHints`,
      ['邮件', 'mail', '发件人', 'subject'],
    );
    const linkSelector = String(ctx.getConfig(`${prefix}.linkSelector`, 'a'));
    const hrefIncludes = ctx.getConfig<string[]>(`${prefix}.hrefIncludes`, []);
    const textIncludes = ctx.getConfig<string[]>(`${prefix}.textIncludes`, []);
    const regexPattern = String(ctx.getConfig(`${prefix}.regexPattern`, ''));
    const regexFlags = String(ctx.getConfig(`${prefix}.regexFlags`, 'i'));
    const maxLinks = Number(ctx.getConfig(`${prefix}.maxLinks`, 20));
    const includeFallbackLinks = Boolean(
      ctx.getConfig(`${prefix}.includeFallbackLinks`, true),
    );
    const fallbackMaxLinks = Number(ctx.getConfig(`${prefix}.fallbackMaxLinks`, 20));
    const openFirstMatch = Boolean(ctx.getConfig(`${prefix}.openFirstMatch`, false));
    const waitAfterOpenMs = Number(ctx.getConfig(`${prefix}.waitAfterOpenMs`, 2000));

    const root = new SequenceNodeBuilder('temp-mail-extract-link-root');

    root
      .branch(
        'maybe-navigate-detail',
        'temp_mail_extract_link_has_detail_url',
        (b) => {
          b.predicateFn(() => Boolean(detailUrl))
            .whenTrue(
              new ToolNodeBuilder('navigate-detail', 'page_navigate').input({
                url: detailUrl,
                waitUntil,
                enableNetworkMonitoring: true,
              }),
            )
            .whenFalse(
              new ToolNodeBuilder('skip-navigate-detail', 'console_execute').input({
                expression:
                  '({ skipped: true, step: "navigate-detail", reason: "detailUrl not provided" })',
              }),
            );
        },
      )
      .tool('initial-wait', 'page_evaluate', {
        input: {
          code: `new Promise(resolve => setTimeout(() => resolve({ waitedMs: ${initialWaitMs} }), ${initialWaitMs}))`,
        },
        timeoutMs: Math.max(10_000, initialWaitMs + 2_000),
      })
      .tool('extract-links', 'page_evaluate', {
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
              if (/mail\\/view/.test(combined)) return 'mail_view';
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
        timeoutMs: Math.max(
          15_000,
          initialWaitMs + maxWaitAttempts * retryWaitMs + 5_000,
        ),
      })
      .branch(
        'maybe-wait-after-open',
        'temp_mail_extract_link_wait_after_open',
        (b) => {
          b.predicateFn(() => openFirstMatch)
            .whenTrue(
              new ToolNodeBuilder('wait-after-open', 'page_evaluate')
                .input({
                  code: `new Promise(resolve => setTimeout(() => resolve({ waitedMs: ${waitAfterOpenMs} }), ${waitAfterOpenMs}))`,
                })
                .timeout(Math.max(10_000, waitAfterOpenMs + 2_000)),
            )
            .whenFalse(
              new ToolNodeBuilder('skip-wait-after-open', 'console_execute').input({
                expression:
                  '({ skipped: true, step: "wait-after-open", reason: "openFirstMatch=false" })',
              }),
            );
        },
      )
      .tool('emit-summary', 'console_execute', {
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
      });

    return root;
  })
  .onStart((ctx) => {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', {
      workflowId,
      stage: 'start',
    });
  })
  .onFinish((ctx) => {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', {
      workflowId,
      stage: 'finish',
    });
  })
  .onError((ctx, error) => {
    ctx.emitMetric('workflow_errors_total', 1, 'counter', {
      workflowId,
      error: error.name,
    });
  })
  .build();
