<template>
  <!-- 图标（从设计预览移植；大航海图标暂用自绘，之后换成 B 站官方图标） -->
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <symbol id="i-star" viewBox="0 0 24 24"><path d="M12 1.8l2.3 7.2 7.5.1-6 4.5 2.2 7.2L12 16.5l-6 4.3 2.2-7.2-6-4.5 7.5-.1z"/></symbol>
    <symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 2c.6 4.8 2.2 6.4 7 7-4.8.6-6.4 2.2-7 7-.6-4.8-2.2-6.4-7-7 4.8-.6 6.4-2.2 7-7z"/></symbol>
    <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></symbol>
    <symbol id="i-wand" viewBox="0 0 24 24"><path d="M4 20L15 9"/><path d="M14 4v2M19 9h2M17.5 5.5l1.5-1.5M17.5 12.5l1.5 1.5M10 5.5L8.5 4"/><path d="M13 7l4 4"/></symbol>
    <symbol id="i-image" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-5-5-9 9"/></symbol>
    <symbol id="i-list" viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".9"/><circle cx="4.5" cy="12" r=".9"/><circle cx="4.5" cy="18" r=".9"/></symbol>
    <symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></symbol>
    <symbol id="i-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></symbol>
    <symbol id="i-ext" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></symbol>
    <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></symbol>
    <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></symbol>
    <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z"/></symbol>
    <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
    <symbol id="i-grip" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></symbol>
    <symbol id="i-play" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></symbol>
    <symbol id="i-check" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/></symbol>
    <symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z"/></symbol>
    <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></symbol>
    <symbol id="i-pause" viewBox="0 0 24 24"><rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/></symbol>
    <symbol id="i-ban" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></symbol>
    <symbol id="i-qr" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="6" height="6" rx="1"/><rect x="14.5" y="3.5" width="6" height="6" rx="1"/><rect x="3.5" y="14.5" width="6" height="6" rx="1"/><path d="M14.5 14.5h2v2h-2zM18.5 18.5h2v2h-2zM14.5 18.5h2M18.5 14.5h2"/></symbol>
    <symbol id="i-up" viewBox="0 0 24 24"><path d="M7 14l5-5 5 5"/></symbol>
    <symbol id="i-down" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></symbol>
    <symbol id="i-gift" viewBox="0 0 24 24"><rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v8h14v-8M12 8.5v12M12 8.5C10 4 6.5 4.5 7 7c.3 1.2 2.5 1.5 5 1.5zM12 8.5c2-4.5 5.5-4 5-1.5-.3 1.2-2.5 1.5-5 1.5z"/></symbol>
    <symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 5.5h16v10H9l-5 4z"/></symbol>
    <symbol id="i-chev" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></symbol>
    <symbol id="i-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></symbol>
    <symbol id="i-dup" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 00-1.5-1.5H5A1.5 1.5 0 003.5 5v9A1.5 1.5 0 005 15.5h3.5"/></symbol>
    <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 018 0v3"/></symbol>
    <symbol id="i-screen" viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10.5 18.5h3"/></symbol>
    <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
    <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/></symbol>
    <symbol id="i-copy" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 00-1.5-1.5H5A1.5 1.5 0 003.5 5v9A1.5 1.5 0 005 15.5h3.5"/></symbol>
    <symbol id="i-replay" viewBox="0 0 24 24"><path d="M4 12a8 8 0 108-8 8.5 8.5 0 00-6 2.5L4 8"/><path d="M4 3.5V8h4.5"/></symbol>
    <symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 010 6.4M18 14.8c1.8.8 3 2.6 3.5 5.2"/></symbol>
    <symbol id="i-medal" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M14 7v10"/></symbol>
    <symbol id="i-logout" viewBox="0 0 24 24"><path d="M14 4h5a1 1 0 011 1v14a1 1 0 01-1 1h-5M10 16l-4-4 4-4M6 12h10"/></symbol>
    <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></symbol>
      <symbol id="g-gov" viewBox="0 0 24 24"><path d="M3 18.5h18M4 16l-1-9 5.5 4L12 4l3.5 7L21 7l-1 9z"/></symbol>
    <symbol id="g-adm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5L19 19M19 5l-3.5 3.5M8.5 15.5L5 19"/></symbol>
    <symbol id="g-cap" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 11h8M4.5 14.5A7.5 7.5 0 0012 21a7.5 7.5 0 007.5-6.5"/></symbol>
    <symbol id="g-mod" viewBox="0 0 24 24"><path d="M12 2.5l7.5 3v5.8c0 4.6-3.2 8.6-7.5 10.2-4.3-1.6-7.5-5.6-7.5-10.2V5.5z"/><path d="M8.8 12l2.2 2.2 4.2-4.4"/></symbol>
  </svg>
</template>
