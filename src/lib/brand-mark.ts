export const BRAND_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="panel" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
      <stop stop-color="#16341f"/>
      <stop offset="1" stop-color="#132518"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="1.4" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <path d="M14 2H62V50L50 62H2V14Z" fill="url(#panel)" stroke="#a8ff60" stroke-opacity=".68" stroke-width="2"/>
  <path d="M17 16H31C42 16 49 22 49 32C49 42 42 48 31 48H17V16ZM24 23V41H31C38 41 42 38 42 32C42 26 38 23 31 23H24Z" fill="#a8ff60" fill-rule="evenodd" filter="url(#glow)"/>
</svg>`;

export function brandMarkDataUri() {
  return `data:image/svg+xml;utf8,${encodeURIComponent(BRAND_MARK_SVG)}`;
}
