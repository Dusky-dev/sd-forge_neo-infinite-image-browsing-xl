<script lang="ts" setup>
import { RecycleScroller } from '@/components/recycleScroller'
import FileItem from '@/components/FileItem.vue'
import { useFileItemActions, useFilesDisplay, useFileTransfer, useHookShareState, useKeepMultiSelect, usePreview } from '@/page/fileTransfer/hook'
import FullscreenPreview from '@/page/fileTransfer/FullscreenPreview.vue'
import { ref, onMounted, watch } from 'vue'
import { GridViewFile, useGlobalStore } from '@/store/useGlobalStore'
import { getRandomImages, getModelCheckpoints } from '@/api/db'
import { identity } from '@vueuse/core'
import fullScreenContextMenu from '@/page/fileTransfer/fullScreenContextMenu.vue'
import { openTiktokViewWithFiles } from '@/util/tiktokHelper'
import MultiSelectKeep from '@/components/MultiSelectKeep.vue'

import { LeftCircleOutlined, RightCircleOutlined } from '@/icon'
import { copy2clipboardI18n } from '@/util'
import { message } from 'ant-design-vue'
import { t } from '@/i18n'
import { useLocalStorage } from '@vueuse/core'
import { prefix } from '@/util/const'

const g = useGlobalStore()

defineProps<{
  tabIdx: number
  paneIdx: number
  id: string,
  paneKey: string
}>()

const loading = ref(false)
const checkpointsLoading = ref(false)
const selectedCheckpoint = useLocalStorage(`${prefix}randomImageCheckpoint`, '')
const checkpointOptions = ref<{ value: string; label: string }[]>([
  { value: '', label: t('randomCheckpointAll') }
])
const files = ref([] as GridViewFile[])
const images = files

let ready = false
let requestId = 0

const loadCheckpoints = async () => {
  checkpointsLoading.value = true
  try {
    const checkpoints = await getModelCheckpoints()
    checkpointOptions.value = [
      { value: '', label: t('randomCheckpointAll') },
      ...checkpoints.map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))
    ]
    // If the index has been rebuilt and a saved model no longer exists,
    // return to all checkpoints instead of leaving an unusable filter.
    if (selectedCheckpoint.value && !checkpoints.some(({ name }) => name === selectedCheckpoint.value)) {
      selectedCheckpoint.value = ''
    }
  } finally {
    checkpointsLoading.value = false
  }
}

// 使用VueUse的useLocalStorage hook
const hasShownNotification = useLocalStorage(`${prefix}randomImageSettingNotificationShown`, false)

// 显示一次性通知
const showRandomImageSettingNotification = () => {
  if (!hasShownNotification.value) {
    message.info({
      content: t('randomImageSettingNotification'),
      duration: 6,
      key: 'randomImageSetting'
    })
    hasShownNotification.value = true
  }
}

const fetch = async () => {
  const currentRequest = ++requestId
  try {
    loading.value = true
    const res = await getRandomImages(selectedCheckpoint.value || undefined)
    // Ignore slow responses for a previously selected checkpoint.
    if (currentRequest !== requestId) return
    if (res.length === 0) {
      message.warn(t(selectedCheckpoint.value ? 'randomCheckpointNoMatch' : 'randomIndexRequired'))
    }
    files.value = res
  } finally {
    if (currentRequest === requestId) {
      loading.value = false
      onScroll()
    }
  }
}

watch(selectedCheckpoint, () => {
  if (ready) void fetch()
})

// TikTok View 按钮点击处理
const onTiktokViewClick = () => {
  if (files.value.length === 0) {
    message.warn('没有图片可以浏览')
    return
  }
  // 从当前预览索引开始，如果没有预览则从第一张开始
  openTiktokViewWithFiles(files.value, previewIdx.value || 0)
}

onMounted(async () => {
  try {
    await loadCheckpoints()
  } catch (error) {
    // Keep unfiltered browsing usable even if the model list fails to load.
    console.error('Could not load indexed checkpoints', error)
  }
  ready = true
  void fetch()
  setTimeout(() => {
    showRandomImageSettingNotification()
  }, 2000)
})
const { stackViewEl, multiSelectedIdxs, stack, scroller } = useHookShareState({
  images: files as any
}).toRefs()
const { onClearAllSelected, onSelectAll, onReverseSelect } = useKeepMultiSelect()
useFileTransfer()
const { itemSize, gridItems, cellWidth, onScroll } = useFilesDisplay()
const {
  showGenInfo,
  imageGenInfo,
  q: genInfoQueue,
  onContextMenuClick,
  onFileItemClick
} = useFileItemActions({ openNext: identity as any })
const { previewIdx, previewing, onPreviewVisibleChange, previewImgMove, canPreview } = usePreview()

