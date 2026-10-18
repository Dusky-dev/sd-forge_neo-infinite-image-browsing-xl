<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import { useBackgroundMaintenance } from '@/composables/useBackgroundMaintenance'

const { status, active, openModal } = useBackgroundMaintenance()

const label = computed(() => {
  const st = status.value
  if (!st) {
    return ''
  }
  if (st.index?.running) {
    const done = st.index.dirsDone ?? 0
    const total = st.index.dirsTotal ?? 0
    return total > 0
      ? t('backgroundMaintenanceIndicatorIndex', { done, total })
      : t('backgroundMaintenanceIndicatorIndexGeneric')
  }
  if (st.thumb?.running) {
    const done = st.thumb.done ?? 0
    const total = done + (st.thumb.pending ?? 0)
    return t('backgroundMaintenanceIndicatorThumb', { done, total })
  }
  return ''
})

const tooltip = computed(() => {
  const parts = [label.value, t('backgroundMaintenanceIndicatorClickHint')].filter(Boolean)
  return parts.join(' · ')
})
</script>

<template>
  <!-- 全局轻量胶囊：左下角，避开右下角的 OrganizeJobsPanel -->
  <div
    v-if="active && label"
    class="iib-bg-maintenance-indicator"
    :title="tooltip"
    @click="openModal"
  >
    <span class="dot" />
    <span class="label">{{ label }}</span>
  </div>
</template>

<style scoped lang="scss">
.iib-bg-maintenance-indicator {
  position: fixed;
  left: 20px;
  bottom: 20px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 280px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--zp-primary);
  background: var(--zp-primary-background);
  border: 1px solid var(--zp-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  user-select: none;
  transition: transform 0.2s, box-shadow 0.2s;

  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  .dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #52c41a;
    animation: iib-bg-pulse 1.6s ease-in-out infinite;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

@keyframes iib-bg-pulse {
  0%,
  100% {
    opacity: 0.4;
    transform: scale(0.85);
  }

  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}
</style>
