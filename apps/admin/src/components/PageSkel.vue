<script setup lang="ts">
// 刚打开后台、数据还没到的那一下：灰色占位条（不先显示「还没登录」「还没有动态」这类还没确定的话）
import SkelRows from './SkelRows.vue';
</script>

<template>
  <section class="page skel-page" aria-busy="true" aria-label="正在读取">
    <div class="page-head"><div style="display: flex; flex-direction: column; gap: 10px"><span class="skel" style="width: 140px; height: 22px" /><span class="skel line" style="width: 260px" /></div></div>
    <div class="skel-grid">
      <div class="skel-card"><span class="skel line" style="width: 40%" /><span class="skel" style="height: 96px" /><span class="skel line" style="width: 70%" /></div>
      <div class="skel-card"><span class="skel line" style="width: 30%" /><span class="skel line" /><span class="skel line" style="width: 80%" /><span class="skel line" style="width: 60%" /></div>
    </div>
    <div class="skel-card"><SkelRows /></div>
  </section>
</template>
