/**
 * Official Logo for SJC ENGENHARIA & SOLUÇÕES
 * Exactly matching the official brand identity:
 * - Charcoal/dark gray background (#383838)
 * - Large metallic silver/gray stylized aerodynamic italic SJC glyphs (#c2c3c7)
 * - Vivid scarlet red "ENGENHARIA & SOLUÇÕES" in bold italic centered horizontally across SJC (#e52632)
 */

export const SJC_OFFICIAL_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 230" width="540" height="230">
  <!-- Dark Charcoal Corporate Background -->
  <rect width="540" height="230" fill="#393939" rx="3"/>

  <!-- Slanted Group for SJC Letters (Aerodynamic techno style) -->
  <g transform="matrix(1 0 -0.25 1 42 0)" fill="#c3c4c8">
    <!-- Letter S (rounded top-left, rounded bottom-right) -->
    <path d="M 64 24
             C 36 24 18 42 18 72
             L 18 84
             L 66 84
             L 66 74
             C 66 64 74 58 90 58
             L 142 58
             C 156 58 164 64 164 74
             C 164 86 154 92 134 96
             L 76 108
             C 36 116 18 132 18 160
             C 18 190 38 206 78 206
             L 156 206
             C 184 206 204 188 204 158
             L 204 146
             L 156 146
             L 156 156
             C 156 166 148 172 132 172
             L 80 172
             C 66 172 58 166 58 156
             C 58 144 68 138 88 134
             L 146 122
             C 186 114 204 98 204 70
             C 204 40 184 24 144 24
             Z"/>

    <!-- Letter J (tall right pillar curving smoothly around bottom) -->
    <path d="M 238 24
             L 290 24
             L 290 156
             C 290 188 272 206 238 206
             L 180 206
             C 146 206 130 188 130 156
             L 130 126
             L 176 126
             L 176 156
             C 176 167 182 172 194 172
             L 226 172
             C 238 172 244 167 244 156
             L 244 24
             Z"/>

    <!-- Letter C (wide rounded aerodynamic curve open on the right) -->
    <path d="M 388 24
             C 344 24 322 48 322 84
             L 322 146
             C 322 182 344 206 388 206
             L 456 206
             C 488 206 504 190 506 164
             L 460 164
             C 458 170 450 172 438 172
             L 388 172
             C 372 172 364 162 364 146
             L 364 84
             C 364 68 372 58 388 58
             L 438 58
             C 450 58 458 60 460 66
             L 506 66
             C 504 40 488 24 456 24
             Z"/>
  </g>

  <!-- Superimposed Red Brand Title: ENGENHARIA & SOLUÇÕES -->
  <g transform="matrix(1 0 -0.25 1 0 0)">
    <!-- Subtle dark outline for maximum legibility over gray glyphs -->
    <text x="290" y="125"
          fill="#e52632"
          stroke="#262626"
          stroke-width="1"
          font-family="'Arial Black', Arial, Helvetica, sans-serif"
          font-weight="900"
          font-style="italic"
          font-size="33"
          letter-spacing="2"
          text-anchor="middle">ENGENHARIA &amp; SOLUÇÕES</text>
  </g>
</svg>`;

export const SJC_OFFICIAL_LOGO_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(SJC_OFFICIAL_LOGO_SVG)}`;
