/**
 * Global @vue/test-utils config for renderer component tests.
 *
 * Components use vue-i18n's useI18n() (composition mode), which throws when
 * the i18n plugin is not installed on the mounting app — register it once
 * here instead of in every mount() call.
 */
import { config } from '@vue/test-utils'
import { i18n } from '@/i18n'

config.global.plugins.push(i18n)
