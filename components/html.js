// React without a build step: React 18 UMD globals (cdnjs) + htm tagged templates instead of JSX.
import htm from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/+esm';

const React = window.React;

export const html = htm.bind(React.createElement);
export const { useState, useEffect, useRef, useMemo, useCallback, Fragment } = React;

// Inline SVG glyph markup from markerTypes.js
export function Glyph({ svg, className = 'glyph' }) {
  return html`<span class=${className} dangerouslySetInnerHTML=${{ __html: svg }}></span>`;
}
