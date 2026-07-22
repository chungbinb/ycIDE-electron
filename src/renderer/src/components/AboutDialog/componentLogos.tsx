/**
 * 关于窗组件行的图标——各组件官方 logo 的内联 SVG（24×24 viewBox，品牌色）。
 *
 * 说明：Electron / React / Node / Zig / Vite / TypeScript / Chromium 有明确的官方标志，尽量还原；
 * V8 / Monaco Editor / node-pty 没有独立品牌标志，用其惯用代表（V8 引擎字样、VS Code 蓝、终端符号）。
 * 仅作产品「关于」页的技术栈标识，非商业使用。
 */
import type { JSX } from 'react'

export const COMPONENT_LOGOS: Record<string, JSX.Element> = {
  // Electron：青色原子轨道
  electron: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g stroke="#9FEAF9" strokeWidth="1.1">
        <ellipse cx="12" cy="12" rx="11" ry="4.6" />
        <ellipse cx="12" cy="12" rx="11" ry="4.6" transform="rotate(60 12 12)" />
      </g>
      <circle cx="16.5" cy="9" r="1.7" fill="#47848F" />
    </svg>
  ),
  // Chromium：蓝色三分圆 + 中心圆
  chromium: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#4285F4" />
      <path d="M12 1a11 11 0 0 1 9.5 5.5H12a5.5 5.5 0 0 0-4.8 2.8L3.5 5.4A11 11 0 0 1 12 1Z" fill="#1A73E8" />
      <path d="M3.5 5.4l3.7 6.9A5.5 5.5 0 0 0 12 17.5l-3.2 5.4A11 11 0 0 1 3.5 5.4Z" fill="#5B9BF5" />
      <circle cx="12" cy="12" r="4.4" fill="#fff" />
      <circle cx="12" cy="12" r="3.4" fill="#1A73E8" />
    </svg>
  ),
  // Node.js：绿色尖顶六边形
  node: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 1.5l9.1 5.25v10.5L12 22.5l-9.1-5.25V6.75L12 1.5Z" fill="#539E43" />
      <path d="M12 6.5c-2.8 0-4.3 1.3-4.3 3.1 0 2 1.5 2.5 3.8 2.8 1.7.2 2 .5 2 1 0 .5-.4.9-1.5.9-1.2 0-1.8-.4-1.9-1.2H8c.1 1.7 1.4 2.7 3.9 2.7 2.6 0 4-1.1 4-3 0-2-1.5-2.5-3.8-2.8-1.7-.2-2-.5-2-1s.5-.8 1.4-.8c1 0 1.5.3 1.6 1.1h2.1c-.1-1.6-1.3-2.7-3.6-2.7Z" fill="#fff" />
    </svg>
  ),
  // V8：紫红六边形 + V8 字样（引擎标识）
  v8: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 1.5l9.1 5.25v10.5L12 22.5l-9.1-5.25V6.75L12 1.5Z" fill="#4B3A67" />
      <text x="12" y="15.5" fontSize="8" fontWeight="700" fill="#C89BF0" textAnchor="middle" fontFamily="Arial, sans-serif">V8</text>
    </svg>
  ),
  // Zig：橙色徽标 + Ziggy 锯齿箭头意象
  zig: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="4" width="22" height="16" rx="3" fill="#F7A41D" />
      <path d="M6 8.5h9l-6 7h6" stroke="#1a1a1a" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  ),
  // React：青色原子（3 条椭圆轨道 + 核）
  react: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="2" fill="#61DAFB" />
      <g stroke="#61DAFB" strokeWidth="1">
        <ellipse cx="12" cy="12" rx="11" ry="4.2" />
        <ellipse cx="12" cy="12" rx="11" ry="4.2" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="11" ry="4.2" transform="rotate(120 12 12)" />
      </g>
    </svg>
  ),
  // Monaco Editor：VS Code 蓝丝带（Monaco 即 VS Code 的编辑器内核）
  monaco: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.5 1.8L22 4v16l-4.5 2.2-9.3-8.8L4 16.5 2 15.3V8.7l2-1.2 4.2 3.1 9.3-8.8Z" fill="#0098FF" />
      <path d="M17.5 6.4v11.2L10.6 12l6.9-5.6Z" fill="#0B4C8C" opacity="0.5" />
    </svg>
  ),
  // xterm.js：终端窗口 + ">_"
  xterm: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="3.5" width="22" height="17" rx="3" fill="#1E1E1E" />
      <path d="M5 9l3 2.6L5 14" stroke="#4AF626" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="10" y="14.5" width="6" height="1.6" rx="0.8" fill="#4AF626" />
    </svg>
  ),
  // node-pty：终端 + Node 绿（伪终端，微软出品，无独立 logo）
  nodePty: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="3.5" width="22" height="17" rx="3" fill="#2b2b2b" />
      <path d="M5 9l3 2.6L5 14" stroke="#539E43" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="10" y="14.5" width="6" height="1.6" rx="0.8" fill="#83CD29" />
    </svg>
  ),
  // Vite：闪电（黄紫渐变）
  vite: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="vite-a" x1="6" y1="3" x2="15" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#41D1FF" />
          <stop offset="1" stopColor="#BD34FE" />
        </linearGradient>
        <linearGradient id="vite-b" x1="11" y1="5" x2="13" y2="19" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFEA83" />
          <stop offset="0.5" stopColor="#FFDD35" />
          <stop offset="1" stopColor="#FFA800" />
        </linearGradient>
      </defs>
      <path d="M22 5.4l-9.6 16.3a.6.6 0 0 1-1 0L2 5.4a.6.6 0 0 1 .6-.9l9.4 1.7a.6.6 0 0 0 .2 0l9.2-1.7a.6.6 0 0 1 .6.9Z" fill="url(#vite-a)" />
      <path d="M16.3 2.2l-7 1.4a.3.3 0 0 0-.24.28l-.43 7.3a.3.3 0 0 0 .37.3l1.95-.45a.3.3 0 0 1 .36.35l-.58 2.83a.3.3 0 0 0 .38.35l1.2-.36a.3.3 0 0 1 .38.35l-.92 4.45c-.06.3.33.46.5.2l.12-.18 5.7-11.36a.3.3 0 0 0-.33-.43l-2 .39a.3.3 0 0 1-.36-.37l1.3-4.52a.3.3 0 0 0-.37-.37Z" fill="url(#vite-b)" />
    </svg>
  ),
  // TypeScript：蓝色圆角方块 + 白 TS
  typescript: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="3" fill="#3178C6" />
      <text x="12.5" y="17" fontSize="10.5" fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="Arial, sans-serif">TS</text>
    </svg>
  ),
}
