<template>
  <!-- 图标（从设计预览移植）。g-gov / g-adm / g-cap 是官方大航海图标加载失败时的替代（见 IdTag.vue） -->
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <symbol id="i-star" viewBox="0 0 24 24"><path d="M12 1.8l2.3 7.2 7.5.1-6 4.5 2.2 7.2L12 16.5l-6 4.3 2.2-7.2-6-4.5 7.5-.1z"/></symbol>
    <symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 2c.6 4.8 2.2 6.4 7 7-4.8.6-6.4 2.2-7 7-.6-4.8-2.2-6.4-7-7 4.8-.6 6.4-2.2 7-7z"/></symbol>
    <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></symbol>
    <symbol id="i-wand" viewBox="0 0 24 24"><path d="M4 20L15 9"/><path d="M14 4v2M19 9h2M17.5 5.5l1.5-1.5M17.5 12.5l1.5 1.5M10 5.5L8.5 4"/><path d="M13 7l4 4"/></symbol>
    <symbol id="i-image" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-5-5-9 9"/></symbol>
    <symbol id="i-list" viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".9"/><circle cx="4.5" cy="12" r=".9"/><circle cx="4.5" cy="18" r=".9"/></symbol>
    <symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></symbol>
    <symbol id="i-gear" viewBox="0 0 24 24"><path d="M19.38 10.17 L21.84 10.20 L21.84 13.80 L19.38 13.83 L18.51 15.92 L20.23 17.69 L17.69 20.23 L15.92 18.51 L13.83 19.38 L13.80 21.84 L10.20 21.84 L10.17 19.38 L8.08 18.51 L6.31 20.23 L3.77 17.69 L5.49 15.92 L4.62 13.83 L2.16 13.80 L2.16 10.20 L4.62 10.17 L5.49 8.08 L3.77 6.31 L6.31 3.77 L8.08 5.49 L10.17 4.62 L10.20 2.16 L13.80 2.16 L13.83 4.62 L15.92 5.49 L17.69 3.77 L20.23 6.31 L18.51 8.08Z"/><circle cx="12" cy="12" r="3.2"/></symbol>
    <symbol id="i-ext" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></symbol>
    <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></symbol>
    <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></symbol>
    <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z"/></symbol>
    <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
    <symbol id="i-grip" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></symbol>
    <symbol id="i-play" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></symbol>
    <symbol id="i-check" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/></symbol>
    <symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z"/></symbol>
    <symbol id="i-pin" viewBox="0 0 24 24"><path d="M9 3.5h6l-1 5.5 3.2 3.2H6.8L10 9z"/><path d="M12 12.2v8.3"/></symbol>
    <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></symbol>
    <symbol id="i-pause" viewBox="0 0 24 24"><rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/></symbol>
    <symbol id="i-ban" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></symbol>
    <symbol id="i-qr" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="6" height="6" rx="1"/><rect x="14.5" y="3.5" width="6" height="6" rx="1"/><rect x="3.5" y="14.5" width="6" height="6" rx="1"/><path d="M14.5 14.5h2v2h-2zM18.5 18.5h2v2h-2zM14.5 18.5h2M18.5 14.5h2"/></symbol>
    <symbol id="i-up" viewBox="0 0 24 24"><path d="M7 14l5-5 5 5"/></symbol>
    <symbol id="i-gift" viewBox="0 0 24 24"><rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v8h14v-8M12 8.5v12M12 8.5C10 4 6.5 4.5 7 7c.3 1.2 2.5 1.5 5 1.5zM12 8.5c2-4.5 5.5-4 5-1.5-.3 1.2-2.5 1.5-5 1.5z"/></symbol>
    <symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 5.5h16v10H9l-5 4z"/></symbol>
    <symbol id="i-chev" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></symbol>
    <symbol id="i-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></symbol>
    <!-- 复制一份来改（复制出一个新的）；只复制文字用 i-copy -->
    <symbol id="i-dup" viewBox="0 0 24 24"><path d="M8 8V5.5A1.5 1.5 0 019.5 4h9A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5H16"/><rect x="4" y="8" width="12" height="12" rx="1.5"/><path d="M10 11.5v5M7.5 14h5"/></symbol>
    <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 018 0v3"/></symbol>
    <symbol id="i-screen" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M12 16.5V20M8 20h8"/></symbol>
    <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
    <symbol id="i-pen" viewBox="0 0 24 24"><path d="M4 20h4L19.2 8.8a2.1 2.1 0 00-3-3L5 17v3z"/><path d="M14.5 7.5l3 3"/></symbol>
    <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5"/></symbol>
    <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/></symbol>
    <symbol id="i-copy" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 00-1.5-1.5H5A1.5 1.5 0 003.5 5v9A1.5 1.5 0 005 15.5h3.5"/></symbol>
    <symbol id="i-replay" viewBox="0 0 24 24"><path d="M4 12a8 8 0 108-8 8.5 8.5 0 00-6 2.5L4 8"/><path d="M4 3.5V8h4.5"/></symbol>
    <symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 010 6.4M18 14.8c1.8.8 3 2.6 3.5 5.2"/></symbol>
    <!-- 粉丝牌：牌子名 + 等级格 -->
    <symbol id="i-medal" viewBox="0 0 24 24"><rect x="2.5" y="7" width="19" height="10" rx="2.5"/><path d="M15 7v10M5.8 12h5.8"/><path d="M17.3 10.6l.9-.6v4"/></symbol>
    <symbol id="i-logout" viewBox="0 0 24 24"><path d="M14 4h5a1 1 0 011 1v14a1 1 0 01-1 1h-5M10 16l-4-4 4-4M6 12h10"/></symbol>
    <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.7A9.8 9.8 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-3.2 4M6.3 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5a9.6 9.6 0 004.3-1"/><path d="M9.9 10a3 3 0 004.1 4.1"/></symbol>
    <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
    <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></symbol>
      <!-- 上舰、大航海 -->
    <symbol id="i-anchor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><path d="M12 7v13M8.5 10.5h7M4.5 13.5a7.5 7.5 0 0015 0M4.5 13.5l-1.3 1.6M4.5 13.5l1.8.9M19.5 13.5l1.3 1.6M19.5 13.5l-1.8.9"/></symbol>
    <!-- 特效页演示：窗口里一个播放键 -->
    <symbol id="i-demo" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8.5h18"/><path d="M10.5 11.6v5.3l4.4-2.65z"/></symbol>
    <!-- 有新版本 -->
    <symbol id="i-update" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16.5v-9M8.3 11.2L12 7.5l3.7 3.7"/></symbol>
    <!-- 还没完成的步骤（完成了用 i-check） -->
    <symbol id="i-todo" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/></symbol>
    <!-- 普通提示 -->
    <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.01"/></symbol>
    <!-- 播放队列 -->
    <symbol id="i-queue" viewBox="0 0 24 24"><path d="M4 6.5h10M4 12h10M4 17.5h6"/><path d="M16.5 14.5v6l4.5-3z"/></symbol>
    <!-- 礼物榜 -->
    <symbol id="i-trophy" viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 5.5H4.5a3 3 0 003.6 4.2M16 5.5h3.5a3 3 0 01-3.6 4.2M12 13v3.5M8.5 20h7M9.5 20l.8-3.5h3.4l.8 3.5"/></symbol>
    <symbol id="g-gov" viewBox="0 0 24 24"><path d="M3 18.5h18M4 16l-1-9 5.5 4L12 4l3.5 7L21 7l-1 9z"/></symbol>
    <symbol id="g-adm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5L19 19M19 5l-3.5 3.5M8.5 15.5L5 19"/></symbol>
    <symbol id="g-cap" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 11h8M4.5 14.5A7.5 7.5 0 0012 21a7.5 7.5 0 007.5-6.5"/></symbol>
    <symbol id="g-mod" viewBox="0 0 24 24"><path d="M12 2.5l7.5 3v5.8c0 4.6-3.2 8.6-7.5 10.2-4.3-1.6-7.5-5.6-7.5-10.2V5.5z"/><path d="M8.8 12l2.2 2.2 4.2-4.4"/></symbol>
  </svg>
</template>
