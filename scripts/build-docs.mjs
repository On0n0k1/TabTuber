/*
 * Renders docs/ into public/docs/ as static HTML, staged before dev and build.
 *
 * The markdown in docs/ is the source of truth -- it is what gets reviewed and
 * what reads correctly on GitHub. This only renders it, so nothing here may
 * require the markdown to be written in a way that reads worse there.
 *
 * Why this exists at all: without it, /docs returned index.html with a 200,
 * because a request matching no file fell through to the SPA fallback. So the
 * path did not 404 -- it silently served the app, the same failure mode as the
 * missing-model bug (SPEC.md 16) and just as confusing to diagnose.
 *
 * Output goes to public/ rather than straight to dist/, for the reason the
 * MediaPipe assets do: Vite copies publicDir into the build, AND serves it on
 * the dev server, so one staging step makes the pages reachable from both. A
 * postbuild step writing into dist/ would leave `npm run dev` with a
 * documentation link that 404s. public/docs is gitignored, like the rest of
 * what this and fetch-assets stage.
 *
 * README.md is deliberately NOT published. It is the developer entry point and
 * belongs on the repository page; docs/ is the user documentation and is what a
 * visitor to the site should find.
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "docs");
const OUT = join(root, "public", "docs");
const CSS = join(root, "scripts", "docs.css");

/** Where a link that leaves docs/ has to point once published. */
const REPO = "https://github.com/On0n0k1/TabTuber";
const REPO_BLOB = `${REPO}/blob/main`;

/**
 * The page order, which is also the reading order the index recommends.
 *
 * Declared rather than derived from a directory listing: the order is editorial
 * -- getting started before troubleshooting -- and alphabetical order would put
 * "choosing an avatar" first and bury "getting started" in the middle.
 */
const PAGES = [
  { file: "README.md", out: "index.html", nav: "Start here" },
  { file: "getting-started.md", nav: "Getting started" },
  { file: "choosing-an-avatar.md", nav: "Choosing an avatar" },
  { file: "performing.md", nav: "Performing" },
  { file: "lip-sync.md", nav: "Lip sync" },
  { file: "tracking-quality.md", nav: "Tracking quality" },
  { file: "streaming-with-obs.md", nav: "Streaming with OBS" },
  { file: "troubleshooting.md", nav: "Troubleshooting" },
];

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif"]);

const outName = (page) => page.out ?? page.file.replace(/\.md$/, ".html");

/**
 * GitHub's heading-slug algorithm, which is what the anchors in the markdown
 * assume. Lowercase, drop inline markup, drop anything that is not a word
 * character or a space, then hyphenate.
 *
 * It has to match GitHub's rather than merely be self-consistent: the same
 * `#anchor` links have to work in the rendered pages AND when the markdown is
 * read on the repository page, and only one of those two is ours to define.
 */
function slug(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~\[\]()]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Renders one page, collecting its heading slugs and outgoing links. */
function render(markdown, pageFile, problems) {
  const headings = new Set();
  const links = [];
  const images = [];

  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(token) {
        const id = slug(token.text);
        headings.add(id);
        const inner = this.parser.parseInline(token.tokens);
        // The anchor is the heading itself rather than a separate link icon:
        // one fewer thing to style, and the whole heading is the target.
        return `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`;
      },

      link(token) {
        const inner = this.parser.parseInline(token.tokens);
        const href = rewrite(token.href, pageFile, links, problems);
        const external = /^https?:/.test(href);
        const attrs = external ? ' target="_blank" rel="noopener"' : "";
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<a href="${escapeHtml(href)}"${title}${attrs}>${inner}</a>`;
      },

      image(token) {
        images.push({ href: token.href, page: pageFile });
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(token.text)}"${title} loading="lazy">`;
      },

      /*
       * Tables are wrapped so a wide one scrolls inside its own box instead of
       * widening the page. Several of these pages are mostly tables, and a
       * phone-width page that scrolls sideways is unreadable.
       */
      table(token) {
        const head = token.header
          .map((cell) => `<th${align(cell)}>${this.parser.parseInline(cell.tokens)}</th>`)
          .join("");
        const body = token.rows
          .map((row) =>
            `<tr>${row
              .map((cell) => `<td${align(cell)}>${this.parser.parseInline(cell.tokens)}</td>`)
              .join("")}</tr>`,
          )
          .join("\n");
        return `<div class="table-wrap"><table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table></div>\n`;
      },
    },
  });

  const body = marked.parse(markdown);
  return { body, headings, links, images };
}

const align = (cell) => (cell.align ? ` style="text-align:${cell.align}"` : "");