const onContextMenuClickU: typeof onContextMenuClick = async (e, file, idx) => {
  stack.value = [{ curr: '', files: files.value! }] // hack，for delete multi files
  await onContextMenuClick(e, file, idx)
}

</script>
<template>
  <div class="container" ref="stackViewEl">
    <MultiSelectKeep :show="!!multiSelectedIdxs.length || g.keepMultiSelect" @clear-all-selected="onClearAllSelected"
      @select-all="onSelectAll" @reverse-select="onReverseSelect" />
    <div class="refresh-button">
      <a-select
        v-model:value="selectedCheckpoint"
        :options="checkpointOptions"
        :loading="checkpointsLoading"
        :placeholder="$t('randomCheckpointPlaceholder')"
        :aria-label="$t('randomCheckpointPlaceholder')"
        option-filter-prop="label"
        show-search
        class="checkpoint-select"
      />
      <a-button 
        @click="fetch" 
        @touchstart.prevent="fetch"
        type="primary" 
        :loading="loading" 
        shape="round"
      >
        {{ $t('tryMyLuck') }}
      </a-button>
      <a-button 
        @click="onTiktokViewClick" 
        @touchstart.prevent="onTiktokViewClick"
        type="default" 
        :disabled="!files?.length" 
        shape="round"
      >
        {{ $t('tiktokView') }}
      </a-button>
    </div>
    
    <AModal v-model:visible="showGenInfo" width="70vw" mask-closable @ok="showGenInfo = false">
      <template #cancelText />
      <ASkeleton active :loading="!genInfoQueue.isIdle">
        <div style="
              width: 100%;
              word-break: break-all;
              white-space: pre-line;
              max-height: 70vh;
              overflow: auto;
            " @dblclick="copy2clipboardI18n(imageGenInfo)">
          <div class="hint">{{ $t('doubleClickToCopy') }}</div>
          {{ imageGenInfo }}
        </div>
      </ASkeleton>
    </AModal>
    <RecycleScroller ref="scroller" class="file-list" :items="files.slice()" :item-size="itemSize.first"
      key-field="fullpath" :item-secondary-size="itemSize.second" :gridItems="gridItems" @scroll="onScroll">
      <template v-slot="{ item: file, index: idx }">
        <file-item :idx="idx" :file="file" :cell-width="cellWidth"
          :enable-builtin-preview="false" @context-menu-click="onContextMenuClickU"
          :is-selected-mutil-files="multiSelectedIdxs.length > 1" :selected="multiSelectedIdxs.includes(idx)"
          @file-item-click="onFileItemClick" @tiktok-view="(_file, idx) => openTiktokViewWithFiles(files, idx)" />
      </template>
    </RecycleScroller>
    <div v-if="previewing" class="preview-switch">
      <LeftCircleOutlined @click="previewImgMove('prev')" :class="{ disable: !canPreview('prev') }" />
      <RightCircleOutlined @click="previewImgMove('next')" :class="{ disable: !canPreview('next') }" />
    </div>
    <FullscreenPreview :files="images" :preview-idx="previewIdx" :previewing="previewing"
      @visible-change="onPreviewVisibleChange" />
    <fullScreenContextMenu v-if="previewing && images && images[previewIdx]" :file="images[previewIdx]"
      :idx="previewIdx" @context-menu-click="onContextMenuClickU" />
  </div>
</template>
<style scoped lang="scss">
.container {
  background: var(--zp-secondary-background);

  height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;

  .actions-panel {
    padding: 8px;
    background-color: var(--zp-primary-background);
  }

  .refresh-button {
    position: absolute;
    top: 90%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 99;
    background: var(--zp-primary-background);
    border-radius: 9999px;
    box-shadow: 0 0 20px var(--zp-secondary);
    padding: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
    max-width: calc(100% - 24px);
  }

  .checkpoint-select {
    width: 240px;
    max-width: 70vw;
  }

  .file-list {
    flex: 1;
    list-style: none;
    padding: 8px;
    height: var(--pane-max-height);
    width: 100%;

    .hint {
      text-align: center;
      font-size: 2em;
      padding: 30vh 128px 0;
    }
  }
}
</style>
