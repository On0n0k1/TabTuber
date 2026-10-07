/*
 * Portfolio link, bottom LEFT, above the toolbar.
 *
 * Not a toolbar button: it controls nothing on screen, so it carries none of
 * the tooltip, disabled-state or paint machinery the other buttons need, and
 * folding it into Toolbar would mean teaching that class about plain links
 * for the one item that is not a performance control.
 *
 * The URL matches the one the docs pages already link to (see
 * scripts/build-docs.mjs) -- the same site, just also reachable from inside
 * the app rather than only from its documentation.
 */

import { iconElement } from "./icons.ts";

const PORTFOLIO_URL = "https://on0n0k1.github.io";

export function createPortfolioLink(parent: HTMLElement): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "portfolio-link";
  link.href = PORTFOLIO_URL;
  link.target = "_blank";
  link.rel = "noopener";
  link.setAttribute("aria-label", "Check my portfolio");

  link.append(iconElement("portfolio"));

  const text = document.createElement("span");
  text.textContent = "Portfolio";
  link.append(text);

  parent.append(link);
  return link;
}
