<script setup lang="ts">
import { onMounted } from 'vue'
import { useBackgroundMaintenance } from '@/composables/useBackgroundMaintenance'

const { bannerVisible, settingsLoaded, loadSettings, openModal, saveSettings } = useBackgroundMaintenance()

onMounted(() => {
  // App 里会全局初始化；这里兜底，避免 banner 依赖初始化时序
  if (!settingsLoaded.value) {
    void loadSettings().catch(() => undefined)
  }
})

const dismiss = () => {
  void saveSettings({ bannerDismissed: true }, { immediate: true })
}
</script>

<template>
  <a-alert
    v-if="bannerVisible"
    class="background-maintenance-banner"
    type="info"
    show-icon
    @click="openModal"
  >
    <template #message>
      <div class="bm-banner-message">
        <span class="bm-banner-title">{{ $t('backgroundMaintenanceBannerTitle') }}</span>
        <span class="bm-banner-desc">{{ $t('backgroundMaintenanceBannerDesc') }}</span>
        <div flex-placeholder />
        <a class="bm-banner-link" @click.stop="openModal">{{ $t('backgroundMaintenanceOpen') }}</a>
        <a class="bm-banner-link" @click.stop="dismiss">{{ $t('backgroundMaintenanceDontRemind') }}</a>
      </div>
    </template>
  </a-alert>
</template>

<style scoped lang="scss">
.background-maintenance-banner {
  margin-top: 8px;
  margin-bottom: 8px;
  cursor: pointer;

  :deep(.ant-alert-message) {
    width: 100%;
  }
}

.bm-banner-message {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
}

.bm-banner-title {
  font-weight: 600;
}

.bm-banner-desc {
  font-size: 12px;
  opacity: 0.85;
}

.bm-banner-link {
  flex-shrink: 0;
  font-size: 12px;
  margin-left: 8px;
}
</style>