/**
 * Maps a markdown link target onto where it lives in the published output.
 *
 * Internal links are recorded for validation; anything unresolvable is a build
 * failure rather than a broken page, because a broken link in published
 * documentation is invisible until a reader hits it.
 */
function rewrite(href, pageFile, links, problems) {
  if (/^(https?:|mailto:|#)/.test(href)) {
    // A same-page anchor still has to point at a heading that exists.
    if (href.startsWith("#")) links.push({ page: pageFile, target: pageFile, frag: href.slice(1) });
    return href;
  }

  /*
   * Links out of docs/ cannot be satisfied by the published site, which carries
   * no source tree, so they are sent to the repository instead.
   *
   * Checked against the working tree on the way past: a rewritten path becomes
   * an absolute URL that looks right and 404s only once someone clicks it, and
   * a renamed module is exactly how that happens.
   */
  if (href.startsWith("../")) {
    const path = href.slice(3).split("#")[0];
    if (path === "README.md") return REPO;
    if (!existsSync(join(root, path))) {
      problems.push(`${pageFile}: links to ${href}, which is not in the repository`);
    }
    return `${REPO_BLOB}/${path}`;
  }

  const [path, frag] = href.split("#");

  if (path === "" ) return href;

  if (path.endsWith(".md")) {
    const target = PAGES.find((p) => p.file === path);
    if (!target) {
      problems.push(`${pageFile}: links to ${path}, which is not a published page`);
      return href;
    }
    links.push({ page: pageFile, target: path, frag });
    return frag ? `${outName(target)}#${frag}` : outName(target);
  }

  // An image or other asset alongside the markdown; copied verbatim.
  if (IMAGE_EXT.has(extname(path).toLowerCase())) return href;

  problems.push(`${pageFile}: cannot resolve link target ${href}`);
  return href;
}

function shell({ title, navHtml, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — TabTuber</title>
<meta name="description" content="TabTuber user documentation: ${escapeHtml(title)}.">
<link rel="stylesheet" href="docs.css">
</head>
<body>
<div class="layout">
<aside class="side"><div class="side-inner">
<a class="side-brand" href="index.html">TabTuber docs</a>
<nav class="side-nav" aria-label="Documentation pages">
${navHtml}
</nav>
<a class="side-app" href="../index.html">Open the app →</a>
</div></aside>
<div class="content">
<main>
${body}</main>
<footer class="foot">
TabTuber user documentation.
<a href="${REPO}">Source and developer docs on GitHub</a>.
</footer>
</div>
</div>
</body>
</html>
`;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const problems = [];

  const rendered = [];
  for (const page of PAGES) {
    const markdown = await readFile(join(SRC, page.file), "utf8");
    rendered.push({ page, ...render(markdown, page.file, problems) });
  }

  // Validation after every page is rendered, so a link forward to a heading on
  // a page not yet processed is still checked.
  const slugs = new Map(rendered.map((r) => [r.page.file, r.headings]));

  for (const { links } of rendered) {
    for (const { page, target, frag } of links) {
      if (!frag) continue;
      const have = slugs.get(target);
      if (!have) {
        problems.push(`${page}: links to ${target}, which is not published`);
      } else if (!have.has(frag)) {
        problems.push(`${page}: no heading "#${frag}" in ${target}`);
      }
    }
  }

  // Images are referenced before they exist, by design: screenshots are added
  // later. A reference to a file that is not there is still a failure, so the
  // build says so now rather than shipping a broken image.
  const present = new Set(
    (await readdir(SRC)).filter((f) => IMAGE_EXT.has(extname(f).toLowerCase())),
  );
  for (const { images } of rendered) {
    for (const { href, page } of images) {
      if (/^https?:/.test(href)) continue;
      if (!present.has(href)) problems.push(`${page}: image not found: ${href}`);
    }
  }

  if (problems.length > 0) {
    console.error(`docs: ${problems.length} broken reference(s) in docs/`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  const navHtml = (current) =>
    PAGES.map((p) => {
      const href = outName(p);
      const mark = p.file === current ? ' aria-current="page"' : "";
      return `<a href="${href}"${mark}>${escapeHtml(p.nav)}</a>`;
    }).join("\n");

  for (const { page, body } of rendered) {
    await writeFile(
      join(OUT, outName(page)),
      shell({ title: page.nav, navHtml: navHtml(page.file), body }),
      "utf8",
    );
  }

  await cp(CSS, join(OUT, "docs.css"));
  for (const image of present) await cp(join(SRC, image), join(OUT, image));

  console.log(
    `docs  -> public/docs/ (${PAGES.length} pages, ${present.size} image(s))`,
  );
}

await main();
