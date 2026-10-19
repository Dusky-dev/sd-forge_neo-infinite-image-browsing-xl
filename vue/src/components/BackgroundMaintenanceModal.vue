<script setup lang="ts">
import { computed } from 'vue'
import { message } from 'ant-design-vue'
import { t } from '@/i18n'
import { useGlobalStore } from '@/store/useGlobalStore'
import { useBackgroundMaintenance } from '@/composables/useBackgroundMaintenance'

const globalStore = useGlobalStore()
const {
  settings,
  status,
  modalOpen,
  saving,
  runningNow,
  indexRunning,
  thumbRunning,
  saveSettings,
  runNow,
  closeModal
} = useBackgroundMaintenance()

const readonly = computed(() => globalStore.conf?.is_readonly === true)

const onIndexChange = (checked: boolean | string | number) => {
  void saveSettings({ index: !!checked })
}
const onThumbChange = (checked: boolean | string | number) => {
  void saveSettings({ thumbnail: !!checked })
}
const onDontRemindChange = (checked: boolean | string | number) => {
  void saveSettings({ bannerDismissed: !!checked })
}

const statusText = computed(() => {
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

const onRunNow = async () => {
  const ok = await runNow()
  if (!ok) {
    message.info(t('backgroundMaintenanceRunNowUnavailable'))
  }
}
</script>

<template>
  <a-modal
    v-model:visible="modalOpen"
    :title="$t('backgroundMaintenanceTitle')"
    :footer="null"
    :mask-closable="true"
    width="600px"
  >
    <div class="bm-modal">
      <a-alert type="warning" show-icon :message="$t('backgroundMaintenanceExperimentalHint')" />
      <div class="bm-intro">{{ $t('backgroundMaintenanceIntro') }}</div>
      <ul class="bm-hints">
        <li>{{ $t('backgroundMaintenanceCpuHint') }}</li>
        <li>{{ $t('backgroundMaintenanceThumbScopeHint') }}</li>
        <li>{{ $t('backgroundMaintenanceCacheHint') }}</li>
        <li>{{ $t('backgroundMaintenanceEditableHint') }}</li>
      </ul>

      <div class="bm-switch-row">
        <div class="bm-switch-main">
          <div class="bm-switch-label">{{ $t('backgroundMaintenanceIndexSwitch') }}</div>
          <div class="bm-switch-desc">{{ $t('backgroundMaintenanceIndexSwitchDesc') }}</div>
        </div>
        <a-switch :checked="settings.index" :disabled="readonly" @change="onIndexChange" />
      </div>

      <div class="bm-switch-row" :class="{ 'is-disabled': !settings.index }">
        <div class="bm-switch-main">
          <div class="bm-switch-label">{{ $t('backgroundMaintenanceThumbSwitch') }}</div>
          <div class="bm-switch-desc">
            {{ $t('backgroundMaintenanceThumbSwitchDesc') }}
            <span v-if="!settings.index" class="bm-inline-hint">
              {{ $t('backgroundMaintenanceThumbRequiresIndex') }}
            </span>
          </div>
        </div>
        <a-switch
          :checked="settings.thumbnail"
          :disabled="readonly || !settings.index"
          @change="onThumbChange"
        />
      </div>

      <div class="bm-switch-row">
        <div class="bm-switch-main">
          <div class="bm-switch-label">{{ $t('backgroundMaintenanceDontRemind') }}</div>
          <div class="bm-switch-desc">{{ $t('backgroundMaintenanceDontRemindDesc') }}</div>
        </div>
        <a-switch
          :checked="settings.bannerDismissed"
          :disabled="readonly"
          @change="onDontRemindChange"
        />
      </div>

      <div class="bm-status" v-if="statusText">
        <a-spin v-if="indexRunning || thumbRunning" size="small" />
        <span>{{ statusText }}</span>
      </div>
      <div class="bm-error" v-if="status?.index?.error">
        {{ $t('backgroundMaintenanceStatusError', { msg: status.index.error }) }}
      </div>
      <div class="bm-readonly-hint" v-if="readonly">
        {{ $t('backgroundMaintenanceReadonly') }}
      </div>

      <div class="bm-actions">
        <a-button
          @click="onRunNow"
          :loading="runningNow"
          :disabled="readonly || !settings.index"
        >
          {{ $t('backgroundMaintenanceRunNow') }}
        </a-button>
        <div flex-placeholder />
        <span class="bm-saving" v-if="saving">{{ $t('backgroundMaintenanceSaving') }}</span>
        <a-button type="primary" @click="closeModal">
          {{ $t('backgroundMaintenanceClose') }}
        </a-button>
      </div>
    </div>
  </a-modal>
</template>

<style scoped lang="scss">
.bm-modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bm-intro {
  line-height: 1.6;
}

.bm-hints {
  margin: 0;
  padding-left: 20px;
  line-height: 1.7;
  font-size: 12px;
  color: var(--zp-secondary);
}

.bm-switch-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--zp-secondary-background);

  &.is-disabled {
    opacity: 0.6;
  }

  .bm-switch-main {
    flex: 1;
    min-width: 0;
  }

  .bm-switch-label {
    font-weight: 600;
    margin-bottom: 4px;
  }

  .bm-switch-desc {
    font-size: 12px;
    color: var(--zp-secondary);
    line-height: 1.5;
  }

  .bm-inline-hint {
    display: block;
    color: #d03f0a;
  }
}

.bm-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--zp-secondary);
}

.bm-error {
  font-size: 12px;
  color: #ff4d4f;
  word-break: break-all;
}

.bm-readonly-hint {
  font-size: 12px;
  color: #d03f0a;
}

.bm-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;

  .bm-saving {
    font-size: 12px;
    color: var(--zp-secondary);
    margin-right: 8px;
  }
}
</style>
