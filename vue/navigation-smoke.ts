// Temporary browser-only integration fixture: mount the real StackView,
// FileItem, useLocation and RecycleScroller with a deterministic /files API.
import { createApp, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from './src/i18n'
import './src/index.scss'

const pinia = createPinia()
setActivePinia(pinia)
const { useGlobalStore } = await import('./src/store/useGlobalStore')
const { default: StackView } = await import('./src/page/fileTransfer/stackView.vue')
const global = useGlobalStore()
global.conf = {
  is_win: false,
  home: '/',
  sd_cwd: '/',
  cwd: '/',
  global_setting: {},
  all_custom_tags: [],
  extra_paths: [],
  app_fe_setting: { global: {} },
  launch_mode: 'server',
  is_readonly: false,
  enable_access_control: false,
  export_fe_fn: false
} as any
global.fileTypeFilter = ['all']
global.tabList = [
  {
    id: 'integration-tab',
    key: 'integration-pane',
    panes: [{
      key: 'integration-pane',
      type: 'local',
      name: 'Directory test',
      mode: 'scanned',
      path: '/'
    }]
  }
]
const app = createApp({
  render: () => h(StackView, { tabIdx: 0, paneIdx: 0, mode: 'scanned', path: '/' })
})
app.use(pinia).use(i18n)
app.mount('#navigation-test-app')
;(window as any).__navigationAppReady = true
